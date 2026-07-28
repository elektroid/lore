package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

// A session is one evening: the group that played it (RunID) and the story it
// advanced (ScenarioID). See docs/adr/0001-runs-separate-story-from-play.md.
type Session struct {
	ID               string `json:"id"`
	ScenarioID       string `json:"scenario_id"`
	RunID            string `json:"run_id"`
	Name             string `json:"name"`
	Date             string `json:"date"`
	ActiveLocationID string `json:"active_location_id"`
	ActiveSceneID    string `json:"active_scene_id"`
	TableToken       string `json:"table_token"` // '' until the GM first shares the table
	Projection       string `json:"projection"`  // JSON Projection — see table.go
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

type SessionScene struct {
	SessionID string `json:"session_id"`
	SceneID   string `json:"scene_id"`
	State     string `json:"state"` // "cleared" | "void"
}

const sessionCols = `id, scenario_id, COALESCE(run_id,''), name, date,
	COALESCE(active_location_id,''), COALESCE(active_scene_id,''),
	COALESCE(table_token,''), COALESCE(NULLIF(projection,''),'{}'),
	created_at, updated_at`

func scanSession(row interface{ Scan(...any) error }) (*Session, error) {
	var s Session
	err := row.Scan(&s.ID, &s.ScenarioID, &s.RunID, &s.Name, &s.Date,
		&s.ActiveLocationID, &s.ActiveSceneID, &s.TableToken, &s.Projection,
		&s.CreatedAt, &s.UpdatedAt)
	return &s, err
}

// ListSessions returns a scenario's sessions. A non-empty runID narrows them to
// one group's evenings — which is what the play console always wants, since two
// groups running the same scenario must not see each other's sessions.
func ListSessions(ctx context.Context, database *sql.DB, scenarioID, runID string) ([]Session, error) {
	query := `SELECT ` + sessionCols + ` FROM sessions WHERE scenario_id=?`
	args := []any{scenarioID}
	if runID != "" {
		query += ` AND run_id=?`
		args = append(args, runID)
	}
	query += ` ORDER BY date DESC, created_at DESC`

	rows, err := database.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Session
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *s)
	}
	if list == nil {
		list = []Session{}
	}
	return list, rows.Err()
}

func GetSession(ctx context.Context, database *sql.DB, id string) (*Session, error) {
	s, err := scanSession(database.QueryRowContext(ctx,
		`SELECT `+sessionCols+` FROM sessions WHERE id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return s, err
}

type CreateSessionParams struct {
	ScenarioID string
	RunID      string
	Name       string
	Date       string
}

func CreateSession(ctx context.Context, database *sql.DB, p CreateSessionParams) (*Session, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO sessions(id, scenario_id, run_id, name, date) VALUES(?,?,?,?,?)`,
		id, p.ScenarioID, p.RunID, p.Name, p.Date)
	if err != nil {
		return nil, err
	}
	return GetSession(ctx, database, id)
}

type UpdateSessionParams struct {
	ID               string
	Name             string
	Date             string
	ActiveLocationID string
	ActiveSceneID    string
}

// UpdateSession does not move a session between groups. Which group played an
// evening is not an editable detail — everything recorded that evening belongs
// to them.
func UpdateSession(ctx context.Context, database *sql.DB, p UpdateSessionParams) (*Session, error) {
	var locID, sceneID interface{}
	if p.ActiveLocationID != "" {
		locID = p.ActiveLocationID
	}
	if p.ActiveSceneID != "" {
		sceneID = p.ActiveSceneID
	}
	_, err := database.ExecContext(ctx,
		`UPDATE sessions SET name=?,date=?,active_location_id=?,active_scene_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		p.Name, p.Date, locID, sceneID, p.ID)
	if err != nil {
		return nil, err
	}
	return GetSession(ctx, database, p.ID)
}

func DeleteSession(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM sessions WHERE id=?`, id)
	return err
}

// ── Session scene states ──────────────────────────────────────────────────────

// ListSessionScenes returns the non-pending scene states for a session as a map.
func ListSessionScenes(ctx context.Context, database *sql.DB, sessionID string) (map[string]string, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT scene_id, state FROM session_scenes WHERE session_id=?`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var sceneID, state string
		if err := rows.Scan(&sceneID, &state); err != nil {
			return nil, err
		}
		m[sceneID] = state
	}
	return m, rows.Err()
}

// SetSessionSceneState upserts a scene state (cleared or void).
func SetSessionSceneState(ctx context.Context, database *sql.DB, sessionID, sceneID, state string) error {
	_, err := database.ExecContext(ctx,
		`INSERT INTO session_scenes(id, session_id, scene_id, state)
		 VALUES(?,?,?,?)
		 ON CONFLICT(session_id, scene_id) DO UPDATE SET state=excluded.state`,
		uuid.New().String(), sessionID, sceneID, state)
	return err
}

// ClearSessionSceneState removes a scene state (back to pending).
func ClearSessionSceneState(ctx context.Context, database *sql.DB, sessionID, sceneID string) error {
	_, err := database.ExecContext(ctx,
		`DELETE FROM session_scenes WHERE session_id=? AND scene_id=?`, sessionID, sceneID)
	return err
}

// ── Party ─────────────────────────────────────────────────────────────────────
//
// The party belongs to the run, not the session — see runs.go. What is left here
// is the lookup that goes the other way: from an evening back to the group that
// played it, for callers holding only a session id.

// RunIDForSession resolves a session to its group. Returns "" for a session that
// predates runs and no backfill could claim.
func RunIDForSession(ctx context.Context, database *sql.DB, sessionID string) (string, error) {
	var runID sql.NullString
	err := database.QueryRowContext(ctx,
		`SELECT run_id FROM sessions WHERE id=?`, sessionID).Scan(&runID)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return runID.String, err
}
