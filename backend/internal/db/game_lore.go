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
	Excerpt     string `json:"excerpt"`
	SourceTitle string `json:"source_title"`
	SourcePage  int    `json:"source_page"`
	CreatedAt   string `json:"created_at"`
}

const gameLoreEntityCols = `id, game_id, kind, name, tags, summary, excerpt, source_title, source_page, created_at`

func scanGameLoreEntity(row interface{ Scan(...any) error }) (*GameLoreEntity, error) {
	var e GameLoreEntity
	err := row.Scan(&e.ID, &e.GameID, &e.Kind, &e.Name, &e.Tags, &e.Summary, &e.Excerpt, &e.SourceTitle, &e.SourcePage, &e.CreatedAt)
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
	Excerpt     string
	SourceTitle string
	SourcePage  int
}

func CreateGameLoreEntity(ctx context.Context, database *sql.DB, p CreateGameLoreEntityParams) (*GameLoreEntity, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO game_lore_entities(id, game_id, kind, name, tags, summary, excerpt, source_title, source_page)
		 VALUES(?,?,?,?,?,?,?,?,?)`,
		id, p.GameID, p.Kind, p.Name, p.Tags, p.Summary, p.Excerpt, p.SourceTitle, p.SourcePage)
	if err != nil {
		return nil, err
	}
	return scanGameLoreEntity(database.QueryRowContext(ctx,
		`SELECT `+gameLoreEntityCols+` FROM game_lore_entities WHERE id=?`, id))
}

// UpsertGameLoreEntity is what the sourcebook indexer uses instead of Create.
// It matches on (game_id, source_title, name) case-insensitively — kind is
// deliberately NOT part of the match. Testing against the real Night City
// PDF turned up the same entity classified as "faction" from one chunk and
// "district" from the overlapping next one; matching on kind too would have
// let that inconsistency silently fork one entity into two rows. Leaving it
// out means a later, hopefully-better classification simply overwrites the
// earlier one — solving both re-indexing the same book (updates in place
// instead of piling up duplicates) and the same entity re-detected from
// overlapping chunks (refines one row instead of creating a second).
func UpsertGameLoreEntity(ctx context.Context, database *sql.DB, p CreateGameLoreEntityParams) (*GameLoreEntity, error) {
	var existingID string
	err := database.QueryRowContext(ctx,
		`SELECT id FROM game_lore_entities
		 WHERE game_id=? AND source_title=? AND lower(name)=lower(?)`,
		p.GameID, p.SourceTitle, p.Name).Scan(&existingID)
	switch {
	case err == sql.ErrNoRows:
		return CreateGameLoreEntity(ctx, database, p)
	case err != nil:
		return nil, err
	}
	_, err = database.ExecContext(ctx,
		`UPDATE game_lore_entities SET kind=?, tags=?, summary=?, excerpt=?, source_page=? WHERE id=?`,
		p.Kind, p.Tags, p.Summary, p.Excerpt, p.SourcePage, existingID)
	if err != nil {
		return nil, err
	}
	return scanGameLoreEntity(database.QueryRowContext(ctx,
		`SELECT `+gameLoreEntityCols+` FROM game_lore_entities WHERE id=?`, existingID))
}

func DeleteGameLoreEntity(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM game_lore_entities WHERE id=?`, id)
	return err
}
