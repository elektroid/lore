package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// ArchivedCampaign is the denormalized listing row for an archived campaign —
// enough to render and permission-filter an archive list without touching the
// (potentially large) snapshot JSON in the `data` column.
type ArchivedCampaign struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	GameName   string `json:"game_name"`
	OwnerID    string `json:"owner_id"`
	OwnerName  string `json:"owner_name"`
	ArchivedBy string `json:"archived_by"`
	ArchivedAt string `json:"archived_at"`
}

// campaignSnapshotDoc is the shape stored in archived_campaigns.data: every
// row belonging to the campaign, across every table in its cascade, keyed by
// table name. It deliberately does not include the campaigns row itself —
// that's already denormalized into ArchivedCampaign's own columns.
type campaignSnapshotDoc struct {
	Version int                         `json:"version"`
	Tables  map[string][]map[string]any `json:"tables"`
}

// dumpRows runs query and returns each row as a column-name -> value map.
// This keeps SnapshotCampaign resilient to schema drift: a column added to
// any archived table shows up in future archives automatically, unlike the
// hand-listed export structs in handlers/campaigns.go which silently drop new
// fields until someone remembers to update them.
func dumpRows(ctx context.Context, database *sql.DB, query string, args ...any) ([]map[string]any, error) {
	rows, err := database.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(cols))
		for i, col := range cols {
			if b, ok := values[i].([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = values[i]
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func placeholders(n int) string {
	ph := make([]string, n)
	for i := range ph {
		ph[i] = "?"
	}
	return strings.Join(ph, ",")
}

// idColumn pulls a string column out of dumped rows, for chaining into the
// next level's WHERE ... IN (...) query.
func idColumn(rows []map[string]any, col string) []string {
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		if v, ok := r[col].(string); ok && v != "" {
			ids = append(ids, v)
		}
	}
	return ids
}

// snapshotBuilder accumulates dumped tables and short-circuits further work
// once a query fails, so SnapshotCampaign can read as a flat list of steps
// instead of an if-err chain.
type snapshotBuilder struct {
	ctx    context.Context
	db     *sql.DB
	tables map[string][]map[string]any
	err    error
}

func (b *snapshotBuilder) dump(name, query string, args ...any) []map[string]any {
	if b.err != nil {
		return nil
	}
	rows, err := dumpRows(b.ctx, b.db, query, args...)
	if err != nil {
		b.err = fmt.Errorf("archive: dump %s: %w", name, err)
		return nil
	}
	if len(rows) > 0 {
		b.tables[name] = rows
	}
	return rows
}

// dumpByIDs dumps every row of table `name` whose `idCol` is in `ids`. The
// table name is always one of the hardcoded literals below, never caller
// input, so building the query with fmt.Sprintf is safe.
func (b *snapshotBuilder) dumpByIDs(name, idCol string, ids []string) []map[string]any {
	if len(ids) == 0 || b.err != nil {
		return nil
	}
	query := fmt.Sprintf(`SELECT * FROM %s WHERE %s IN (%s)`, name, idCol, placeholders(len(ids)))
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return b.dump(name, query, args...)
}

// SnapshotCampaign walks the full FK cascade hanging off a campaign (see
// schema.sql) and returns one JSON document covering every row that
// `DELETE FROM campaigns WHERE id=?` would cascade-delete. Order matters:
// each level collects the IDs the next level's WHERE ... IN (...) needs.
func SnapshotCampaign(ctx context.Context, database *sql.DB, campaignID string) ([]byte, error) {
	b := &snapshotBuilder{ctx: ctx, db: database, tables: map[string][]map[string]any{}}

	// Level 1: keyed directly on campaign_id.
	scenarios := b.dump("scenarios", `SELECT * FROM scenarios WHERE campaign_id=?`, campaignID)
	scenarioIDs := idColumn(scenarios, "id")

	b.dump("scenario_drafts", `SELECT * FROM scenario_drafts WHERE campaign_id=?`, campaignID)

	npcs := b.dump("campaign_npcs", `SELECT * FROM campaign_npcs WHERE campaign_id=?`, campaignID)
	npcIDs := idColumn(npcs, "id")

	b.dump("campaign_locations", `SELECT * FROM campaign_locations WHERE campaign_id=?`, campaignID)
	b.dump("campaign_artefacts", `SELECT * FROM campaign_artefacts WHERE campaign_id=?`, campaignID)

	factions := b.dump("campaign_factions", `SELECT * FROM campaign_factions WHERE campaign_id=?`, campaignID)
	factionIDs := idColumn(factions, "id")

	runs := b.dump("runs", `SELECT * FROM runs WHERE campaign_id=?`, campaignID)
	runIDs := idColumn(runs, "id")

	b.dump("campaign_members", `SELECT * FROM campaign_members WHERE campaign_id=?`, campaignID)

	// Level 2: keyed on scenario_id.
	synopses := b.dumpByIDs("synopses", "scenario_id", scenarioIDs)
	synopsisIDs := idColumn(synopses, "id")

	b.dumpByIDs("synopsis_npcs", "scenario_id", scenarioIDs)

	scenes := b.dumpByIDs("synopsis_scenes", "scenario_id", scenarioIDs)
	sceneIDs := idColumn(scenes, "id")

	b.dumpByIDs("synopsis_factions", "scenario_id", scenarioIDs)

	threads := b.dumpByIDs("brainstorm_threads", "scenario_id", scenarioIDs)
	threadIDs := idColumn(threads, "id")

	sessions := b.dumpByIDs("sessions", "scenario_id", scenarioIDs)
	sessionIDs := idColumn(sessions, "id")

	b.dumpByIDs("session_beats", "scenario_id", scenarioIDs)

	// Level 3: link and child tables keyed on the IDs collected above.
	b.dumpByIDs("npc_location_links", "npc_id", npcIDs)
	b.dumpByIDs("npc_artefact_links", "npc_id", npcIDs)
	b.dumpByIDs("npc_faction_links", "npc_id", npcIDs)
	b.dumpByIDs("faction_location_links", "faction_id", factionIDs)

	b.dumpByIDs("run_players", "run_id", runIDs)
	b.dumpByIDs("run_notes", "run_id", runIDs)

	b.dumpByIDs("synopsis_snapshots", "synopsis_id", synopsisIDs)
	b.dumpByIDs("scene_npcs", "scene_id", sceneIDs)
	b.dumpByIDs("scene_artefacts", "scene_id", sceneIDs)
	b.dumpByIDs("brainstorm_messages", "thread_id", threadIDs)

	b.dumpByIDs("session_rolls", "session_id", sessionIDs)
	b.dumpByIDs("session_scenes", "session_id", sessionIDs)

	if b.err != nil {
		return nil, b.err
	}

	return json.Marshal(campaignSnapshotDoc{Version: 1, Tables: b.tables})
}

// ArchiveCampaign snapshots the campaign's full cascade into
// archived_campaigns, then deletes the live campaign row so the existing
// ON DELETE CASCADE clears every table the snapshot just captured. Both steps
// run in one transaction: split across two, a crash in between would either
// resurrect a "deleted but not archived" campaign or leave two live copies of
// the same data.
func ArchiveCampaign(ctx context.Context, database *sql.DB, campaign *Campaign, archivedBy string) error {
	data, err := SnapshotCampaign(ctx, database, campaign.ID)
	if err != nil {
		return err
	}

	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck — no-op once committed

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO archived_campaigns (id, name, game_name, owner_id, owner_name, archived_by, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		campaign.ID, campaign.Name, campaign.GameName, campaign.OwnerID, campaign.OwnerName, archivedBy, data,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM campaigns WHERE id=?`, campaign.ID); err != nil {
		return err
	}

	return tx.Commit()
}

// ListArchivedCampaigns returns archives owned by userID, or every archive if
// isSuperuser — same access shape as ListCampaignsForUser.
func ListArchivedCampaigns(ctx context.Context, database *sql.DB, userID string, isSuperuser bool) ([]ArchivedCampaign, error) {
	query := `SELECT id, name, game_name, owner_id, owner_name, archived_by, archived_at FROM archived_campaigns`
	var args []any
	if !isSuperuser {
		query += ` WHERE owner_id = ?`
		args = []any{userID}
	}
	query += ` ORDER BY archived_at DESC`

	rows, err := database.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []ArchivedCampaign{}
	for rows.Next() {
		var a ArchivedCampaign
		if err := rows.Scan(&a.ID, &a.Name, &a.GameName, &a.OwnerID, &a.OwnerName, &a.ArchivedBy, &a.ArchivedAt); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

// GetArchivedCampaign returns the listing metadata plus the raw snapshot JSON
// for one archive, or nil if it doesn't exist.
func GetArchivedCampaign(ctx context.Context, database *sql.DB, id string) (*ArchivedCampaign, string, error) {
	row := database.QueryRowContext(ctx,
		`SELECT id, name, game_name, owner_id, owner_name, archived_by, archived_at, data FROM archived_campaigns WHERE id=?`, id)
	var a ArchivedCampaign
	var data string
	err := row.Scan(&a.ID, &a.Name, &a.GameName, &a.OwnerID, &a.OwnerName, &a.ArchivedBy, &a.ArchivedAt, &data)
	if err == sql.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	return &a, data, nil
}
