package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

// A run is one group of players and their playthrough of a campaign. The
// campaign is authored once and meant to be played by several groups, so
// everything that belongs to a group lives here rather than on the story.
// See docs/adr/0001-runs-separate-story-from-play.md.
type Run struct {
	ID          string `json:"id"`
	CampaignID  string `json:"campaign_id"`
	Name        string `json:"name"`
	Notes       string `json:"notes"`
	Status      string `json:"status"` // active | finished | archived
	PlayerCount int    `json:"player_count"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// RunPlayer is one member of the party, with the character they play.
type RunPlayer struct {
	ID            string `json:"id"`
	RunID         string `json:"run_id"`
	UserID        string `json:"user_id"`
	UserName      string `json:"user_name"`
	UserEmail     string `json:"user_email"`
	CharacterID   string `json:"character_id"`
	CharacterName string `json:"character_name"`
}

const runCols = `r.id, r.campaign_id, r.name, r.notes, r.status,
	(SELECT COUNT(1) FROM run_players rp WHERE rp.run_id = r.id),
	r.created_at, r.updated_at`

func scanRun(row interface{ Scan(...any) error }) (*Run, error) {
	var r Run
	err := row.Scan(&r.ID, &r.CampaignID, &r.Name, &r.Notes, &r.Status,
		&r.PlayerCount, &r.CreatedAt, &r.UpdatedAt)
	return &r, err
}

func ListRuns(ctx context.Context, database *sql.DB, campaignID string) ([]Run, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+runCols+` FROM runs r WHERE r.campaign_id=? ORDER BY r.created_at`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Run
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *r)
	}
	if list == nil {
		list = []Run{}
	}
	return list, rows.Err()
}

func GetRun(ctx context.Context, database *sql.DB, id string) (*Run, error) {
	r, err := scanRun(database.QueryRowContext(ctx,
		`SELECT `+runCols+` FROM runs r WHERE r.id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return r, err
}

func CreateRun(ctx context.Context, database *sql.DB, campaignID, name string) (*Run, error) {
	id := uuid.New().String()
	if _, err := database.ExecContext(ctx,
		`INSERT INTO runs(id, campaign_id, name) VALUES(?,?,?)`, id, campaignID, name); err != nil {
		return nil, err
	}
	return GetRun(ctx, database, id)
}

type UpdateRunParams struct {
	ID     string
	Name   string
	Notes  string
	Status string
}

func UpdateRun(ctx context.Context, database *sql.DB, p UpdateRunParams) (*Run, error) {
	if _, err := database.ExecContext(ctx,
		`UPDATE runs SET name=?, notes=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		p.Name, p.Notes, p.Status, p.ID); err != nil {
		return nil, err
	}
	return GetRun(ctx, database, p.ID)
}

// DeleteRun removes the group and, by cascade, its sessions and everything
// recorded during them. The authored campaign is untouched — that is the whole
// point of the separation.
func DeleteRun(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM runs WHERE id=?`, id)
	return err
}

// ── Party ─────────────────────────────────────────────────────────────────────

func ListRunPlayers(ctx context.Context, database *sql.DB, runID string) ([]RunPlayer, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT rp.id, rp.run_id, rp.user_id, u.name, u.email,
		       COALESCE(rp.character_id,''), COALESCE(pc.name,'')
		FROM run_players rp
		JOIN users u ON u.id = rp.user_id
		LEFT JOIN player_characters pc ON pc.id = rp.character_id
		WHERE rp.run_id = ?
		ORDER BY u.name`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []RunPlayer
	for rows.Next() {
		var p RunPlayer
		if err := rows.Scan(&p.ID, &p.RunID, &p.UserID, &p.UserName, &p.UserEmail,
			&p.CharacterID, &p.CharacterName); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	if list == nil {
		list = []RunPlayer{}
	}
	return list, rows.Err()
}

// SetRunPlayer adds a player to the party or reassigns their character. An empty
// characterID clears the assignment.
func SetRunPlayer(ctx context.Context, database *sql.DB, runID, userID, characterID string) error {
	var charID interface{}
	if characterID != "" {
		charID = characterID
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO run_players(id, run_id, user_id, character_id)
		VALUES(?,?,?,?)
		ON CONFLICT(run_id, user_id) DO UPDATE SET character_id=excluded.character_id`,
		uuid.New().String(), runID, userID, charID)
	return err
}

func RemoveRunPlayer(ctx context.Context, database *sql.DB, runID, userID string) error {
	_, err := database.ExecContext(ctx,
		`DELETE FROM run_players WHERE run_id=? AND user_id=?`, runID, userID)
	return err
}

// ── Progress ──────────────────────────────────────────────────────────────────

// ListRunSceneStates returns how far a group has got in one scenario, as a map
// of scene id to state.
//
// Derived, never stored: a scene is played because an evening happened in which
// it was played, and session_scenes already records that. A run_scenes column
// would be a second copy of the same fact, free to drift the first time a
// session was deleted. See the ADR.
//
// A scene touched in more than one evening takes its most recent state, so
// re-running something the group had voided reads as cleared.
func ListRunSceneStates(ctx context.Context, database *sql.DB, runID, scenarioID string) (map[string]string, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT ss.scene_id, ss.state
		FROM session_scenes ss
		JOIN sessions s ON s.id = ss.session_id
		WHERE s.run_id = ? AND s.scenario_id = ?
		ORDER BY s.date, s.created_at`, runID, scenarioID)
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
		m[sceneID] = state // later evenings overwrite earlier ones
	}
	return m, rows.Err()
}

// RunInCampaign reports whether a run belongs to a campaign. Used where the run
// id arrives on a scenario-scoped route, which only proves the scenario.
func RunInCampaign(ctx context.Context, database *sql.DB, runID, campaignID string) (bool, error) {
	return ChildBelongsTo(ctx, database, TableRuns, ColCampaignID, runID, campaignID)
}
