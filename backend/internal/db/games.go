package db

import (
	"context"
	"database/sql"
	"strings"
	"unicode"

	"github.com/google/uuid"
)

type Game struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	Slug              string  `json:"slug"`
	Genre             string  `json:"genre"`
	Description       string  `json:"description"`
	VisualStyle       string  `json:"visual_style"`
	MistralAgentID    string  `json:"mistral_agent_id"`
	SheetTemplateID   *string `json:"sheet_template_id"`
	SheetTemplateName string  `json:"sheet_template_name"`
	CreatedAt         string  `json:"created_at"`
}

const gameSelectCols = `g.id, g.name, g.slug, g.genre, g.description, g.visual_style, g.mistral_agent_id,
	       g.sheet_template_id, COALESCE(st.name, ''), g.created_at`

const gameSelectFrom = `FROM games g LEFT JOIN sheet_templates st ON st.id = g.sheet_template_id`

func scanGame(row interface{ Scan(...any) error }) (*Game, error) {
	var g Game
	err := row.Scan(&g.ID, &g.Name, &g.Slug, &g.Genre, &g.Description, &g.VisualStyle, &g.MistralAgentID,
		&g.SheetTemplateID, &g.SheetTemplateName, &g.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &g, err
}

func ListGames(ctx context.Context, database *sql.DB) ([]Game, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+gameSelectCols+` `+gameSelectFrom+` ORDER BY g.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Game
	for rows.Next() {
		g, err := scanGame(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *g)
	}
	if list == nil {
		list = []Game{}
	}
	return list, rows.Err()
}

func GetGame(ctx context.Context, database *sql.DB, id string) (*Game, error) {
	row := database.QueryRowContext(ctx,
		`SELECT `+gameSelectCols+` `+gameSelectFrom+` WHERE g.id = ?`, id)
	return scanGame(row)
}

func GetGameBySlug(ctx context.Context, database *sql.DB, slug string) (*Game, error) {
	row := database.QueryRowContext(ctx,
		`SELECT `+gameSelectCols+` `+gameSelectFrom+` WHERE g.slug = ?`, slug)
	return scanGame(row)
}

func CreateGame(ctx context.Context, database *sql.DB, name, slug, genre, description string, sheetTemplateID *string) (*Game, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO games (id, name, slug, genre, description, sheet_template_id) VALUES (?, ?, ?, ?, ?, ?)`,
		id, name, slug, genre, description, sheetTemplateID)
	if err != nil {
		return nil, err
	}
	return GetGame(ctx, database, id)
}

func UpdateGame(ctx context.Context, database *sql.DB, id, name, slug, genre, description string, sheetTemplateID *string) (*Game, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE games SET name=?, slug=?, genre=?, description=?, sheet_template_id=? WHERE id=?`,
		name, slug, genre, description, sheetTemplateID, id)
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
