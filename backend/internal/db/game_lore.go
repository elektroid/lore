package db

import (
	"context"
	"database/sql"
	"strings"

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

// ListGameLoreEntitiesPage is what the browse UI uses instead of
// ListGameLoreEntities: a game can carry thousands of rows (Night City 2045
// alone indexed 2000+), so the client filters/paginates against the
// database rather than pulling everything over the wire every time. kind
// and query are both optional (empty string = no filter on that field);
// query matches name/tags/summary via a case-insensitive substring search.
func ListGameLoreEntitiesPage(ctx context.Context, database *sql.DB, gameID, kind, query string, limit, offset int) ([]GameLoreEntity, int, error) {
	where := `game_id=?`
	args := []any{gameID}
	if kind != "" {
		where += ` AND kind=?`
		args = append(args, kind)
	}
	if query != "" {
		where += ` AND (name LIKE ? ESCAPE '\' OR tags LIKE ? ESCAPE '\' OR summary LIKE ? ESCAPE '\')`
		like := `%` + escapeLike(query) + `%`
		args = append(args, like, like, like)
	}

	var total int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM game_lore_entities WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := database.QueryContext(ctx,
		`SELECT `+gameLoreEntityCols+` FROM game_lore_entities WHERE `+where+` ORDER BY kind, name LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var list []GameLoreEntity
	for rows.Next() {
		e, err := scanGameLoreEntity(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, *e)
	}
	if list == nil {
		list = []GameLoreEntity{}
	}
	return list, total, rows.Err()
}

// escapeLike escapes SQLite LIKE wildcards in user input so a search for
// e.g. "50%" or "under_ground" doesn't get interpreted as a pattern.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// CountGameLoreEntitiesByKind powers the browse UI's filter chips ("Faction
// (281)") without pulling every row just to count them client-side.
func CountGameLoreEntitiesByKind(ctx context.Context, database *sql.DB, gameID string) (map[string]int, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT kind, COUNT(*) FROM game_lore_entities WHERE game_id=? GROUP BY kind`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var kind string
		var n int
		if err := rows.Scan(&kind, &n); err != nil {
			return nil, err
		}
		counts[kind] = n
	}
	return counts, rows.Err()
}

func GetGameLoreEntity(ctx context.Context, database *sql.DB, id string) (*GameLoreEntity, error) {
	e, err := scanGameLoreEntity(database.QueryRowContext(ctx,
		`SELECT `+gameLoreEntityCols+` FROM game_lore_entities WHERE id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return e, err
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

// FindGameLoreEntityIDByName looks up an entity the same way
// UpsertGameLoreEntity matches for updates: by (game, source, name)
// case-insensitively, ignoring kind. Used to resolve relation endpoints,
// which the extractor gives us as plain names.
func FindGameLoreEntityIDByName(ctx context.Context, database *sql.DB, gameID, sourceTitle, name string) (string, error) {
	var id string
	err := database.QueryRowContext(ctx,
		`SELECT id FROM game_lore_entities WHERE game_id=? AND source_title=? AND lower(name)=lower(?)`,
		gameID, sourceTitle, name).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return id, err
}

// RelatedEntityLink is one relation shown from a single entity's point of
// view, with the *other* end's name/kind embedded so the browse UI's detail
// view can render and link to it without ever having loaded the full entity
// list — needed now that ListGameLoreEntitiesPage no longer does that.
type RelatedEntityLink struct {
	RelationID string `json:"relation_id"`
	Relation   string `json:"relation"`
	EntityID   string `json:"entity_id"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
}

// ListGameLoreEntityRelationsFor returns this entity's relations split by
// direction: outgoing (this entity is from_entity_id) and incoming (this
// entity is to_entity_id).
func ListGameLoreEntityRelationsFor(ctx context.Context, database *sql.DB, entityID string) (outgoing, incoming []RelatedEntityLink, err error) {
	outRows, err := database.QueryContext(ctx,
		`SELECT r.id, r.relation, e.id, e.name, e.kind
		 FROM game_lore_entity_relations r JOIN game_lore_entities e ON e.id = r.to_entity_id
		 WHERE r.from_entity_id=? ORDER BY r.relation`, entityID)
	if err != nil {
		return nil, nil, err
	}
	defer outRows.Close()
	for outRows.Next() {
		var l RelatedEntityLink
		if err := outRows.Scan(&l.RelationID, &l.Relation, &l.EntityID, &l.Name, &l.Kind); err != nil {
			return nil, nil, err
		}
		outgoing = append(outgoing, l)
	}
	if err := outRows.Err(); err != nil {
		return nil, nil, err
	}

	inRows, err := database.QueryContext(ctx,
		`SELECT r.id, r.relation, e.id, e.name, e.kind
		 FROM game_lore_entity_relations r JOIN game_lore_entities e ON e.id = r.from_entity_id
		 WHERE r.to_entity_id=? ORDER BY r.relation`, entityID)
	if err != nil {
		return nil, nil, err
	}
	defer inRows.Close()
	for inRows.Next() {
		var l RelatedEntityLink
		if err := inRows.Scan(&l.RelationID, &l.Relation, &l.EntityID, &l.Name, &l.Kind); err != nil {
			return nil, nil, err
		}
		incoming = append(incoming, l)
	}
	if outgoing == nil {
		outgoing = []RelatedEntityLink{}
	}
	if incoming == nil {
		incoming = []RelatedEntityLink{}
	}
	return outgoing, incoming, inRows.Err()
}

// ── Game lore entity relations ──────────────────────────────────────────────

type GameLoreEntityRelation struct {
	ID           string `json:"id"`
	GameID       string `json:"game_id"`
	FromEntityID string `json:"from_entity_id"`
	ToEntityID   string `json:"to_entity_id"`
	Relation     string `json:"relation"`
	SourceTitle  string `json:"source_title"`
	SourcePage   int    `json:"source_page"`
	CreatedAt    string `json:"created_at"`
}

func ListGameLoreEntityRelations(ctx context.Context, database *sql.DB, gameID string) ([]GameLoreEntityRelation, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, game_id, from_entity_id, to_entity_id, relation, source_title, source_page, created_at
		 FROM game_lore_entity_relations WHERE game_id=? ORDER BY relation`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []GameLoreEntityRelation
	for rows.Next() {
		var r GameLoreEntityRelation
		if err := rows.Scan(&r.ID, &r.GameID, &r.FromEntityID, &r.ToEntityID, &r.Relation, &r.SourceTitle, &r.SourcePage, &r.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	if list == nil {
		list = []GameLoreEntityRelation{}
	}
	return list, rows.Err()
}

type CreateGameLoreEntityRelationParams struct {
	GameID       string
	FromEntityID string
	ToEntityID   string
	Relation     string
	SourceTitle  string
	SourcePage   int
}

// UpsertGameLoreEntityRelation relies on the (from_entity_id, relation,
// to_entity_id) UNIQUE constraint: re-indexing the same book, or the same
// relation turning up again from an overlapping chunk, refreshes source_page
// in place instead of piling up duplicate rows.
func UpsertGameLoreEntityRelation(ctx context.Context, database *sql.DB, p CreateGameLoreEntityRelationParams) error {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO game_lore_entity_relations(id, game_id, from_entity_id, to_entity_id, relation, source_title, source_page)
		 VALUES(?,?,?,?,?,?,?)
		 ON CONFLICT(from_entity_id, relation, to_entity_id)
		 DO UPDATE SET source_page=excluded.source_page`,
		id, p.GameID, p.FromEntityID, p.ToEntityID, p.Relation, p.SourceTitle, p.SourcePage)
	return err
}
