package db

import (
	"context"
	"database/sql"
	"strings"
	"unicode"

	"github.com/google/uuid"
)

type Game struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Slug            string `json:"slug"`
	VisualStyle     string `json:"visual_style"`
	MistralAgentID  string `json:"mistral_agent_id"`
	CreatedAt       string `json:"created_at"`
}

func ListGames(ctx context.Context, database *sql.DB) ([]Game, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, name, slug, visual_style, mistral_agent_id, created_at FROM games ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Game
	for rows.Next() {
		var g Game
		if err := rows.Scan(&g.ID, &g.Name, &g.Slug, &g.VisualStyle, &g.MistralAgentID, &g.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, g)
	}
	if list == nil {
		list = []Game{}
	}
	return list, rows.Err()
}

func GetGame(ctx context.Context, database *sql.DB, id string) (*Game, error) {
	var g Game
	err := database.QueryRowContext(ctx,
		`SELECT id, name, slug, visual_style, mistral_agent_id, created_at FROM games WHERE id = ?`, id).
		Scan(&g.ID, &g.Name, &g.Slug, &g.VisualStyle, &g.MistralAgentID, &g.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &g, err
}

func CreateGame(ctx context.Context, database *sql.DB, name, slug string) (*Game, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO games (id, name, slug) VALUES (?, ?, ?)`, id, name, slug)
	if err != nil {
		return nil, err
	}
	return GetGame(ctx, database, id)
}

func UpdateGame(ctx context.Context, database *sql.DB, id, name, slug string) (*Game, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE games SET name=?, slug=? WHERE id=?`, name, slug, id)
	if err != nil {
		return nil, err
	}
	return GetGame(ctx, database, id)
}

func UpdateGameVisualStyle(ctx context.Context, database *sql.DB, id, visualStyle string) (*Game, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE games SET visual_style=?, mistral_agent_id='' WHERE id=?`, visualStyle, id)
	if err != nil {
		return nil, err
	}
	return GetGame(ctx, database, id)
}

func UpdateGameMistralAgent(ctx context.Context, database *sql.DB, id, agentID string) error {
	_, err := database.ExecContext(ctx,
		`UPDATE games SET mistral_agent_id=? WHERE id=?`, agentID, id)
	return err
}

func DeleteGame(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM games WHERE id=?`, id)
	return err
}

// MigrateGameText converts free-text campaign.game values into games rows
// and sets campaign.game_id accordingly. Safe to run multiple times.
func MigrateGameText(ctx context.Context, database *sql.DB) error {
	rows, err := database.QueryContext(ctx,
		`SELECT id, game FROM campaigns WHERE game != '' AND game_id = ''`)
	if err != nil {
		return err
	}
	type pair struct{ id, game string }
	var pairs []pair
	for rows.Next() {
		var p pair
		if err := rows.Scan(&p.id, &p.game); err != nil {
			rows.Close()
			return err
		}
		pairs = append(pairs, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, p := range pairs {
		var gameID string
		err := database.QueryRowContext(ctx,
			`SELECT id FROM games WHERE name = ?`, p.game).Scan(&gameID)
		if err == sql.ErrNoRows {
			id := uuid.New().String()
			slug := slugify(p.game)
			database.ExecContext(ctx, //nolint:errcheck
				`INSERT OR IGNORE INTO games (id, name, slug) VALUES (?, ?, ?)`, id, p.game, slug)
			database.QueryRowContext(ctx, //nolint:errcheck
				`SELECT id FROM games WHERE name = ?`, p.game).Scan(&gameID)
			if gameID == "" {
				gameID = id
			}
		} else if err != nil {
			return err
		}
		if _, err := database.ExecContext(ctx,
			`UPDATE campaigns SET game_id = ? WHERE id = ?`, gameID, p.id); err != nil {
			return err
		}
	}
	return nil
}

func slugify(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else {
			b.WriteRune('-')
		}
	}
	result := b.String()
	for strings.HasPrefix(result, "-") {
		result = result[1:]
	}
	for strings.HasSuffix(result, "-") {
		result = result[:len(result)-1]
	}
	return result
}
