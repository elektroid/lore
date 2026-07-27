package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"

	"github.com/google/uuid"
)

// Projection is the single thing currently shown on a session's table screen.
// It stores a resolved image URL rather than an entity reference: the table
// surface must never need entity read access, and what is on screen should not
// change because the GM edited a location mid-session.
type Projection struct {
	Kind     string `json:"kind"` // "" (idle) | "image" | "text"
	URL      string `json:"url"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
}

// ParseProjection decodes a sessions.projection column, tolerating legacy or
// corrupt values by falling back to idle.
func ParseProjection(raw string) Projection {
	var p Projection
	if raw == "" {
		return p
	}
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return Projection{}
	}
	if p.Kind != "image" && p.Kind != "text" {
		p.Kind = ""
	}
	return p
}

// SetProjection replaces what the table screen shows.
func SetProjection(ctx context.Context, database *sql.DB, sessionID string, p Projection) error {
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = database.ExecContext(ctx,
		`UPDATE sessions SET projection=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		string(b), sessionID)
	return err
}

// ── Table token ───────────────────────────────────────────────────────────────

// EnsureTableToken returns the session's share token, minting one on first use.
// Pass regenerate to mint a fresh token, which invalidates every link already
// handed out.
func EnsureTableToken(ctx context.Context, database *sql.DB, sessionID string, regenerate bool) (string, error) {
	if !regenerate {
		var existing string
		err := database.QueryRowContext(ctx,
			`SELECT COALESCE(table_token,'') FROM sessions WHERE id=?`, sessionID).Scan(&existing)
		if err != nil {
			return "", err
		}
		if existing != "" {
			return existing, nil
		}
	}

	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)

	if _, err := database.ExecContext(ctx,
		`UPDATE sessions SET table_token=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		token, sessionID); err != nil {
		return "", err
	}
	return token, nil
}

// TableSession is what a token resolves to: enough to render the table header,
// and nothing about the scenario's contents.
type TableSession struct {
	SessionID    string `json:"session_id"`
	ScenarioID   string `json:"scenario_id"`
	SessionName  string `json:"session_name"`
	ScenarioName string `json:"scenario_name"`
	CampaignName string `json:"campaign_name"`
	Projection   string `json:"-"`
}

// GetSessionByTableToken resolves a share token. Returns nil when the token is
// unknown — callers must not distinguish "no such token" from "expired".
func GetSessionByTableToken(ctx context.Context, database *sql.DB, token string) (*TableSession, error) {
	if token == "" {
		return nil, nil
	}
	var t TableSession
	err := database.QueryRowContext(ctx, `
		SELECT s.id, s.scenario_id, s.name, sc.name, c.name,
		       COALESCE(NULLIF(s.projection,''),'{}')
		FROM sessions s
		JOIN scenarios sc ON sc.id = s.scenario_id
		JOIN campaigns  c ON c.id  = sc.campaign_id
		WHERE s.table_token = ?`, token).
		Scan(&t.SessionID, &t.ScenarioID, &t.SessionName, &t.ScenarioName, &t.CampaignName, &t.Projection)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &t, err
}

// ── Rolls ─────────────────────────────────────────────────────────────────────

// Roll is one dice roll made during a session.
type Roll struct {
	ID        string `json:"id"`
	SessionID string `json:"session_id"`
	Actor     string `json:"actor"`      // display name — 'MJ', a character, a free-form seat
	ActorKind string `json:"actor_kind"` // "gm" | "player"
	Notation  string `json:"notation"`
	Label     string `json:"label"`
	Detail    string `json:"detail"`
	Total     int    `json:"total"`
	Secret    bool   `json:"secret"`
	CreatedAt string `json:"created_at"`
}

const rollCols = `id, session_id, actor, actor_kind, notation, label, detail, total, secret, created_at`

// CreateRoll persists an already-evaluated roll.
func CreateRoll(ctx context.Context, database *sql.DB, r Roll) (*Roll, error) {
	r.ID = uuid.New().String()
	secret := 0
	if r.Secret {
		secret = 1
	}
	_, err := database.ExecContext(ctx,
		`INSERT INTO session_rolls(id, session_id, actor, actor_kind, notation, label, detail, total, secret)
		 VALUES(?,?,?,?,?,?,?,?,?)`,
		r.ID, r.SessionID, r.Actor, r.ActorKind, r.Notation, r.Label, r.Detail, r.Total, secret)
	if err != nil {
		return nil, err
	}

	out := r
	if err := database.QueryRowContext(ctx,
		`SELECT created_at FROM session_rolls WHERE id=?`, r.ID).Scan(&out.CreatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListRolls returns a session's rolls, newest first. Pass includeSecret=false
// for anything reaching the table or a player seat — secret GM rolls must never
// leave the console.
func ListRolls(ctx context.Context, database *sql.DB, sessionID string, includeSecret bool, limit int) ([]Roll, error) {
	if limit <= 0 {
		limit = 50
	}
	q := `SELECT ` + rollCols + ` FROM session_rolls WHERE session_id=?`
	if !includeSecret {
		q += ` AND secret=0`
	}
	q += ` ORDER BY created_at DESC, rowid DESC LIMIT ?`

	rows, err := database.QueryContext(ctx, q, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Roll
	for rows.Next() {
		var r Roll
		var secret int
		if err := rows.Scan(&r.ID, &r.SessionID, &r.Actor, &r.ActorKind, &r.Notation,
			&r.Label, &r.Detail, &r.Total, &secret, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.Secret = secret == 1
		list = append(list, r)
	}
	if list == nil {
		list = []Roll{}
	}
	return list, rows.Err()
}

// Seat is a player name offered by the table surface's seat picker. Deliberately
// name-only: the public snapshot must not leak user emails or IDs.
type Seat struct {
	Name string `json:"name"`
}

// ListSeats returns the display names of the session's enrolled players,
// preferring the character name over the account name.
func ListSeats(ctx context.Context, database *sql.DB, sessionID string) ([]Seat, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT COALESCE(NULLIF(pc.name,''), u.name)
		FROM session_players sp
		JOIN users u ON u.id = sp.user_id
		LEFT JOIN player_characters pc ON pc.id = sp.character_id
		WHERE sp.session_id = ?
		ORDER BY 1`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Seat
	for rows.Next() {
		var s Seat
		if err := rows.Scan(&s.Name); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	if list == nil {
		list = []Seat{}
	}
	return list, rows.Err()
}
