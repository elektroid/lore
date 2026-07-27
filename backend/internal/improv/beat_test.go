package improv

import (
	"encoding/json"
	"strings"
	"testing"
)

func cyberpunkScenes() []SceneLine {
	return []SceneLine{
		{Ref: "s1", ID: "id-1", Title: "Le contrat", Summary: "Vanya propose un job", Played: true},
		{Ref: "s2", ID: "id-2", Title: "Repérage", Summary: "Surveillance de la tour", IsAnchor: true},
		{Ref: "s3", ID: "id-3", Title: "Le rendez-vous", Summary: "Rencontre avec le contact"},
		{Ref: "s4", ID: "id-4", Title: "Extraction", Summary: "Fuite par les toits", Voided: true},
	}
}

// ── Verdicts ──────────────────────────────────────────────────────────────────

func TestVerdictAliases(t *testing.T) {
	cases := map[string]string{
		"ok": VerdictOK, "OK": VerdictOK, " Cohérent ": VerdictOK, "compatible": VerdictOK,
		"tension": VerdictTension, "friction": VerdictTension, "Risque": VerdictTension,
		"conflict": VerdictConflict, "conflit": VerdictConflict, "Contradiction": VerdictConflict,
	}
	for input, want := range cases {
		c := Coherency{Verdict: input}
		ResolveImpacts(&c, nil)
		if c.Verdict != want {
			t.Errorf("verdict %q → %q, want %q", input, c.Verdict, want)
		}
	}
}

func TestUnreadableVerdictIsNotACleanBillOfHealth(t *testing.T) {
	// Silently claiming "ok" is the one failure mode that matters here: the GM
	// would trust a check that never happened.
	for _, input := range []string{"", "peut-être", "42", "¯\\_(ツ)_/¯"} {
		c := Coherency{Verdict: input}
		ResolveImpacts(&c, nil)
		if c.Verdict == VerdictOK {
			t.Errorf("verdict %q must not resolve to ok", input)
		}
		if c.Verdict != VerdictTension {
			t.Errorf("verdict %q → %q, want tension", input, c.Verdict)
		}
	}
}

// ── Impact resolution ─────────────────────────────────────────────────────────

func TestResolveImpactsFillsSceneIdentity(t *testing.T) {
	c := Coherency{
		Verdict: "conflit",
		Summary: "  Le contact est mort trois scènes trop tôt.  ",
		Impacts: []Impact{{SceneRef: "s3", Note: "  Ne peut plus se tenir.  "}},
	}
	ResolveImpacts(&c, cyberpunkScenes())

	if c.Verdict != VerdictConflict {
		t.Errorf("verdict = %q", c.Verdict)
	}
	if c.Summary != "Le contact est mort trois scènes trop tôt." {
		t.Errorf("summary not trimmed: %q", c.Summary)
	}
	if len(c.Impacts) != 1 {
		t.Fatalf("want 1 impact, got %d", len(c.Impacts))
	}
	got := c.Impacts[0]
	if got.SceneID != "id-3" || got.Title != "Le rendez-vous" {
		t.Errorf("impact not resolved to the real scene: %+v", got)
	}
	if got.Note != "Ne peut plus se tenir." {
		t.Errorf("note not trimmed: %q", got.Note)
	}
}

func TestResolveImpactsDropsHallucinatedScenes(t *testing.T) {
	// A reference to a scene that does not exist costs a missing line in the
	// report, never a failed develop.
	c := Coherency{Impacts: []Impact{
		{SceneRef: "s2", Note: "réel"},
		{SceneRef: "s99", Note: "inventé"},
		{SceneRef: "", Note: "vide"},
		{SceneRef: "la scène du bar", Note: "en toutes lettres"},
	}}
	ResolveImpacts(&c, cyberpunkScenes())

	if len(c.Impacts) != 1 || c.Impacts[0].SceneID != "id-2" {
		t.Errorf("only the resolvable impact should survive, got %+v", c.Impacts)
	}
}

func TestResolveImpactsIsCaseInsensitiveAndDeduplicates(t *testing.T) {
	c := Coherency{Impacts: []Impact{
		{SceneRef: "S3", Note: "premier"},
		{SceneRef: "s3", Note: "doublon"},
	}}
	ResolveImpacts(&c, cyberpunkScenes())

	if len(c.Impacts) != 1 {
		t.Fatalf("repeated ref should collapse, got %d", len(c.Impacts))
	}
	if c.Impacts[0].Note != "premier" {
		t.Errorf("first mention should win, got %q", c.Impacts[0].Note)
	}
}

func TestResolveImpactsNeverLeavesNil(t *testing.T) {
	// The panel maps over this; null would crash the play console mid-session.
	c := Coherency{Verdict: "ok"}
	ResolveImpacts(&c, cyberpunkScenes())
	if c.Impacts == nil {
		t.Fatal("impacts should be an empty slice, not nil")
	}
	if !strings.Contains(c.JSON(), `"impacts":[]`) {
		t.Errorf("empty impacts should marshal as [], got %s", c.JSON())
	}
}

// ── Storage round-trip ────────────────────────────────────────────────────────

func TestParseCoherencySurvivesGarbage(t *testing.T) {
	for _, raw := range []string{"", "  ", "{", "not json", "null"} {
		c := ParseCoherency(raw)
		if c.Impacts == nil {
			t.Errorf("ParseCoherency(%q) left impacts nil", raw)
		}
		if len(c.Impacts) != 0 {
			t.Errorf("ParseCoherency(%q) invented impacts", raw)
		}
	}
}

func TestCoherencyRoundTrip(t *testing.T) {
	c := Coherency{
		Verdict: VerdictTension,
		Summary: "Les PJs ont brûlé l'entrepôt.",
		Impacts: []Impact{{SceneRef: "s4", SceneID: "id-4", Title: "Extraction", Note: "Plus de toit."}},
	}
	got := ParseCoherency(c.JSON())

	if got.Verdict != c.Verdict || got.Summary != c.Summary || len(got.Impacts) != 1 {
		t.Fatalf("round-trip lost data: %+v", got)
	}
	if got.Impacts[0].SceneID != "id-4" || got.Impacts[0].Title != "Extraction" {
		t.Errorf("resolved identity lost in round-trip: %+v", got.Impacts[0])
	}
}

func TestCleanTrimsProseAndResolves(t *testing.T) {
	r := DevelopResult{
		Title:       "  Le netrunner grillé  ",
		Description: "  Deux paragraphes.  ",
		Outcome:     "  Les PJs sont marqués.  ",
		Notes:       "  pluie acide, sirènes  ",
		Coherency:   Coherency{Verdict: "conflit", Impacts: []Impact{{SceneRef: "s1", Note: "x"}}},
	}
	r.Clean(cyberpunkScenes())

	if r.Title != "Le netrunner grillé" || r.Description != "Deux paragraphes." ||
		r.Outcome != "Les PJs sont marqués." || r.Notes != "pluie acide, sirènes" {
		t.Errorf("prose not trimmed: %+v", r)
	}
	if r.Coherency.Verdict != VerdictConflict || r.Coherency.Impacts[0].Title != "Le contrat" {
		t.Errorf("coherency not resolved: %+v", r.Coherency)
	}
}

func TestDevelopResultDecodesFromModelJSON(t *testing.T) {
	raw := `{"title":"Le braquage improvisé","description":"…","outcome":"…","notes":"…",
	         "coherency":{"verdict":"tension","summary":"Le contact se méfie.",
	         "impacts":[{"scene_ref":"s3","note":"Le rendez-vous devient hostile."}]}}`
	var r DevelopResult
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		t.Fatal(err)
	}
	r.Clean(cyberpunkScenes())

	if r.Title != "Le braquage improvisé" {
		t.Errorf("title = %q", r.Title)
	}
	if r.Coherency.Verdict != VerdictTension || len(r.Coherency.Impacts) != 1 {
		t.Errorf("coherency = %+v", r.Coherency)
	}
	if r.Coherency.Impacts[0].SceneID != "id-3" {
		t.Errorf("impact not resolved: %+v", r.Coherency.Impacts[0])
	}
}

// ── Prompts ───────────────────────────────────────────────────────────────────

func TestDevelopPromptShowsTheBeatSheetAndTheNote(t *testing.T) {
	note := "Les PJs ont soudoyé le vigile au lieu de passer par les toits"
	got := DevelopPrompt(note, cyberpunkScenes(), "reste sec", []string{"outcome"})

	for _, want := range []string{
		note,
		"s1 : Le contrat",
		"déjà jouée",     // s1 is played
		"SCÈNE EN COURS", // s2 is the anchor
		"annulée",        // s4 was voided this session
		"reste sec",
		"outcome",
		"scene_ref",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("develop prompt missing %q", want)
		}
	}
}

func TestDevelopPromptHandlesAnEmptyScenario(t *testing.T) {
	got := DevelopPrompt("Les PJs inventent tout", nil, "", nil)
	if !strings.Contains(got, "aucune scène") {
		t.Error("a scenario with no scenes should say so rather than show an empty list")
	}
	if !strings.Contains(got, "Les PJs inventent tout") {
		t.Error("the note must survive even with no beat sheet")
	}
}

func TestSystemPromptTellsTheModelNotToOverrule(t *testing.T) {
	got := SystemPrompt(Context{
		GameName: "Cyberpunk RED", Genre: "cyberpunk",
		Lore: "Night City, 2045", ScenarioPitch: "Un fixer disparaît",
	})

	for _, want := range []string{"Cyberpunk RED", "cyberpunk", "Night City, 2045", "Un fixer disparaît", "acquis"} {
		if !strings.Contains(got, want) {
			t.Errorf("system prompt missing %q", want)
		}
	}
}
