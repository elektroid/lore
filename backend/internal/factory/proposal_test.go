package factory

import (
	"encoding/json"
	"strings"
	"testing"
)

// The whole proposal document is LLM-authored, so these tests are mostly about
// what happens when the model is sloppy — which it routinely is.

func TestNormalizeAssignsMissingRefs(t *testing.T) {
	p := Proposal{
		NPCs:   []NPC{{Name: "Vanya Kovár"}, {Ref: "n2", Name: "Dex"}},
		Scenes: []Scene{{Title: "Le contrat"}},
	}
	Normalize(&p)

	if p.NPCs[0].Ref == "" {
		t.Error("NPC without a ref should get one")
	}
	if p.NPCs[1].Ref != "n2" {
		t.Errorf("model's own ref should survive, got %q", p.NPCs[1].Ref)
	}
	if p.Scenes[0].Ref == "" {
		t.Error("scene without a ref should get one")
	}
}

func TestNormalizeBreaksRefCollisions(t *testing.T) {
	// Two items claiming the same handle would make every link ambiguous.
	p := Proposal{
		NPCs:      []NPC{{Ref: "x", Name: "Vanya"}, {Ref: "x", Name: "Dex"}},
		Locations: []Location{{Ref: "x", Name: "Le Kabuki noyé"}},
	}
	Normalize(&p)

	seen := map[string]bool{}
	for _, ref := range []string{p.NPCs[0].Ref, p.NPCs[1].Ref, p.Locations[0].Ref} {
		if ref == "" {
			t.Fatal("ref should never be empty after Normalize")
		}
		if seen[ref] {
			t.Fatalf("ref %q used twice", ref)
		}
		seen[ref] = true
	}
}

func TestNormalizeDropsUnnamedItems(t *testing.T) {
	p := Proposal{
		NPCs:      []NPC{{Ref: "n1", Name: "Vanya"}, {Ref: "n2", Name: "   "}},
		Locations: []Location{{Ref: "l1", Name: ""}},
		Artefacts: []Artefact{{Ref: "a1", Name: "Puce Soulkiller"}},
		Scenes:    []Scene{{Ref: "s1", Title: "", Summary: ""}, {Ref: "s2", Title: "Le contrat"}},
	}
	Normalize(&p)

	if len(p.NPCs) != 1 || p.NPCs[0].Name != "Vanya" {
		t.Errorf("nameless NPC should be dropped, got %+v", p.NPCs)
	}
	if len(p.Locations) != 0 {
		t.Errorf("nameless location should be dropped, got %+v", p.Locations)
	}
	if len(p.Artefacts) != 1 {
		t.Errorf("named artefact should survive, got %+v", p.Artefacts)
	}
	if len(p.Scenes) != 1 || p.Scenes[0].Title != "Le contrat" {
		t.Errorf("empty scene should be dropped, got %+v", p.Scenes)
	}
}

func TestNormalizeDerivesTitleFromSummary(t *testing.T) {
	// A beat with only a summary is still a beat; give it a title from the summary.
	p := Proposal{Scenes: []Scene{{Ref: "s1",
		Summary: "Les PJs rencontrent le fixer dans un bar noyé sous la pluie acide"}}}
	Normalize(&p)

	if len(p.Scenes) != 1 {
		t.Fatalf("scene with a summary should survive, got %d", len(p.Scenes))
	}
	if p.Scenes[0].Title == "" {
		t.Error("title should be derived from the summary")
	}
	if len(strings.Fields(p.Scenes[0].Title)) > 7 {
		t.Errorf("derived title should be short, got %q", p.Scenes[0].Title)
	}
}

func TestNormalizeClearsDanglingRefs(t *testing.T) {
	// The model invents links to items it never listed. Dropping the link beats
	// failing the commit.
	p := Proposal{
		NPCs:      []NPC{{Ref: "n1", Name: "Vanya", FactionRef: "ghost"}},
		Locations: []Location{{Ref: "l1", Name: "Le Kabuki noyé"}},
		Scenes: []Scene{{
			Ref: "s1", Title: "Le contrat",
			LocationRef:  "nowhere",
			NPCRefs:      flexStrings{"n1", "n99"},
			ArtefactRefs: flexStrings{"a1"},
		}},
	}
	Normalize(&p)

	if p.NPCs[0].FactionRef != "" {
		t.Errorf("dangling faction_ref should be cleared, got %q", p.NPCs[0].FactionRef)
	}
	if p.Scenes[0].LocationRef != "" {
		t.Errorf("dangling location_ref should be cleared, got %q", p.Scenes[0].LocationRef)
	}
	if len(p.Scenes[0].NPCRefs) != 1 || p.Scenes[0].NPCRefs[0] != "n1" {
		t.Errorf("only real npc refs should survive, got %v", p.Scenes[0].NPCRefs)
	}
	if len(p.Scenes[0].ArtefactRefs) != 0 {
		t.Errorf("dangling artefact refs should be cleared, got %v", p.Scenes[0].ArtefactRefs)
	}
}

func TestNormalizeDeduplicatesSceneNPCRefs(t *testing.T) {
	p := Proposal{
		NPCs:   []NPC{{Ref: "n1", Name: "Vanya"}},
		Scenes: []Scene{{Ref: "s1", Title: "Le contrat", NPCRefs: flexStrings{"n1", "n1"}}},
	}
	Normalize(&p)

	if len(p.Scenes[0].NPCRefs) != 1 {
		t.Errorf("repeated npc ref should collapse, got %v", p.Scenes[0].NPCRefs)
	}
}

func TestNormalizeKeepsOneStartScene(t *testing.T) {
	p := Proposal{Scenes: []Scene{
		{Ref: "s1", Title: "A", IsStart: true},
		{Ref: "s2", Title: "B", IsStart: true},
		{Ref: "s3", Title: "C", IsStart: true},
	}}
	Normalize(&p)

	if !bool(p.Scenes[0].IsStart) {
		t.Error("first start scene should keep the flag")
	}
	if bool(p.Scenes[1].IsStart) || bool(p.Scenes[2].IsStart) {
		t.Error("later start scenes should be cleared")
	}
}

func TestNormalizeForcesAStartScene(t *testing.T) {
	// A beat sheet with no entry point is a list, not a story.
	p := Proposal{Scenes: []Scene{{Ref: "s1", Title: "A"}, {Ref: "s2", Title: "B"}}}
	Normalize(&p)

	if !bool(p.Scenes[0].IsStart) {
		t.Error("with no start scene proposed, the first should become it")
	}
}

func TestNormalizeCoercesSceneStatus(t *testing.T) {
	cases := map[string]string{
		"key_event":         StatusKeyEvent,
		"Événement clé":     StatusKeyEvent,
		"essentiel":         StatusKeyEvent,
		"optional_step":     StatusOptionalStep,
		"Étape optionnelle": StatusOptionalStep,
		"optionnelle":       StatusOptionalStep,
		"idea":              StatusIdea,
		"Idée":              StatusIdea,
		"":                  StatusKeyEvent, // unset means it matters
		"whatever":          StatusKeyEvent,
	}
	for input, want := range cases {
		p := Proposal{Scenes: []Scene{{Ref: "s1", Title: "A", Status: input}}}
		Normalize(&p)
		if got := p.Scenes[0].Status; got != want {
			t.Errorf("status %q → %q, want %q", input, got, want)
		}
	}
}

func TestNormalizeLeavesIncludeAlone(t *testing.T) {
	// Include is the GM's flag; a re-normalise on save must not resurrect
	// something they unticked.
	p := Proposal{
		NPCs:   []NPC{{Ref: "n1", Name: "Vanya", Include: false}, {Ref: "n2", Name: "Dex", Include: true}},
		Scenes: []Scene{{Ref: "s1", Title: "A", Include: false}},
	}
	Normalize(&p)

	if bool(p.NPCs[0].Include) {
		t.Error("Normalize must not re-include an unticked NPC")
	}
	if !bool(p.NPCs[1].Include) {
		t.Error("Normalize must not untick an included NPC")
	}
	if bool(p.Scenes[0].Include) {
		t.Error("Normalize must not re-include an unticked scene")
	}
}

func TestSetAllIncluded(t *testing.T) {
	p := Proposal{
		Factions:  []Faction{{Ref: "f1", Name: "Arasaka"}},
		Locations: []Location{{Ref: "l1", Name: "Le Kabuki noyé"}},
		NPCs:      []NPC{{Ref: "n1", Name: "Vanya"}},
		Artefacts: []Artefact{{Ref: "a1", Name: "Puce Soulkiller"}},
		Scenes:    []Scene{{Ref: "s1", Title: "Le contrat"}},
	}
	SetAllIncluded(&p)

	if !bool(p.Factions[0].Include) || !bool(p.Locations[0].Include) ||
		!bool(p.NPCs[0].Include) || !bool(p.Artefacts[0].Include) || !bool(p.Scenes[0].Include) {
		t.Error("a fresh proposal should arrive fully included — the GM unticks, they don't tick")
	}
}

// ── Lenient decoding of what models actually send ─────────────────────────────

func TestFlexBoolAcceptsModelSlop(t *testing.T) {
	cases := map[string]bool{
		`{"is_start":true}`:    true,
		`{"is_start":"true"}`:  true,
		`{"is_start":"oui"}`:   true,
		`{"is_start":1}`:       true,
		`{"is_start":false}`:   false,
		`{"is_start":"false"}`: false,
		`{"is_start":"non"}`:   false,
		`{"is_start":0}`:       false,
		`{"is_start":null}`:    false,
		`{}`:                   false,
	}
	for raw, want := range cases {
		var s Scene
		if err := json.Unmarshal([]byte(raw), &s); err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if bool(s.IsStart) != want {
			t.Errorf("%s → %v, want %v", raw, bool(s.IsStart), want)
		}
	}
}

func TestFlexStringsAcceptsModelSlop(t *testing.T) {
	cases := map[string][]string{
		`{"npc_refs":["n1","n2"]}`: {"n1", "n2"},
		`{"npc_refs":"n1"}`:        {"n1"},
		`{"npc_refs":"n1, n2"}`:    {"n1", "n2"},
		`{"npc_refs":[]}`:          {},
		`{"npc_refs":null}`:        nil,
		`{}`:                       nil,
	}
	for raw, want := range cases {
		var s Scene
		if err := json.Unmarshal([]byte(raw), &s); err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if len(s.NPCRefs) != len(want) {
			t.Errorf("%s → %v, want %v", raw, s.NPCRefs, want)
			continue
		}
		for i := range want {
			if s.NPCRefs[i] != want[i] {
				t.Errorf("%s → %v, want %v", raw, s.NPCRefs, want)
				break
			}
		}
	}
}

func TestFlexStringsMarshalsNilAsEmptyArray(t *testing.T) {
	// The frontend maps over these; null would crash the review screen.
	b, err := json.Marshal(Scene{Ref: "s1"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"npc_refs":[]`) {
		t.Errorf("nil refs should marshal as [], got %s", b)
	}
}

// ── Storage round-trip ────────────────────────────────────────────────────────

func TestParseSurvivesGarbage(t *testing.T) {
	// A draft the GM can still see and delete beats a page that refuses to load.
	for _, raw := range []string{"", "   ", "{", "not json at all", "null", "[]"} {
		p := Parse(raw)
		if len(p.Scenes) != 0 {
			t.Errorf("Parse(%q) should yield an empty proposal, got %+v", raw, p)
		}
	}
}

func TestRoundTrip(t *testing.T) {
	p := Proposal{
		Title: "Ce qui tourne finit par revenir",
		Pitch: "Un fixer disparaît, et son dernier contrat porte le nom des PJs.",
		Factions: []Faction{{Ref: "f1", Name: "Arasaka", Type: "corpo",
			Description: "Zaibatsu", Motivation: "Récupérer la puce", Include: true}},
		Locations: []Location{{Ref: "l1", Name: "Le Kabuki noyé", City: "Night City",
			District: "Kabuki", Atmosphere: "néons noyés", Include: true}},
		NPCs: []NPC{{Ref: "n1", Name: "Vanya Kovár", Role: "fixer",
			FactionRef: "f1", Include: true}},
		Artefacts: []Artefact{{Ref: "a1", Name: "Puce Soulkiller", Include: true}},
		Scenes: []Scene{{Ref: "s1", Title: "Le contrat", Status: StatusKeyEvent,
			Summary: "Vanya propose un job", LocationRef: "l1",
			NPCRefs: flexStrings{"n1"}, ArtefactRefs: flexStrings{"a1"},
			IsStart: true, Include: true}},
	}

	got := Parse(p.JSON())
	Normalize(&got)

	if got.Title != p.Title || got.Pitch != p.Pitch {
		t.Error("title/pitch lost in round-trip")
	}
	if len(got.Scenes) != 1 || got.Scenes[0].LocationRef != "l1" ||
		len(got.Scenes[0].NPCRefs) != 1 || !bool(got.Scenes[0].IsStart) {
		t.Errorf("scene links lost in round-trip: %+v", got.Scenes)
	}
	if got.NPCs[0].FactionRef != "f1" {
		t.Error("npc faction membership lost in round-trip")
	}
	if !bool(got.NPCs[0].Include) {
		t.Error("include flags lost in round-trip")
	}
}

// ── Prompt-side lookups ───────────────────────────────────────────────────────

func TestLookupsForPrompts(t *testing.T) {
	p := Proposal{
		Locations: []Location{{Ref: "l1", Name: "Le Kabuki noyé"}},
		NPCs:      []NPC{{Ref: "n1", Name: "Vanya Kovár", Role: "fixer"}, {Ref: "n2", Name: "Dex"}},
		Scenes:    []Scene{{Ref: "s1", Title: "Le contrat"}},
	}

	if got := p.LocationName("l1"); got != "Le Kabuki noyé" {
		t.Errorf("LocationName = %q", got)
	}
	if got := p.LocationName("nope"); got != "" {
		t.Errorf("LocationName of unknown ref = %q, want empty", got)
	}

	names := p.NPCNames([]string{"n1", "n2", "ghost"})
	if len(names) != 2 || names[0] != "Vanya Kovár (fixer)" || names[1] != "Dex" {
		t.Errorf("NPCNames = %v", names)
	}

	if p.FindScene("s1") == nil {
		t.Error("FindScene should find an existing beat")
	}
	if p.FindScene("s9") != nil {
		t.Error("FindScene should return nil for an unknown ref")
	}
}

func TestFindSceneReturnsMutablePointer(t *testing.T) {
	// ExpandScene writes through this pointer; a copy would silently lose the text.
	p := Proposal{Scenes: []Scene{{Ref: "s1", Title: "Le contrat"}}}
	p.FindScene("s1").Description = "Pluie acide sur le parking."

	if p.Scenes[0].Description == "" {
		t.Error("FindScene must point into the slice, not return a copy")
	}
}

// ── Prompts ───────────────────────────────────────────────────────────────────

func TestOutlinePromptCarriesTheBrief(t *testing.T) {
	brief := "Un netrunner grille son cerveau en révélant un secret d'Arasaka"
	got := OutlinePrompt(brief, 7, "plus sombre")

	for _, want := range []string{brief, "7 scènes", "plus sombre", `"is_start"`, `"npc_refs"`} {
		if !strings.Contains(got, want) {
			t.Errorf("outline prompt missing %q", want)
		}
	}
}

func TestSystemPromptOffersExistingNamesForReuse(t *testing.T) {
	got := SystemPrompt(PromptContext{
		GameName:     "Cyberpunk RED",
		Genre:        "cyberpunk",
		ExistingNPCs: []string{"Rache Bartmoss"},
	})

	for _, want := range []string{"Cyberpunk RED", "cyberpunk", "Rache Bartmoss", "EXACTEMENT"} {
		if !strings.Contains(got, want) {
			t.Errorf("system prompt missing %q", want)
		}
	}
}

func TestSystemPromptStaysQuietWithNothingToReuse(t *testing.T) {
	got := SystemPrompt(PromptContext{GameName: "Cyberpunk RED"})

	if strings.Contains(got, "déjà présents") {
		t.Error("an empty campaign should not advertise an empty reuse list")
	}
}

func TestExpandPromptMarksTheTargetBeat(t *testing.T) {
	p := Proposal{
		Title:     "Ce qui tourne finit par revenir",
		Locations: []Location{{Ref: "l1", Name: "Le Kabuki noyé"}},
		NPCs:      []NPC{{Ref: "n1", Name: "Vanya Kovár", Role: "fixer"}},
		Scenes: []Scene{
			{Ref: "s1", Title: "Le contrat", Summary: "Vanya propose un job"},
			{Ref: "s2", Title: "Repérage", Summary: "Les PJs surveillent la tour",
				LocationRef: "l1", NPCRefs: flexStrings{"n1"}},
		},
	}
	got := ExpandPrompt(&p, &p.Scenes[1], "garde le ton sec", []string{"outcome"})

	if !strings.Contains(got, "> 2. Repérage") {
		t.Error("the beat being expanded should be marked in the running order")
	}
	for _, want := range []string{"Le contrat", "Le Kabuki noyé", "Vanya Kovár (fixer)", "garde le ton sec", "outcome"} {
		if !strings.Contains(got, want) {
			t.Errorf("expand prompt missing %q", want)
		}
	}
}
