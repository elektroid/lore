package handlers

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lore/internal/auth"
	"lore/internal/config"
	db "lore/internal/db"
)

// testClient boots the real router and speaks to it as a logged-in user: the
// access cookie the auth middleware wants, plus the double-submit CSRF pair the
// CSRF middleware wants. Without it a rejected request cannot be told apart
// from an unauthenticated one, and a test asserting "not created" passes on a
// 401 while the rule it is about goes unexercised.
type testClient struct {
	router http.Handler
	cookie *http.Cookie
}

func newTestClient(t *testing.T, database *sql.DB, userID, role string) *testClient {
	t.Helper()
	cfg := &config.Config{}
	cfg.JWT.Secret = "test-secret-for-router-tests"
	cfg.JWT.AccessExpiry = "24h"
	cfg.JWT.RefreshExpiry = "168h"
	cfg.CORS.Origins = []string{"http://localhost:5173"}

	tokens, err := auth.ConfigToTokenService(cfg)
	if err != nil {
		t.Fatalf("token service: %v", err)
	}
	access, err := tokens.GenerateAccessToken(userID, role)
	if err != nil {
		t.Fatalf("access token: %v", err)
	}
	return &testClient{
		router: NewRouter(database, t.TempDir(), t.TempDir(), tokens, cfg),
		cookie: &http.Cookie{Name: "lore_access", Value: access},
	}
}

func (c *testClient) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	r.AddCookie(c.cookie)
	if method != http.MethodGet {
		r.AddCookie(&http.Cookie{Name: "lore_csrf", Value: "csrf-token"})
		r.Header.Set("X-CSRF-Token", "csrf-token")
	}
	rec := httptest.NewRecorder()
	c.router.ServeHTTP(rec, r)
	return rec
}

// The point of runs is that a campaign is written once and played by more than
// one group. These tests are about the seam that makes that true: two groups
// running the same scenario must share every word of the story and none of the
// progress. See docs/adr/0001-runs-separate-story-from-play.md.

func mkCampaignScenario(t *testing.T, database *sql.DB, email string) (*db.Campaign, *db.Scenario) {
	t.Helper()
	campaign, err := db.CreateCampaign(t.Context(), database, db.CreateCampaignParams{
		Name: "C", OwnerID: mkUser(t, database, email)})
	if err != nil {
		t.Fatalf("campaign: %v", err)
	}
	scenario, err := db.CreateScenario(t.Context(), database,
		db.CreateScenarioParams{CampaignID: campaign.ID, Name: "S"})
	if err != nil {
		t.Fatalf("scenario: %v", err)
	}
	return campaign, scenario
}

// TestTwoRunsOfTheSameScenarioKeepSeparateProgress is the invariant the whole
// change exists for. Before runs, "played" was a column on the scene, so the
// second group opened the scenario with the first group's scenes struck through.
func TestTwoRunsOfTheSameScenarioKeepSeparateProgress(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	campaign, scenario := mkCampaignScenario(t, database, "gm@test.local")

	sceneA, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: scenario.ID, Title: "A", SortOrder: 0})
	sceneB, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: scenario.ID, Title: "B", SortOrder: 1})

	tuesday, err := db.CreateRun(ctx, database, campaign.ID, "Mardi")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	friday, err := db.CreateRun(ctx, database, campaign.ID, "Vendredi")
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	// The Tuesday group plays scene A and skips scene B. Friday plays nothing.
	s1, err := db.CreateSession(ctx, database, db.CreateSessionParams{
		ScenarioID: scenario.ID, RunID: tuesday.ID, Name: "S1", Date: "2026-01-06"})
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	if err := db.SetSessionSceneState(ctx, database, s1.ID, sceneA.ID, "cleared"); err != nil {
		t.Fatal(err)
	}
	if err := db.SetSessionSceneState(ctx, database, s1.ID, sceneB.ID, "void"); err != nil {
		t.Fatal(err)
	}

	got, err := db.ListRunSceneStates(ctx, database, tuesday.ID, scenario.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got[sceneA.ID] != "cleared" || got[sceneB.ID] != "void" {
		t.Errorf("Tuesday's progress = %v, want A cleared and B void", got)
	}

	other, err := db.ListRunSceneStates(ctx, database, friday.ID, scenario.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Errorf("Friday inherited Tuesday's progress: %v", other)
	}
}

// A group's progress spans its own evenings, and the most recent one wins — a
// scene voided in January and replayed in March reads as played.
func TestRunProgressSpansSessionsAndTakesTheLatest(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	campaign, scenario := mkCampaignScenario(t, database, "gm@test.local")

	scene, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: scenario.ID, Title: "A"})
	run, _ := db.CreateRun(ctx, database, campaign.ID, "Groupe")

	jan, _ := db.CreateSession(ctx, database, db.CreateSessionParams{
		ScenarioID: scenario.ID, RunID: run.ID, Name: "Janvier", Date: "2026-01-06"})
	mar, _ := db.CreateSession(ctx, database, db.CreateSessionParams{
		ScenarioID: scenario.ID, RunID: run.ID, Name: "Mars", Date: "2026-03-10"})

	if err := db.SetSessionSceneState(ctx, database, jan.ID, scene.ID, "void"); err != nil {
		t.Fatal(err)
	}
	if err := db.SetSessionSceneState(ctx, database, mar.ID, scene.ID, "cleared"); err != nil {
		t.Fatal(err)
	}

	got, _ := db.ListRunSceneStates(ctx, database, run.ID, scenario.ID)
	if got[scene.ID] != "cleared" {
		t.Errorf("state = %q, want cleared — the later evening must win", got[scene.ID])
	}
}

// Progress is per scenario as well as per group: a campaign's other scenario
// must not appear in this one's lens.
func TestRunProgressIsScopedToTheScenario(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	campaign, first := mkCampaignScenario(t, database, "gm@test.local")
	second, _ := db.CreateScenario(ctx, database,
		db.CreateScenarioParams{CampaignID: campaign.ID, Name: "Second"})

	elsewhere, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: second.ID, Title: "Ailleurs"})
	run, _ := db.CreateRun(ctx, database, campaign.ID, "Groupe")
	session, _ := db.CreateSession(ctx, database, db.CreateSessionParams{
		ScenarioID: second.ID, RunID: run.ID, Name: "S"})
	if err := db.SetSessionSceneState(ctx, database, session.ID, elsewhere.ID, "cleared"); err != nil {
		t.Fatal(err)
	}

	got, _ := db.ListRunSceneStates(ctx, database, run.ID, first.ID)
	if len(got) != 0 {
		t.Errorf("the first scenario's lens showed the second's progress: %v", got)
	}
}

// Deleting a group takes its evenings with it and leaves the story alone. This
// is the promise the confirm dialog makes to the GM.
func TestDeletingARunLeavesTheScenarioIntact(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	campaign, scenario := mkCampaignScenario(t, database, "gm@test.local")

	scene, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: scenario.ID, Title: "A"})
	run, _ := db.CreateRun(ctx, database, campaign.ID, "Groupe")
	session, _ := db.CreateSession(ctx, database, db.CreateSessionParams{
		ScenarioID: scenario.ID, RunID: run.ID, Name: "S"})
	if err := db.SetSessionSceneState(ctx, database, session.ID, scene.ID, "cleared"); err != nil {
		t.Fatal(err)
	}

	if err := db.DeleteRun(ctx, database, run.ID); err != nil {
		t.Fatal(err)
	}

	sessions, err := db.ListSessions(ctx, database, scenario.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 0 {
		t.Errorf("deleting a group left %d session(s) behind", len(sessions))
	}
	scenes, err := db.ListScenes(ctx, database, scenario.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(scenes) != 1 || scenes[0].Title != "A" {
		t.Errorf("deleting a group damaged the scenario: %v", scenes)
	}
}

// RunInCampaign is what stops a run id from another campaign being used on a
// scenario-scoped route, where the guard only proved the scenario.
func TestRunInCampaignRejectsAnotherCampaignsRun(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	alice, _ := mkCampaignScenario(t, database, "alice@test.local")
	bob, _ := mkCampaignScenario(t, database, "bob@test.local")

	run, _ := db.CreateRun(ctx, database, alice.ID, "Groupe d'Alice")

	own, err := db.RunInCampaign(ctx, database, run.ID, alice.ID)
	if err != nil || !own {
		t.Errorf("a run must belong to its own campaign (got %v, %v)", own, err)
	}
	theirs, err := db.RunInCampaign(ctx, database, run.ID, bob.ID)
	if err != nil {
		t.Fatal(err)
	}
	if theirs {
		t.Error("a run must NOT belong to somebody else's campaign")
	}
}

// A session is an evening of a group. Without one there is nowhere to record
// what happened, and the scenario would absorb it as if it had been written.
func TestCreateSessionRequiresARun(t *testing.T) {
	database := testDB(t)
	owner := mkUser(t, database, "gm@test.local")
	campaign, err := db.CreateCampaign(t.Context(), database,
		db.CreateCampaignParams{Name: "C", OwnerID: owner})
	if err != nil {
		t.Fatal(err)
	}
	scenario, err := db.CreateScenario(t.Context(), database,
		db.CreateScenarioParams{CampaignID: campaign.ID, Name: "S"})
	if err != nil {
		t.Fatal(err)
	}
	client := newTestClient(t, database, owner, "player")

	rec := client.do(t, http.MethodPost,
		"/api/scenarios/"+scenario.ID+"/sessions", `{"name":"S1","date":"2026-01-06"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST session with no run = %d (%s), want 400",
			rec.Code, rec.Body.String())
	}

	// And with a group, the same request works — otherwise the check above
	// would pass just as well on a route that is broken outright.
	run, err := db.CreateRun(t.Context(), database, campaign.ID, "Groupe")
	if err != nil {
		t.Fatal(err)
	}
	rec = client.do(t, http.MethodPost, "/api/scenarios/"+scenario.ID+"/sessions",
		`{"name":"S1","date":"2026-01-06","run_id":"`+run.ID+`"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST session with a run = %d (%s), want 201", rec.Code, rec.Body.String())
	}
}

// The scenario route guard proves the caller owns the scenario. It says nothing
// about a run id in the body, so that is checked against the campaign too.
func TestCreateSessionRejectsAnotherCampaignsRun(t *testing.T) {
	database := testDB(t)
	owner := mkUser(t, database, "gm@test.local")

	mine, err := db.CreateCampaign(t.Context(), database,
		db.CreateCampaignParams{Name: "Mine", OwnerID: owner})
	if err != nil {
		t.Fatal(err)
	}
	scenario, err := db.CreateScenario(t.Context(), database,
		db.CreateScenarioParams{CampaignID: mine.ID, Name: "S"})
	if err != nil {
		t.Fatal(err)
	}
	// A second campaign the same GM owns: ownership is not the question here,
	// belonging is.
	other, err := db.CreateCampaign(t.Context(), database,
		db.CreateCampaignParams{Name: "Other", OwnerID: owner})
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := db.CreateRun(t.Context(), database, other.ID, "Groupe d\u2019ailleurs")
	if err != nil {
		t.Fatal(err)
	}

	client := newTestClient(t, database, owner, "player")
	rec := client.do(t, http.MethodPost, "/api/scenarios/"+scenario.ID+"/sessions",
		`{"name":"S1","run_id":"`+foreign.ID+`"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("POST session with another campaign's run = %d (%s), want 404",
			rec.Code, rec.Body.String())
	}

	sessions, err := db.ListSessions(t.Context(), database, scenario.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 0 {
		t.Errorf("a session was created anyway: %v", sessions)
	}
}

// The same question one level up: the progress lens takes a run id straight
// from the path of a scenario-scoped route.
func TestRunScenesRejectsAnotherCampaignsRun(t *testing.T) {
	database := testDB(t)
	owner := mkUser(t, database, "gm@test.local")

	mine, _ := db.CreateCampaign(t.Context(), database,
		db.CreateCampaignParams{Name: "Mine", OwnerID: owner})
	scenario, _ := db.CreateScenario(t.Context(), database,
		db.CreateScenarioParams{CampaignID: mine.ID, Name: "S"})
	other, _ := db.CreateCampaign(t.Context(), database,
		db.CreateCampaignParams{Name: "Other", OwnerID: owner})
	foreign, err := db.CreateRun(t.Context(), database, other.ID, "Groupe d\u2019ailleurs")
	if err != nil {
		t.Fatal(err)
	}

	client := newTestClient(t, database, owner, "player")
	rec := client.do(t, http.MethodGet,
		"/api/scenarios/"+scenario.ID+"/runs/"+foreign.ID+"/scenes", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET progress for another campaign's run = %d (%s), want 404",
			rec.Code, rec.Body.String())
	}
}

// ── Backfill and the drop that follows it ────────────────────────────────────

// restoreLegacyShape puts back what runs superseded and the migration has since
// dropped: the `played` flag on scenes, the free-text roster on sessions, and
// the per-session roster table.
//
// The current schema.sql no longer creates any of it, so a test about upgrading
// an old database has to build the old database first. That is an improvement
// on relying on leftovers: what is reconstructed here is exactly, and only,
// what a pre-runs installation had.
func restoreLegacyShape(t *testing.T, database *sql.DB) {
	t.Helper()
	for _, stmt := range []string{
		`ALTER TABLE synopsis_scenes ADD COLUMN played INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE sessions ADD COLUMN players TEXT NOT NULL DEFAULT '[]'`,
		`CREATE TABLE session_players (
			id           TEXT PRIMARY KEY,
			session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			character_id TEXT REFERENCES player_characters(id) ON DELETE SET NULL,
			created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(session_id, user_id)
		)`,
	} {
		if _, err := database.Exec(stmt); err != nil {
			t.Fatalf("restoring the legacy shape: %v", err)
		}
	}
}

func legacyShapeGone(t *testing.T, database *sql.DB) []string {
	t.Helper()
	var left []string
	for _, c := range []struct{ table, column string }{
		{"synopsis_scenes", "played"}, {"sessions", "players"},
	} {
		rows, err := database.Query(
			`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`, c.table, c.column)
		if err != nil {
			t.Fatal(err)
		}
		if rows.Next() {
			left = append(left, c.table+"."+c.column)
		}
		rows.Close()
	}
	var n int
	if err := database.QueryRow(
		`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='session_players'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n > 0 {
		left = append(left, "session_players")
	}
	return left
}

// A database written before runs existed carries sessions, per-session rosters
// and scene `played` flags that all silently belonged to one unnamed group.
// The backfill has to name that group and move them onto it — and, because
// schema.sql is re-run on every hot reload, do nothing at all the second time.
func TestBackfillAdoptsPreRunPlayData(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	campaign, scenario := mkCampaignScenario(t, database, "gm@test.local")

	scene, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: scenario.ID, Title: "A"})
	player := mkUser(t, database, "player@test.local")

	// Fabricate the pre-runs shape: a session with no group, a roster on that
	// session, and a scene the story itself called played.
	restoreLegacyShape(t, database)
	if _, err := database.ExecContext(ctx,
		`INSERT INTO sessions(id, scenario_id, name, date) VALUES('old-session',?,'Ancienne','2025-11-02')`,
		scenario.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO session_players(id, session_id, user_id) VALUES('old-sp','old-session',?)`,
		player); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`UPDATE synopsis_scenes SET played=1 WHERE id=?`, scene.ID); err != nil {
		t.Fatal(err)
	}

	db.MigrateAlters(database)

	runs, err := db.ListRuns(ctx, database, campaign.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("backfill created %d run(s), want exactly 1", len(runs))
	}
	run := runs[0]

	sessions, err := db.ListSessions(ctx, database, scenario.ID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].ID != "old-session" {
		t.Errorf("the orphan session was not attached to the run: %v", sessions)
	}

	party, err := db.ListRunPlayers(ctx, database, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(party) != 1 || party[0].UserID != player {
		t.Errorf("the party was not carried over: %v", party)
	}

	states, err := db.ListRunSceneStates(ctx, database, run.ID, scenario.ID)
	if err != nil {
		t.Fatal(err)
	}
	if states[scene.ID] != "cleared" {
		t.Errorf("the played flag was not carried over: %v", states)
	}

	// Once nothing is owed, the same migration drops what it just read.
	if left := legacyShapeGone(t, database); len(left) > 0 {
		t.Errorf("legacy play data survived the migration: %v", left)
	}

	// Every hot reload runs this again. It must be a no-op, and must not fail
	// now that the statements it would run refer to things that are gone.
	db.MigrateAlters(database)
	db.MigrateAlters(database)

	runs, _ = db.ListRuns(ctx, database, campaign.ID)
	if len(runs) != 1 {
		t.Errorf("re-running the migration created %d runs, want 1", len(runs))
	}
	party, _ = db.ListRunPlayers(ctx, database, run.ID)
	if len(party) != 1 {
		t.Errorf("re-running the migration duplicated the party: %v", party)
	}
	states, _ = db.ListRunSceneStates(ctx, database, run.ID, scenario.ID)
	if states[scene.ID] != "cleared" {
		t.Errorf("re-running the migration lost the migrated progress: %v", states)
	}
}

// A campaign nobody ever played must not acquire a group out of nowhere — and
// the drop must still happen, since there is nothing left to migrate.
func TestBackfillLeavesUnplayedCampaignsAlone(t *testing.T) {
	database := testDB(t)
	campaign, scenario := mkCampaignScenario(t, database, "gm@test.local")
	if _, err := db.CreateScene(t.Context(), database,
		db.CreateSceneParams{ScenarioID: scenario.ID, Title: "A"}); err != nil {
		t.Fatal(err)
	}
	restoreLegacyShape(t, database)

	db.MigrateAlters(database)

	runs, err := db.ListRuns(t.Context(), database, campaign.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 0 {
		t.Errorf("an unplayed campaign got %d run(s): %v", len(runs), runs)
	}
	if left := legacyShapeGone(t, database); len(left) > 0 {
		t.Errorf("nothing was owed, so the drop should have run: %v", left)
	}
}

// The interlock. The drop removes exactly what the backfill reads, so it must
// refuse while any campaign is still owed a group — otherwise a backfill that
// could not complete would be followed by the destruction of its input.
func TestDropIsHeldBackWhileACampaignStillOwesARun(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	_, scenario := mkCampaignScenario(t, database, "gm@test.local")
	scene, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: scenario.ID, Title: "A"})

	restoreLegacyShape(t, database)
	if _, err := database.ExecContext(ctx,
		`UPDATE synopsis_scenes SET played=1 WHERE id=?`, scene.ID); err != nil {
		t.Fatal(err)
	}

	// Simulate a backfill that cannot run: drop the table it inserts into, so
	// backfillOneCampaignRun fails and the campaign stays owed.
	if _, err := database.Exec(`DROP TABLE run_players`); err != nil {
		t.Fatal(err)
	}

	db.MigrateAlters(database)

	left := legacyShapeGone(t, database)
	for _, want := range []string{"synopsis_scenes.played", "session_players"} {
		if !containsAny(joinStrings(left), want) {
			t.Errorf("the backfill failed, so %s must be kept — survivors: %v", want, left)
		}
	}
}

func joinStrings(ss []string) string {
	out := ""
	for _, s := range ss {
		out += s + " "
	}
	return out
}
