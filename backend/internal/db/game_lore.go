package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

// ── Game lore entities ──────────────────────────────────────────────────────
//
// Structured facts extracted from a game system's sourcebooks (locations,
// factions, NPC archetypes, ...). Scoped to games, not campaigns: see the
// comment on the table in schema.sql.

type GameLoreEntity struct {
	ID          string `json:"id"`
	GameID      string `json:"game_id"`
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Tags        string `json:"tags"`
	Summary     string `json:"summary"`
	SourceTitle string `json:"source_title"`
	SourcePage  int    `json:"source_page"`
	CreatedAt   string `json:"created_at"`
}

const gameLoreEntityCols = `id, game_id, kind, name, tags, summary, source_title, source_page, created_at`

func scanGameLoreEntity(row interface{ Scan(...any) error }) (*GameLoreEntity, error) {
	var e GameLoreEntity
	err := row.Scan(&e.ID, &e.GameID, &e.Kind, &e.Name, &e.Tags, &e.Summary, &e.SourceTitle, &e.SourcePage, &e.CreatedAt)
	return &e, err
}

func ListGameLoreEntities(ctx context.Context, database *sql.DB, gameID string) ([]GameLoreEntity, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+gameLoreEntityCols+` FROM game_lore_entities WHERE game_id=? ORDER BY kind, name`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []GameLoreEntity
	for rows.Next() {
		e, err := scanGameLoreEntity(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *e)
	}
	if list == nil {
		list = []GameLoreEntity{}
	}
	return list, rows.Err()
}

type CreateGameLoreEntityParams struct {
	GameID      string
	Kind        string
	Name        string
	Tags        string
	Summary     string
	SourceTitle string
	SourcePage  int
}

func CreateGameLoreEntity(ctx context.Context, database *sql.DB, p CreateGameLoreEntityParams) (*GameLoreEntity, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO game_lore_entities(id, game_id, kind, name, tags, summary, source_title, source_page)
		 VALUES(?,?,?,?,?,?,?,?)`,
		id, p.GameID, p.Kind, p.Name, p.Tags, p.Summary, p.SourceTitle, p.SourcePage)
	if err != nil {
		return nil, err
	}
	e, err := scanGameLoreEntity(database.QueryRowContext(ctx,
		`SELECT `+gameLoreEntityCols+` FROM game_lore_entities WHERE id=?`, id))
	if err != nil {
		return nil, err
	}
	return e, nil
}

func DeleteGameLoreEntity(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM game_lore_entities WHERE id=?`, id)
	return err
}
