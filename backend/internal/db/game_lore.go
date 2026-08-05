package db

import (
	"context"
	"database/sql"
	"sort"
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

// ── Dedup: merging entities the extractor forked into near-duplicates ──────
//
// The extractor names an entity however the source text happens to name it
// on a given page — "Ortega", "Emilia Ortega" and "City Manager Ortega" are
// all the same NPC, but UpsertGameLoreEntity only collapses *exact*
// (case-insensitive) name matches, so name variants fork into separate rows.
// See cmd/dedup-lore-entities for the clustering/LLM-verification pass that
// decides which rows are actually the same entity; this is just the merge
// primitive it calls once it has decided.

// MergeGameLoreEntities folds duplicateIDs into canonicalID: tags are
// unioned, summary/excerpt fall back to the richest non-empty value across
// the group, every relation touching a duplicate is re-pointed at the
// canonical (dropped instead if that would collide with the canonical's own
// (from, relation, to) UNIQUE constraint, or would become a self-loop), and
// the duplicate rows are deleted. Runs as one transaction so a failure
// midway leaves the group untouched rather than half-merged.
func MergeGameLoreEntities(ctx context.Context, database *sql.DB, canonicalID string, duplicateIDs []string) error {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	canonical, err := scanGameLoreEntity(tx.QueryRowContext(ctx,
		`SELECT `+gameLoreEntityCols+` FROM game_lore_entities WHERE id=?`, canonicalID))
	if err != nil {
		return err
	}

	tagSet := map[string]bool{}
	for _, t := range strings.Fields(canonical.Tags) {
		tagSet[t] = true
	}
	summary, excerpt := canonical.Summary, canonical.Excerpt

	for _, dupID := range duplicateIDs {
		if dupID == canonicalID {
			continue
		}
		dup, err := scanGameLoreEntity(tx.QueryRowContext(ctx,
			`SELECT `+gameLoreEntityCols+` FROM game_lore_entities WHERE id=?`, dupID))
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return err
		}
		for _, t := range strings.Fields(dup.Tags) {
			tagSet[t] = true
		}
		if len(dup.Summary) > len(summary) {
			summary = dup.Summary
		}
		if excerpt == "" {
			excerpt = dup.Excerpt
		}

		if err := repointRelationEndpoint(ctx, tx, "from_entity_id", dupID, canonicalID); err != nil {
			return err
		}
		if err := repointRelationEndpoint(ctx, tx, "to_entity_id", dupID, canonicalID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM game_lore_entities WHERE id=?`, dupID); err != nil {
			return err
		}
	}

	// A relation that used to run between two members of this cluster (e.g.
	// a stray "Ortega" -> "Emilia Ortega" row) becomes a self-loop once both
	// ends repoint to the same canonical ID — drop it.
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM game_lore_entity_relations WHERE from_entity_id=? AND to_entity_id=?`,
		canonicalID, canonicalID); err != nil {
		return err
	}

	tags := make([]string, 0, len(tagSet))
	for t := range tagSet {
		tags = append(tags, t)
	}
	sort.Strings(tags)
	if _, err := tx.ExecContext(ctx,
		`UPDATE game_lore_entities SET tags=?, summary=?, excerpt=? WHERE id=?`,
		strings.Join(tags, " "), summary, excerpt, canonicalID); err != nil {
		return err
	}

	return tx.Commit()
}

// repointRelationEndpoint moves every relation's col (from_entity_id or
// to_entity_id) that points at fromID over to toID, one row at a time: a row
// that would collide with another relation's (from, relation, to) after the
// move gets deleted instead of erroring the whole merge, since the canonical
// already carries the equivalent fact.
func repointRelationEndpoint(ctx context.Context, tx *sql.Tx, col, fromID, toID string) error {
	rows, err := tx.QueryContext(ctx,
		`SELECT id, from_entity_id, to_entity_id, relation FROM game_lore_entity_relations WHERE `+col+`=?`, fromID)
	if err != nil {
		return err
	}
	type relRow struct{ id, from, to, relation string }
	var list []relRow
	for rows.Next() {
		var r relRow
		if err := rows.Scan(&r.id, &r.from, &r.to, &r.relation); err != nil {
			rows.Close()
			return err
		}
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, r := range list {
		newFrom, newTo := r.from, r.to
		if col == "from_entity_id" {
			newFrom = toID
		} else {
			newTo = toID
		}
		if newFrom == newTo {
			if _, err := tx.ExecContext(ctx, `DELETE FROM game_lore_entity_relations WHERE id=?`, r.id); err != nil {
				return err
			}
			continue
		}
		var exists int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM game_lore_entity_relations WHERE from_entity_id=? AND relation=? AND to_entity_id=? AND id<>?`,
			newFrom, r.relation, newTo, r.id).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			if _, err := tx.ExecContext(ctx, `DELETE FROM game_lore_entity_relations WHERE id=?`, r.id); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE game_lore_entity_relations SET from_entity_id=?, to_entity_id=? WHERE id=?`,
			newFrom, newTo, r.id); err != nil {
			return err
		}
	}
	return nil
}

// ── Grounding LLM prompts in indexed sourcebook facts ───────────────────────
//
// Story-writing features (scenario factory, synopsis/NPC/faction/location/
// artefact suggestions, brainstorm chat) can draw on whatever's been indexed
// for the campaign's game system, so a generated NPC's faction or a scene's
// district isn't invented from nothing when the sourcebook already has an
// answer. There's no embedding index in this project, so retrieval is a
// keyword-overlap search rather than semantic — good enough to surface "the
// Downtown district" when a brief mentions "corpo bar downtown", not a
// general-purpose search engine.

// stopWords are filtered out of query text before keyword search — short
// function words in French (prompts are authored in French) and English
// (sourcebook content is English) that would otherwise match almost every
// entity and drown out the words that actually distinguish one from another.
var stopWords = map[string]bool{
	"the": true, "and": true, "for": true, "with": true, "from": true, "that": true,
	"this": true, "have": true, "will": true, "your": true, "into": true, "their": true,
	"about": true, "which": true, "there": true, "where": true, "when": true,
	"le": true, "la": true, "les": true, "un": true, "une": true, "des": true,
	"de": true, "du": true, "et": true, "est": true, "sont": true, "dans": true,
	"pour": true, "avec": true, "sur": true, "qui": true, "que": true, "quoi": true,
	"son": true, "sa": true, "ses": true, "leur": true, "leurs": true, "plus": true,
	"pas": true, "cette": true, "ces": true, "vers": true, "chez": true,
}

// extractKeywords lowercases queryText, splits on anything that isn't a
// letter or digit, and keeps distinct tokens of at least 4 characters that
// aren't stop words — short enough to still catch "gang", "corp", long
// enough to skip most filler.
func extractKeywords(queryText string) []string {
	fields := strings.FieldsFunc(strings.ToLower(queryText), func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r >= 'à' && r <= 'ÿ')
	})
	seen := map[string]bool{}
	var keywords []string
	for _, f := range fields {
		if len(f) < 4 || stopWords[f] || seen[f] {
			continue
		}
		seen[f] = true
		keywords = append(keywords, f)
	}
	return keywords
}

// SearchGameLoreEntities ranks entities by how many distinct keywords from
// queryText appear in their name/tags/summary, descending, and returns the
// top `limit`. Returns an empty slice (not an error) when queryText yields
// no usable keywords or nothing matches — callers should treat this as "no
// grounding available" and proceed without it, never as a hard failure.
func SearchGameLoreEntities(ctx context.Context, database *sql.DB, gameID, queryText string, limit int) ([]GameLoreEntity, error) {
	keywords := extractKeywords(queryText)
	if len(keywords) == 0 {
		return []GameLoreEntity{}, nil
	}

	where := make([]string, 0, len(keywords))
	args := []any{gameID}
	for _, k := range keywords {
		like := `%` + escapeLike(k) + `%`
		where = append(where, `(name LIKE ? ESCAPE '\' OR tags LIKE ? ESCAPE '\' OR summary LIKE ? ESCAPE '\')`)
		args = append(args, like, like, like)
	}
	query := `SELECT ` + gameLoreEntityCols + ` FROM game_lore_entities WHERE game_id=? AND (` +
		strings.Join(where, " OR ") + `) LIMIT 300`

	rows, err := database.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var candidates []GameLoreEntity
	for rows.Next() {
		e, err := scanGameLoreEntity(rows)
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, *e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	type scored struct {
		entity GameLoreEntity
		score  int
	}
	results := make([]scored, 0, len(candidates))
	for _, e := range candidates {
		haystack := strings.ToLower(e.Name + " " + e.Tags + " " + e.Summary)
		score := 0
		for _, k := range keywords {
			if strings.Contains(haystack, k) {
				score++
			}
		}
		if score > 0 {
			results = append(results, scored{e, score})
		}
	}
	sort.Slice(results, func(i, j int) bool {
		if results[i].score != results[j].score {
			return results[i].score > results[j].score
		}
		return results[i].entity.Name < results[j].entity.Name
	})
	if len(results) > limit {
		results = results[:limit]
	}
	out := make([]GameLoreEntity, len(results))
	for i, r := range results {
		out[i] = r.entity
	}
	return out, nil
}
