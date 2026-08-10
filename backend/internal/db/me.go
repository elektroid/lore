package db

import (
	"context"
	"database/sql"
)

// This file backs the player-facing "/api/me/runs" surface: an authenticated
// player looking at their own seats across every campaign, scoped strictly to
// their own account. See docs/adr/0001-runs-separate-story-from-play.md — a
// run's party (run_players) is the thing this reads, never the campaign's
// authored material.

// IsRunPlayer reports whether a user is seated in a run. Every /api/me/runs/{id}
// handler checks this and 404s rather than trusting the id in the URL — the
// same convention the GM-facing routes use for campaign/run ownership.
func IsRunPlayer(ctx context.Context, database *sql.DB, runID, userID string) (bool, error) {
	var n int
	err := database.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM run_players WHERE run_id = ? AND user_id = ?`, runID, userID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// PlayerRun is one row of a player's "Vos tables" list: a run they are seated
// in, with just enough of the campaign and their own character to identify it.
// No story content — this is the account-only surface.
type PlayerRun struct {
	RunID           string `json:"run_id"`
	RunName         string `json:"run_name"`
	Status          string `json:"status"`
	CampaignID      string `json:"campaign_id"`
	CampaignName    string `json:"campaign_name"`
	CharacterID     string `json:"character_id"`
	CharacterName   string `json:"character_name"`
	LastSessionDate string `json:"last_session_date"`
}

// ListRunsForPlayer returns every run a user is seated in, across every
// campaign, most recently active first.
func ListRunsForPlayer(ctx context.Context, database *sql.DB, userID string) ([]PlayerRun, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT r.id, r.name, r.status, c.id, c.name,
		       COALESCE(rp.character_id,''), COALESCE(pc.name,''),
		       COALESCE((SELECT s.date FROM sessions s
		                 WHERE s.run_id = r.id
		                 ORDER BY s.date DESC, s.created_at DESC LIMIT 1), '')
		FROM run_players rp
		JOIN runs r ON r.id = rp.run_id
		JOIN campaigns c ON c.id = r.campaign_id
		LEFT JOIN player_characters pc ON pc.id = rp.character_id
		WHERE rp.user_id = ?
		ORDER BY c.name, r.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []PlayerRun{}
	for rows.Next() {
		var p PlayerRun
		if err := rows.Scan(&p.RunID, &p.RunName, &p.Status, &p.CampaignID, &p.CampaignName,
			&p.CharacterID, &p.CharacterName, &p.LastSessionDate); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

// PlayerSession is a session as a seated player is allowed to see it: no scene,
// NPC or location reference, only what identifies the evening and, if the GM
// has shared it, the token to join it live.
type PlayerSession struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Date       string `json:"date"`
	TableToken string `json:"table_token"`
}

// PlayerRunDetail is the player-facing view of one run: identifying info,
// their own character, and the run's sessions stripped to non-spoiler fields.
type PlayerRunDetail struct {
	RunID         string          `json:"run_id"`
	RunName       string          `json:"run_name"`
	Status        string          `json:"status"`
	CampaignID    string          `json:"campaign_id"`
	CampaignName  string          `json:"campaign_name"`
	GameID        string          `json:"game_id"`
	CharacterID   string          `json:"character_id"`
	CharacterName string          `json:"character_name"`
	Sessions      []PlayerSession `json:"sessions"`
}

// GetRunForPlayer returns nil if the run does not exist. Callers must check
// IsRunPlayer first — this does not itself verify the caller is seated.
func GetRunForPlayer(ctx context.Context, database *sql.DB, runID, userID string) (*PlayerRunDetail, error) {
	var d PlayerRunDetail
	err := database.QueryRowContext(ctx, `
		SELECT r.id, r.name, r.status, c.id, c.name, COALESCE(c.game_id,''),
		       COALESCE(rp.character_id,''), COALESCE(pc.name,'')
		FROM runs r
		JOIN campaigns c ON c.id = r.campaign_id
		LEFT JOIN run_players rp ON rp.run_id = r.id AND rp.user_id = ?
		LEFT JOIN player_characters pc ON pc.id = rp.character_id
		WHERE r.id = ?`, userID, runID).
		Scan(&d.RunID, &d.RunName, &d.Status, &d.CampaignID, &d.CampaignName, &d.GameID,
			&d.CharacterID, &d.CharacterName)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	sessions, err := ListSessionsByRun(ctx, database, runID)
	if err != nil {
		return nil, err
	}
	d.Sessions = make([]PlayerSession, len(sessions))
	for i, s := range sessions {
		d.Sessions[i] = PlayerSession{ID: s.ID, Name: s.Name, Date: s.Date, TableToken: s.TableToken}
	}
	return &d, nil
}

// SetOwnRunCharacter lets a seated player pick their own character for a run —
// unlike SetRunPlayer (runs.go), this never reassigns which user is seated, and
// the caller must independently verify characterID belongs to userID
// (CharacterBelongsToUser) before calling this. An empty characterID clears
// the assignment.
func SetOwnRunCharacter(ctx context.Context, database *sql.DB, runID, userID, characterID string) error {
	var charID interface{}
	if characterID != "" {
		charID = characterID
	}
	_, err := database.ExecContext(ctx,
		`UPDATE run_players SET character_id=? WHERE run_id=? AND user_id=?`,
		charID, runID, userID)
	return err
}
