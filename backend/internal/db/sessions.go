package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type Session struct {
	ID               string `json:"id"`
	ScenarioID       string `json:"scenario_id"`
	Name             string `json:"name"`
	Date             string `json:"date"`
	Players          string `json:"players"` // JSON [{player_name, character_name}]
	ActiveLocationID string `json:"active_location_id"`
	ActiveSceneID    string `json:"active_scene_id"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

type SessionScene struct {
	SessionID string `json:"session_id"`
	SceneID   string `json:"scene_id"`
	State     string `json:"state"` // "cleared" | "void"
}

const sessionCols = `id, scenario_id, name, date, players,
	COALESCE(active_location_id,''), COALESCE(active_scene_id,''),
	created_at, updated_at`

func scanSession(row interface{ Scan(...any) error }) (*Session, error) {
	var s Session
	err := row.Scan(&s.ID, &s.ScenarioID, &s.Name, &s.Date, &s.Players,
		&s.ActiveLocationID, &s.ActiveSceneID, &s.CreatedAt, &s.UpdatedAt)
	return &s, err
}

func ListSessions(ctx context.Context, database *sql.DB, scenarioID string) ([]Session, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+sessionCols+` FROM sessions WHERE scenario_id=? ORDER BY date DESC, created_at DESC`, scenarioID)
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
	Name       string
	Date       string
}

func CreateSession(ctx context.Context, database *sql.DB, p CreateSessionParams) (*Session, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO sessions(id, scenario_id, name, date) VALUES(?,?,?,?)`,
		id, p.ScenarioID, p.Name, p.Date)
	if err != nil {
		return nil, err
	}
	return GetSession(ctx, database, id)
}

type UpdateSessionParams struct {
	ID               string
	Name             string
	Date             string
	Players          string
	ActiveLocationID string
	ActiveSceneID    string
}

func UpdateSession(ctx context.Context, database *sql.DB, p UpdateSessionParams) (*Session, error) {
	var locID, sceneID interface{}
	if p.ActiveLocationID != "" {
		locID = p.ActiveLocationID
	}
	if p.ActiveSceneID != "" {
		sceneID = p.ActiveSceneID
	}
	players := p.Players
	if players == "" {
		players = "[]"
	}
	_, err := database.ExecContext(ctx,
		`UPDATE sessions SET name=?,date=?,players=?,active_location_id=?,active_scene_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		p.Name, p.Date, players, locID, sceneID, p.ID)
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

// ── Session players ───────────────────────────────────────────────────────────

// SessionPlayer represents a user enrolled in a session, with their optional character.
type SessionPlayer struct {
	ID            string `json:"id"`
	SessionID     string `json:"session_id"`
	UserID        string `json:"user_id"`
	UserName      string `json:"user_name"`
	UserEmail     string `json:"user_email"`
	CharacterID   string `json:"character_id"`
	CharacterName string `json:"character_name"`
}

// ListSessionPlayers returns all players enrolled in a session.
func ListSessionPlayers(ctx context.Context, database *sql.DB, sessionID string) ([]SessionPlayer, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT sp.id, sp.session_id, sp.user_id, u.name, u.email,
		       COALESCE(sp.character_id,''), COALESCE(pc.name,'')
		FROM session_players sp
		JOIN users u ON u.id = sp.user_id
		LEFT JOIN player_characters pc ON pc.id = sp.character_id
		WHERE sp.session_id = ?
		ORDER BY u.name`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []SessionPlayer
	for rows.Next() {
		var p SessionPlayer
		if err := rows.Scan(&p.ID, &p.SessionID, &p.UserID, &p.UserName, &p.UserEmail,
			&p.CharacterID, &p.CharacterName); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	if list == nil {
		list = []SessionPlayer{}
	}
	return list, rows.Err()
}

// SetSessionPlayer upserts a player in a session, optionally assigning a character.
// Pass an empty characterID to clear the character assignment.
func SetSessionPlayer(ctx context.Context, database *sql.DB, sessionID, userID, characterID string) error {
	var charID interface{}
	if characterID != "" {
		charID = characterID
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO session_players(id, session_id, user_id, character_id)
		VALUES(?,?,?,?)
		ON CONFLICT(session_id, user_id) DO UPDATE SET character_id=excluded.character_id`,
		uuid.New().String(), sessionID, userID, charID)
	return err
}

// RemoveSessionPlayer removes a player from a session.
func RemoveSessionPlayer(ctx context.Context, database *sql.DB, sessionID, userID string) error {
	_, err := database.ExecContext(ctx,
		`DELETE FROM session_players WHERE session_id=? AND user_id=?`, sessionID, userID)
	return err
}
