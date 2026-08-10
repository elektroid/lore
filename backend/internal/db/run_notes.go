package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

// A player's private scratchpad for a run — never read by the GM or any other
// player, one row per (run, player). See docs/adr/0001-runs-separate-story-from-play.md
// for why this lives off the run rather than the session: notes are the
// player's own, for as long as they play with this group.
type RunNote struct {
	RunID     string `json:"run_id"`
	Body      string `json:"body"`
	UpdatedAt string `json:"updated_at"`
}

// GetRunNote returns an empty note (not an error) if the player has not
// written one yet.
func GetRunNote(ctx context.Context, database *sql.DB, runID, userID string) (*RunNote, error) {
	n := &RunNote{RunID: runID}
	err := database.QueryRowContext(ctx,
		`SELECT body, updated_at FROM run_notes WHERE run_id=? AND user_id=?`, runID, userID).
		Scan(&n.Body, &n.UpdatedAt)
	if err == sql.ErrNoRows {
		return n, nil
	}
	return n, err
}

// UpsertRunNote writes a player's note for a run, creating the row on first
// save.
func UpsertRunNote(ctx context.Context, database *sql.DB, runID, userID, body string) (*RunNote, error) {
	_, err := database.ExecContext(ctx, `
		INSERT INTO run_notes(id, run_id, user_id, body)
		VALUES(?,?,?,?)
		ON CONFLICT(run_id, user_id) DO UPDATE SET body=excluded.body, updated_at=CURRENT_TIMESTAMP`,
		uuid.New().String(), runID, userID, body)
	if err != nil {
		return nil, err
	}
	return GetRunNote(ctx, database, runID, userID)
}
