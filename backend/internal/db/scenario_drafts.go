package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

// ScenarioDraft is one scenario-factory run: the GM's brief and the whole LLM
// proposal, held as JSON until commit turns it into real rows.
// See docs/scenario-factory.md.
type ScenarioDraft struct {
	ID         string `json:"id"`
	CampaignID string `json:"campaign_id"`
	ScenarioID string `json:"scenario_id"` // set on commit
	Title      string `json:"title"`
	Brief      string `json:"brief"`
	Status     string `json:"status"` // draft | committed
	Proposal   string `json:"proposal"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

const draftCols = `id, campaign_id, scenario_id, title, brief, status, proposal, created_at, updated_at`

func scanDraft(row interface{ Scan(...any) error }) (*ScenarioDraft, error) {
	var d ScenarioDraft
	err := row.Scan(&d.ID, &d.CampaignID, &d.ScenarioID, &d.Title, &d.Brief,
		&d.Status, &d.Proposal, &d.CreatedAt, &d.UpdatedAt)
	return &d, err
}

func ListScenarioDrafts(ctx context.Context, database *sql.DB, campaignID string) ([]ScenarioDraft, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+draftCols+` FROM scenario_drafts WHERE campaign_id=? ORDER BY created_at DESC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ScenarioDraft
	for rows.Next() {
		d, err := scanDraft(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *d)
	}
	if list == nil {
		list = []ScenarioDraft{}
	}
	return list, rows.Err()
}

func GetScenarioDraft(ctx context.Context, database *sql.DB, id string) (*ScenarioDraft, error) {
	d, err := scanDraft(database.QueryRowContext(ctx,
		`SELECT `+draftCols+` FROM scenario_drafts WHERE id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return d, nil
}

func CreateScenarioDraft(ctx context.Context, database *sql.DB, campaignID, title, brief, proposal string) (*ScenarioDraft, error) {
	id := uuid.New().String()
	if proposal == "" {
		proposal = "{}"
	}
	_, err := database.ExecContext(ctx,
		`INSERT INTO scenario_drafts (id, campaign_id, title, brief, proposal) VALUES (?,?,?,?,?)`,
		id, campaignID, title, brief, proposal)
	if err != nil {
		return nil, err
	}
	return GetScenarioDraft(ctx, database, id)
}

// UpdateScenarioDraft saves the title and the proposal — the only two things a
// GM edits. The brief stays as they first wrote it.
func UpdateScenarioDraft(ctx context.Context, database *sql.DB, id, title, proposal string) (*ScenarioDraft, error) {
	if proposal == "" {
		proposal = "{}"
	}
	_, err := database.ExecContext(ctx,
		`UPDATE scenario_drafts SET title=?, proposal=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		title, proposal, id)
	if err != nil {
		return nil, err
	}
	return GetScenarioDraft(ctx, database, id)
}

// MarkScenarioDraftCommitted records which scenario a draft became. The draft
// is kept: it is the record of what the machine proposed, next to what the
// campaign became.
func MarkScenarioDraftCommitted(ctx context.Context, database *sql.DB, id, scenarioID string) (*ScenarioDraft, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE scenario_drafts SET status='committed', scenario_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		scenarioID, id)
	if err != nil {
		return nil, err
	}
	return GetScenarioDraft(ctx, database, id)
}

func DeleteScenarioDraft(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM scenario_drafts WHERE id=?`, id)
	return err
}
