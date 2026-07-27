package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

// SessionBeat is something the players did that the scenario never anticipated.
// Note holds the GM's own words, typed at the table in one keystroke, and is
// never overwritten — development writes into Title/Description/Outcome/Notes.
// See docs/play-improv.md.
type SessionBeat struct {
	ID            string `json:"id"`
	SessionID     string `json:"session_id"`
	SessionName   string `json:"session_name"`
	ScenarioID    string `json:"scenario_id"`
	AnchorSceneID string `json:"anchor_scene_id"`
	AnchorTitle   string `json:"anchor_title"`
	Note          string `json:"note"`
	Status        string `json:"status"` // captured | developed | adopted | dropped
	Title         string `json:"title"`
	Description   string `json:"description"`
	Outcome       string `json:"outcome"`
	Notes         string `json:"notes"`
	Coherency     string `json:"coherency"` // JSON — verdict, summary, impacts
	SceneID       string `json:"scene_id"`  // set on adopt
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

const beatCols = `
	b.id, b.session_id, COALESCE(sess.name,''), b.scenario_id,
	COALESCE(b.anchor_scene_id,''), COALESCE(anchor.title,''),
	b.note, b.status, b.title, b.description, b.outcome, b.notes,
	COALESCE(NULLIF(b.coherency,''),'{}'), COALESCE(b.scene_id,''),
	b.created_at, b.updated_at`

const beatJoin = `
	FROM session_beats b
	LEFT JOIN sessions sess ON sess.id = b.session_id
	LEFT JOIN synopsis_scenes anchor ON anchor.id = b.anchor_scene_id`

func scanBeat(row interface{ Scan(...any) error }) (*SessionBeat, error) {
	var b SessionBeat
	err := row.Scan(&b.ID, &b.SessionID, &b.SessionName, &b.ScenarioID,
		&b.AnchorSceneID, &b.AnchorTitle,
		&b.Note, &b.Status, &b.Title, &b.Description, &b.Outcome, &b.Notes,
		&b.Coherency, &b.SceneID, &b.CreatedAt, &b.UpdatedAt)
	return &b, err
}

// ListSessionBeats returns every beat of a scenario, newest first. Pass an
// empty sessionID for the cross-session view prep uses.
func ListSessionBeats(ctx context.Context, database *sql.DB, scenarioID, sessionID string) ([]SessionBeat, error) {
	query := `SELECT` + beatCols + beatJoin + ` WHERE b.scenario_id=?`
	args := []any{scenarioID}
	if sessionID != "" {
		query += ` AND b.session_id=?`
		args = append(args, sessionID)
	}
	query += ` ORDER BY b.created_at DESC`

	rows, err := database.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []SessionBeat
	for rows.Next() {
		b, err := scanBeat(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *b)
	}
	if list == nil {
		list = []SessionBeat{}
	}
	return list, rows.Err()
}

func GetSessionBeat(ctx context.Context, database *sql.DB, id string) (*SessionBeat, error) {
	b, err := scanBeat(database.QueryRowContext(ctx,
		`SELECT`+beatCols+beatJoin+` WHERE b.id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return b, nil
}

type CreateBeatParams struct {
	SessionID     string
	ScenarioID    string
	AnchorSceneID string
	Note          string
}

// CreateSessionBeat is the capture path: one insert, no LLM, no other work.
func CreateSessionBeat(ctx context.Context, database *sql.DB, p CreateBeatParams) (*SessionBeat, error) {
	id := uuid.New().String()
	var anchor interface{}
	if p.AnchorSceneID != "" {
		anchor = p.AnchorSceneID
	}
	_, err := database.ExecContext(ctx,
		`INSERT INTO session_beats(id,session_id,scenario_id,anchor_scene_id,note) VALUES(?,?,?,?,?)`,
		id, p.SessionID, p.ScenarioID, anchor, p.Note)
	if err != nil {
		return nil, err
	}
	return GetSessionBeat(ctx, database, id)
}

type UpdateBeatParams struct {
	Note        string
	Status      string
	Title       string
	Description string
	Outcome     string
	Notes       string
	Coherency   string
}

func UpdateSessionBeat(ctx context.Context, database *sql.DB, id string, p UpdateBeatParams) (*SessionBeat, error) {
	if p.Coherency == "" {
		p.Coherency = "{}"
	}
	if p.Status == "" {
		p.Status = "captured"
	}
	_, err := database.ExecContext(ctx,
		`UPDATE session_beats
		 SET note=?,status=?,title=?,description=?,outcome=?,notes=?,coherency=?,updated_at=CURRENT_TIMESTAMP
		 WHERE id=?`,
		p.Note, p.Status, p.Title, p.Description, p.Outcome, p.Notes, p.Coherency, id)
	if err != nil {
		return nil, err
	}
	return GetSessionBeat(ctx, database, id)
}

// MarkBeatAdopted records which scene a beat became.
func MarkBeatAdopted(ctx context.Context, database *sql.DB, id, sceneID string) (*SessionBeat, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE session_beats SET status='adopted', scene_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		sceneID, id)
	if err != nil {
		return nil, err
	}
	return GetSessionBeat(ctx, database, id)
}

func DeleteSessionBeat(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM session_beats WHERE id=?`, id)
	return err
}

// ShiftScenesFrom makes room at sortOrder by pushing every scene at or after it
// one step down, so an adopted beat can land immediately after its anchor
// rather than at the end of the list.
func ShiftScenesFrom(ctx context.Context, database *sql.DB, scenarioID string, sortOrder int) error {
	_, err := database.ExecContext(ctx,
		`UPDATE synopsis_scenes SET sort_order = sort_order + 1
		 WHERE scenario_id=? AND sort_order >= ?`, scenarioID, sortOrder)
	return err
}
