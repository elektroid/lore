package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type Scenario struct {
	ID         string  `json:"id"`
	CampaignID string  `json:"campaign_id"`
	Name       string  `json:"name"`
	Status     string  `json:"status"`
	SortOrder  int     `json:"sort_order"`
	ArchivedAt *string `json:"archived_at"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
}

type CreateScenarioParams struct {
	CampaignID string
	Name       string
}

type UpdateScenarioParams struct {
	ID     string
	Name   string
	Status string
}

const scenarioCols = `id, campaign_id, name, status, sort_order, archived_at, created_at, updated_at`

func scanScenario(row interface{ Scan(...any) error }) (*Scenario, error) {
	var s Scenario
	err := row.Scan(&s.ID, &s.CampaignID, &s.Name, &s.Status, &s.SortOrder, &s.ArchivedAt, &s.CreatedAt, &s.UpdatedAt)
	return &s, err
}

func ListScenarios(ctx context.Context, database *sql.DB, campaignID string) ([]Scenario, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+scenarioCols+` FROM scenarios WHERE campaign_id=? ORDER BY sort_order ASC, created_at ASC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Scenario
	for rows.Next() {
		s, err := scanScenario(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *s)
	}
	if list == nil {
		list = []Scenario{}
	}
	return list, rows.Err()
}

func GetScenario(ctx context.Context, database *sql.DB, id string) (*Scenario, error) {
	row := database.QueryRowContext(ctx,
		`SELECT `+scenarioCols+` FROM scenarios WHERE id=?`, id)
	s, err := scanScenario(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return s, err
}

// CreateScenario opens a transaction: inserts the scenario then creates its empty synopsis.
func CreateScenario(ctx context.Context, database *sql.DB, p CreateScenarioParams) (*Scenario, error) {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var nextOrder int
	if err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM scenarios WHERE campaign_id=?`, p.CampaignID,
	).Scan(&nextOrder); err != nil {
		return nil, err
	}

	scenarioID := uuid.New().String()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO scenarios (id, campaign_id, name, sort_order) VALUES (?, ?, ?, ?)`,
		scenarioID, p.CampaignID, p.Name, nextOrder,
	); err != nil {
		return nil, err
	}

	if err := insertEmptySynopsis(ctx, tx, scenarioID); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return GetScenario(ctx, database, scenarioID)
}

// UpdateScenario also tracks the archived/orderable boundary: entering
// 'archived' stamps archived_at (for the archived section's sort), leaving it
// clears archived_at and drops the scenario at the end of the orderable list
// — its old sort_order was frozen while archived and may now collide with
// scenarios reordered in the meantime.
func UpdateScenario(ctx context.Context, database *sql.DB, p UpdateScenarioParams) (*Scenario, error) {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var campaignID, prevStatus string
	if err := tx.QueryRowContext(ctx,
		`SELECT campaign_id, status FROM scenarios WHERE id=?`, p.ID,
	).Scan(&campaignID, &prevStatus); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	if prevStatus != "archived" && p.Status == "archived" {
		if _, err := tx.ExecContext(ctx,
			`UPDATE scenarios SET name=?, status=?, archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
			p.Name, p.Status, p.ID); err != nil {
			return nil, err
		}
	} else if prevStatus == "archived" && p.Status != "archived" {
		var nextOrder int
		if err := tx.QueryRowContext(ctx,
			`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM scenarios WHERE campaign_id=?`, campaignID,
		).Scan(&nextOrder); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE scenarios SET name=?, status=?, sort_order=?, archived_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
			p.Name, p.Status, nextOrder, p.ID); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.ExecContext(ctx,
			`UPDATE scenarios SET name=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
			p.Name, p.Status, p.ID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return GetScenario(ctx, database, p.ID)
}

// ReorderScenariosIn renumbers a campaign's non-archived scenarios,
// ignoring any id that does not belong to this campaign — an unscoped
// version would let a caller renumber another campaign's scenarios by
// sending their ids in the body.
func ReorderScenariosIn(ctx context.Context, database *sql.DB, campaignID string, ids []string) error {
	for i, id := range ids {
		if _, err := database.ExecContext(ctx,
			`UPDATE scenarios SET sort_order=? WHERE id=? AND campaign_id=?`,
			i, id, campaignID); err != nil {
			return err
		}
	}
	return nil
}

func DeleteScenario(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM scenarios WHERE id=?`, id)
	return err
}
