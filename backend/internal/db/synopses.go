package db

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/google/uuid"
)

type Synopsis struct {
	ID            string `json:"id"`
	ScenarioID    string `json:"scenario_id"`
	Hook          string `json:"hook"`
	NPCs          string `json:"npcs"`
	Steps         string `json:"steps"`
	OverviewCache string `json:"overview_cache"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

type UpdateSynopsisParams struct {
	ScenarioID    string
	Hook          string
	NPCs          string
	OverviewCache string
}

// insertEmptySynopsis is called inside a transaction from CreateScenario.
func insertEmptySynopsis(ctx context.Context, tx *sql.Tx, scenarioID string) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO synopses (id, scenario_id) VALUES (?, ?)`,
		uuid.New().String(), scenarioID)
	return err
}

func GetSynopsisByScenario(ctx context.Context, database *sql.DB, scenarioID string) (*Synopsis, error) {
	var s Synopsis
	err := database.QueryRowContext(ctx,
		`SELECT id, scenario_id, hook, npcs, steps, overview_cache, created_at, updated_at
		 FROM synopses WHERE scenario_id=?`, scenarioID,
	).Scan(&s.ID, &s.ScenarioID, &s.Hook, &s.NPCs, &s.Steps, &s.OverviewCache, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

func UpdateSynopsis(ctx context.Context, database *sql.DB, p UpdateSynopsisParams) (*Synopsis, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE synopses
		 SET hook=?, npcs=?, overview_cache=?, updated_at=CURRENT_TIMESTAMP
		 WHERE scenario_id=?`,
		p.Hook, p.NPCs, p.OverviewCache, p.ScenarioID)
	if err != nil {
		return nil, err
	}
	return GetSynopsisByScenario(ctx, database, p.ScenarioID)
}

// SynopsisToSnapshotData serialises content fields into a snapshot data blob.
func SynopsisToSnapshotData(s *Synopsis) string {
	data, _ := json.Marshal(map[string]json.RawMessage{
		"hook":  json.RawMessage(s.Hook),
		"npcs":  json.RawMessage(s.NPCs),
		"steps": json.RawMessage(s.Steps),
	})
	return string(data)
}

// ── Snapshots ────────────────────────────────────────────────────────────────

type Snapshot struct {
	ID         string `json:"id"`
	SynopsisID string `json:"synopsis_id"`
	Label      string `json:"label"`
	Data       string `json:"data"`
	CreatedAt  string `json:"created_at"`
}

func CreateSnapshot(ctx context.Context, database *sql.DB, synopsisID, label, data string) error {
	_, err := database.ExecContext(ctx,
		`INSERT INTO synopsis_snapshots (id, synopsis_id, label, data) VALUES (?, ?, ?, ?)`,
		uuid.New().String(), synopsisID, label, data)
	return err
}

func GetSnapshot(ctx context.Context, database *sql.DB, id string) (*Snapshot, error) {
	var s Snapshot
	err := database.QueryRowContext(ctx,
		`SELECT id, synopsis_id, label, data, created_at FROM synopsis_snapshots WHERE id=?`, id,
	).Scan(&s.ID, &s.SynopsisID, &s.Label, &s.Data, &s.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

func ListSnapshots(ctx context.Context, database *sql.DB, synopsisID string) ([]Snapshot, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, synopsis_id, label, data, created_at FROM synopsis_snapshots
		 WHERE synopsis_id=? ORDER BY created_at DESC`, synopsisID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Snapshot
	for rows.Next() {
		var s Snapshot
		if err := rows.Scan(&s.ID, &s.SynopsisID, &s.Label, &s.Data, &s.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	if list == nil {
		list = []Snapshot{}
	}
	return list, rows.Err()
}

// DeleteOldestSnapshotsIfNeeded keeps only the `max` most recent snapshots.
func DeleteOldestSnapshotsIfNeeded(ctx context.Context, database *sql.DB, synopsisID string, max int) error {
	_, err := database.ExecContext(ctx,
		`DELETE FROM synopsis_snapshots
		 WHERE synopsis_id=? AND id NOT IN (
		     SELECT id FROM synopsis_snapshots
		     WHERE synopsis_id=?
		     ORDER BY created_at DESC
		     LIMIT ?
		 )`, synopsisID, synopsisID, max)
	return err
}
