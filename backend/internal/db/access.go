package db

import (
	"context"
	"database/sql"
)

// Tables and their parent column, as used by the nested-route guards. These are
// compile-time constants from the router — never user input — so interpolating
// them into the query below is safe.
const (
	TableNPCs       = "campaign_npcs"
	TableLocations  = "campaign_locations"
	TableFactions   = "campaign_factions"
	TableArtefacts  = "campaign_artefacts"
	TableScenes     = "synopsis_scenes"
	TableRuns       = "runs"
	TableSessions   = "sessions"
	TableBeats      = "session_beats"
	TableThreads    = "brainstorm_threads"
	TableScenarios  = "scenarios"

	ColCampaignID = "campaign_id"
	ColScenarioID = "scenario_id"
)

// ChildBelongsTo reports whether row childID of table has parentCol = parentID.
//
// This is the check that makes a nested URL mean what it says. Guarding only
// the parent — "do you own campaign X?" — lets a caller pass their own X and
// someone else's child id, and every handler that looks the child up by id
// alone will happily serve it.
func ChildBelongsTo(ctx context.Context, database *sql.DB, table, parentCol, childID, parentID string) (bool, error) {
	if childID == "" || parentID == "" {
		return false, nil
	}
	var n int
	err := database.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM `+table+` WHERE id=? AND `+parentCol+`=?`,
		childID, parentID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// EntityInCampaign is the body-parameter twin of ChildBelongsTo: an id that
// arrives in a JSON payload rather than the URL, and is about to be linked to
// something in this campaign.
func EntityInCampaign(ctx context.Context, database *sql.DB, table, entityID, campaignID string) bool {
	ok, err := ChildBelongsTo(ctx, database, table, ColCampaignID, entityID, campaignID)
	return err == nil && ok
}

// SnapshotInScenario reports whether a snapshot belongs to the scenario's
// synopsis. Restoring is a write into *this* scenario sourced from the
// snapshot, so an unchecked id would copy another campaign's synopsis in.
func SnapshotInScenario(ctx context.Context, database *sql.DB, snapshotID, scenarioID string) (bool, error) {
	if snapshotID == "" || scenarioID == "" {
		return false, nil
	}
	var n int
	err := database.QueryRowContext(ctx, `
		SELECT COUNT(1)
		FROM synopsis_snapshots ss
		JOIN synopses s ON s.id = ss.synopsis_id
		WHERE ss.id = ? AND s.scenario_id = ?`, snapshotID, scenarioID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// CampaignIDForScenario resolves a scenario to its campaign, for handlers that
// must validate a body id against the campaign behind a scenario-scoped route.
func CampaignIDForScenario(ctx context.Context, database *sql.DB, scenarioID string) (string, error) {
	var id string
	err := database.QueryRowContext(ctx,
		`SELECT campaign_id FROM scenarios WHERE id=?`, scenarioID).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return id, err
}
