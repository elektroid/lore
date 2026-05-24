package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type Scenario struct {
	ID         string `json:"id"`
	CampaignID string `json:"campaign_id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
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

const scenarioCols = `id, campaign_id, name, status, created_at, updated_at`

func scanScenario(row interface{ Scan(...any) error }) (*Scenario, error) {
	var s Scenario
	err := row.Scan(&s.ID, &s.CampaignID, &s.Name, &s.Status, &s.CreatedAt, &s.UpdatedAt)
	return &s, err
}

func ListScenarios(ctx context.Context, database *sql.DB, campaignID string) ([]Scenario, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+scenarioCols+` FROM scenarios WHERE campaign_id=? ORDER BY created_at ASC`, campaignID)
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

	scenarioID := uuid.New().String()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO scenarios (id, campaign_id, name) VALUES (?, ?, ?)`,
		scenarioID, p.CampaignID, p.Name,
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

func UpdateScenario(ctx context.Context, database *sql.DB, p UpdateScenarioParams) (*Scenario, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE scenarios SET name=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		p.Name, p.Status, p.ID)
	if err != nil {
		return nil, err
	}
	return GetScenario(ctx, database, p.ID)
}

func DeleteScenario(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM scenarios WHERE id=?`, id)
	return err
}
