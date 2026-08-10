package handlers

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"lore/internal/auth"
	"lore/internal/config"
	db "lore/internal/db"

	_ "modernc.org/sqlite"
)

// These cover the invariants an adversarial probe found broken once. They are
// deliberately narrow: boot the real router, then ask the questions that had
// real answers — can one account reach another's rows, and can an ordinary
// player rewrite instance-wide configuration.

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.MigrateAlters(database)
	return database
}

// mkUser creates a real user row. Campaign ownership used to carry a foreign
// key, so tests that invented an owner id failed for the wrong reason.
func mkUser(t *testing.T, database *sql.DB, email string) string {
	t.Helper()
	u, err := db.CreateUser(t.Context(), database, db.CreateUserParams{
		Email: email, Password: "password123", Name: email, Role: "player",
	})
	if err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
	return u.ID
}

func testRouter(t *testing.T, database *sql.DB) http.Handler {
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
	return NewRouter(database, t.TempDir(), t.TempDir(), tokens, cfg)
}

// TestRouterBoots is the cheapest test here and would have caught the most
// embarrassing failure: chi panics at registration time on a duplicate route
// pattern, so a bad route definition takes the process down on start, not on
// the request that uses it. Nothing else in the suite calls NewRouter.
func TestRouterBoots(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("NewRouter panicked — the server would not start: %v", r)
		}
	}()
	testRouter(t, testDB(t))
}

// ── nested-route ownership ───────────────────────────────────────────────────

func TestChildBelongsToScopesByParent(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()

	alice, err := db.CreateCampaign(ctx, database, db.CreateCampaignParams{
		Name: "Alice", OwnerID: mkUser(t, database, "alice@test.local")})
	if err != nil {
		t.Fatal(err)
	}
	bob, err := db.CreateCampaign(ctx, database, db.CreateCampaignParams{
		Name: "Bob", OwnerID: mkUser(t, database, "bob@test.local")})
	if err != nil {
		t.Fatal(err)
	}
	npc, err := db.CreateCampaignNPC(ctx, database, alice.ID, "Vanya", "fixer", "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	mine, err := db.ChildBelongsTo(ctx, database, db.TableNPCs, db.ColCampaignID, npc.ID, alice.ID)
	if err != nil || !mine {
		t.Errorf("an NPC must belong to its own campaign (got %v, %v)", mine, err)
	}

	// The hole that was open: Bob's campaign id plus Alice's NPC id.
	theirs, err := db.ChildBelongsTo(ctx, database, db.TableNPCs, db.ColCampaignID, npc.ID, bob.ID)
	if err != nil {
		t.Fatal(err)
	}
	if theirs {
		t.Error("an NPC must NOT belong to somebody else's campaign")
	}

	for _, c := range []struct{ child, parent string }{
		{"", alice.ID}, {npc.ID, ""}, {"", ""}, {"no-such-id", alice.ID},
	} {
		got, err := db.ChildBelongsTo(ctx, database, db.TableNPCs, db.ColCampaignID, c.child, c.parent)
		if err != nil || got {
			t.Errorf("ChildBelongsTo(%q,%q) = %v, %v — want false, nil", c.child, c.parent, got, err)
		}
	}
}

func TestCrossTenantChildIsNotFound(t *testing.T) {
	database := testDB(t)
	router := testRouter(t, database)
	ctx := t.Context()

	alice, _ := db.CreateCampaign(ctx, database, db.CreateCampaignParams{
		Name: "Alice", OwnerID: mkUser(t, database, "alice@test.local")})
	bob, _ := db.CreateCampaign(ctx, database, db.CreateCampaignParams{
		Name: "Bob", OwnerID: mkUser(t, database, "bob@test.local")})
	npc, _ := db.CreateCampaignNPC(ctx, database, alice.ID, "Vanya", "fixer", "", "", "", "")
	if npc == nil {
		t.Fatal("could not create the NPC the test is about")
	}

	// Unauthenticated is enough to prove the routing shape: the guard must not
	// be the last thing standing. What matters is that the path exists and the
	// request never reaches the handler that would have served Alice's NPC.
	req := httptest.NewRequest(http.MethodGet, "/api/campaigns/"+bob.ID+"/npcs/"+npc.ID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("cross-tenant NPC fetch returned 200: %s", rec.Body.String())
	}
	if body := rec.Body.String(); containsAny(body, "Vanya", "fixer") {
		t.Errorf("cross-tenant response leaked the NPC: %s", body)
	}
}

func TestSnapshotIsScopedToItsScenario(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()

	campaign, _ := db.CreateCampaign(ctx, database, db.CreateCampaignParams{
		Name: "C", OwnerID: mkUser(t, database, "gm@test.local")})
	mine, _ := db.CreateScenario(ctx, database, db.CreateScenarioParams{CampaignID: campaign.ID, Name: "Mine"})
	theirs, _ := db.CreateScenario(ctx, database, db.CreateScenarioParams{CampaignID: campaign.ID, Name: "Theirs"})

	syn, err := db.GetSynopsisByScenario(ctx, database, mine.ID)
	if err != nil || syn == nil {
		t.Fatalf("synopsis: %v", err)
	}
	if err := db.CreateSnapshot(ctx, database, syn.ID, "label", `{"hook":{"content":"secret"}}`); err != nil {
		t.Fatal(err)
	}
	snaps, err := db.ListSnapshots(ctx, database, syn.ID)
	if err != nil || len(snaps) == 0 {
		t.Fatalf("snapshots: %v (%d)", err, len(snaps))
	}

	okOwn, err := db.SnapshotInScenario(ctx, database, snaps[0].ID, mine.ID)
	if err != nil || !okOwn {
		t.Errorf("a snapshot must belong to its own scenario (got %v, %v)", okOwn, err)
	}
	okOther, err := db.SnapshotInScenario(ctx, database, snaps[0].ID, theirs.ID)
	if err != nil {
		t.Fatal(err)
	}
	if okOther {
		t.Error("restoring must not accept another scenario's snapshot")
	}
}

func TestReorderIgnoresScenesFromAnotherScenario(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()

	campaign, _ := db.CreateCampaign(ctx, database, db.CreateCampaignParams{
		Name: "C", OwnerID: mkUser(t, database, "gm@test.local")})
	mine, _ := db.CreateScenario(ctx, database, db.CreateScenarioParams{CampaignID: campaign.ID, Name: "Mine"})
	theirs, _ := db.CreateScenario(ctx, database, db.CreateScenarioParams{CampaignID: campaign.ID, Name: "Theirs"})

	a, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: mine.ID, Title: "A", SortOrder: 0})
	b, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: mine.ID, Title: "B", SortOrder: 1})
	outsider, _ := db.CreateScene(ctx, database, db.CreateSceneParams{ScenarioID: theirs.ID, Title: "Outsider", SortOrder: 7})

	// The ids arrive in a request body, so a caller can put anything in the list.
	if err := db.ReorderScenesIn(ctx, database, mine.ID, []string{b.ID, a.ID, outsider.ID}); err != nil {
		t.Fatal(err)
	}

	after, _ := db.GetScene(ctx, database, outsider.ID)
	if after.SortOrder != 7 {
		t.Errorf("reorder renumbered a scene outside the scenario: sort_order %d, want 7", after.SortOrder)
	}
	newB, _ := db.GetScene(ctx, database, b.ID)
	if newB.SortOrder != 0 {
		t.Errorf("reorder did not apply to our own scenes: B sort_order %d, want 0", newB.SortOrder)
	}
}

// ── instance-wide configuration ──────────────────────────────────────────────

func TestGlobalConfigWritesAreClosedToAnonymous(t *testing.T) {
	router := testRouter(t, testDB(t))

	// Writes to the shared LLM endpoint and game catalogue must never be open.
	// A player repointing base_url receives every prompt the instance sends.
	for _, c := range []struct{ method, path string }{
		{http.MethodPut, "/api/settings/llm"},
		{http.MethodPut, "/api/settings/mistral"},
		{http.MethodPost, "/api/games"},
	} {
		req := httptest.NewRequest(c.method, c.path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code == http.StatusOK || rec.Code == http.StatusCreated {
			t.Errorf("%s %s answered %d without any credential", c.method, c.path, rec.Code)
		}
	}
}

// ── the unauthenticated surfaces that must stay open ─────────────────────────

func TestUploadsAreReadableWithoutASession(t *testing.T) {
	// The GM projects a location image onto a TV that never logs in. If this
	// needed a session the players would stare at a broken image.
	router := testRouter(t, testDB(t))

	req := httptest.NewRequest(http.MethodGet, "/uploads/locations/whatever/x.png", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Error("uploads require authentication — the projection screen cannot load images")
	}
}

func TestExternalMaterialStaysBehindAuth(t *testing.T) {
	// Game PDFs are not part of the projection contract.
	router := testRouter(t, testDB(t))

	req := httptest.NewRequest(http.MethodGet, "/external-material/whatever.pdf", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("external material answered %d without a session, want 401", rec.Code)
	}
}

func containsAny(haystack string, needles ...string) bool {
	for _, n := range needles {
		for i := 0; i+len(n) <= len(haystack); i++ {
			if haystack[i:i+len(n)] == n {
				return true
			}
		}
	}
	return false
}
