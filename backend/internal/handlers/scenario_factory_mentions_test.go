package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	db "lore/internal/db"
	"lore/internal/factory"

	_ "modernc.org/sqlite"
)

// The linker is unit-tested next door; this covers the wiring, which is the part
// that can silently do nothing: materialise has to build the linker after every
// entity exists, and apply it to the pitch, the scenes and the descriptions of
// the entities it just created — but never to one it merely reused.
func TestCommitTurnsProposalNamesIntoMentions(t *testing.T) {
	database := testDB(t)
	ctx := context.Background()
	h := &ScenarioFactoryHandler{db: database}

	campaign, err := db.CreateCampaign(ctx, database, db.CreateCampaignParams{Name: "Nuit blanche"})
	if err != nil {
		t.Fatalf("campaign: %v", err)
	}

	// An entity the GM wrote before the factory ran, with prose of their own that
	// the commit must leave exactly as it is.
	existing, err := db.CreateCampaignLocation(ctx, database, campaign.ID,
		"Afterlife", "Night City", "Watson", "Le bar des solos. Arasaka n'y entre pas.", "enfumé")
	if err != nil {
		t.Fatalf("existing location: %v", err)
	}

	scenario, err := db.CreateScenario(ctx, database, db.CreateScenarioParams{
		CampaignID: campaign.ID, Name: "Le Cortex noir",
	})
	if err != nil {
		t.Fatalf("scenario: %v", err)
	}

	proposal := factory.Proposal{
		Pitch: "Rache Bartmoss a caché le Cortex noir quelque part dans l'Afterlife.",
		Factions: []factory.Faction{
			{Ref: "f1", Name: "Arasaka", Type: "corpo", Description: "La corpo qui traque Rache Bartmoss."},
		},
		Locations: []factory.Location{
			// Same name as the pre-existing row: reused, not created.
			{Ref: "loc1", Name: "Afterlife", City: "Night City"},
		},
		NPCs: []factory.NPC{
			{Ref: "n1", Name: "Rache Bartmoss", Role: "netrunner", Description: "Un netrunner en fuite, planqué à l'Afterlife."},
		},
		Artefacts: []factory.Artefact{
			{Ref: "a1", Name: "Le Cortex noir", Description: "Appartient à Rache Bartmoss, convoité par Arasaka."},
		},
		Scenes: []factory.Scene{
			{Ref: "s1", Title: "Le comptoir", Status: factory.StatusIdea, LocationRef: "loc1",
				Description: "Rache Bartmoss attend au comptoir de l'Afterlife, loin d'Arasaka."},
		},
	}
	factory.SetAllIncluded(&proposal)

	if err := h.materialise(ctx, campaign.ID, scenario.ID, proposal); err != nil {
		t.Fatalf("materialise: %v", err)
	}

	npcs, _ := db.ListCampaignNPCs(ctx, database, campaign.ID)
	artefacts, _ := db.ListCampaignArtefacts(ctx, database, campaign.ID)
	factions, _ := db.ListCampaignFactions(ctx, database, campaign.ID)
	locations, _ := db.ListCampaignLocations(ctx, database, campaign.ID)
	if len(npcs) != 1 || len(artefacts) != 1 || len(factions) != 1 {
		t.Fatalf("entities: %d npc, %d artefact, %d faction", len(npcs), len(artefacts), len(factions))
	}
	if len(locations) != 1 {
		t.Fatalf("the existing Afterlife should have been reused, got %d locations", len(locations))
	}

	npcRef := npcMentionRef(npcs[0].ID)
	artefactRef := artefactMentionRef(artefacts[0].ID)
	factionRef := factionMentionRef(factions[0].ID)
	locationRef := locationMentionRef(existing.ID)

	// The scene: three names, three chips, the location pointing at the row that
	// already existed.
	scenes, err := db.ListScenes(ctx, database, scenario.ID)
	if err != nil || len(scenes) != 1 {
		t.Fatalf("scenes: %v (%d)", err, len(scenes))
	}
	wantScene := "@[Rache Bartmoss](" + npcRef + ") attend au comptoir de l'@[Afterlife](" + locationRef +
		"), loin d'@[Arasaka](" + factionRef + ")."
	if scenes[0].Description != wantScene {
		t.Errorf("scene description\n got %q\nwant %q", scenes[0].Description, wantScene)
	}

	// The pitch, stored inside the synopsis hook.
	synopsis, err := db.GetSynopsisByScenario(ctx, database, scenario.ID)
	if err != nil || synopsis == nil {
		t.Fatalf("synopsis: %v", err)
	}
	var hook struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(synopsis.Hook), &hook); err != nil {
		t.Fatalf("hook: %v", err)
	}
	if !strings.Contains(hook.Content, "@[Rache Bartmoss]("+npcRef+")") ||
		!strings.Contains(hook.Content, "@[Le Cortex noir]("+artefactRef+")") ||
		!strings.Contains(hook.Content, "@[Afterlife]("+locationRef+")") {
		t.Errorf("pitch not linked: %q", hook.Content)
	}

	// The artefact's own description — the case that started all this: an artefact
	// that belongs to a PNJ now says so with a chip.
	wantArtefact := "Appartient à @[Rache Bartmoss](" + npcRef + "), convoité par @[Arasaka](" + factionRef + ")."
	if artefacts[0].Description != wantArtefact {
		t.Errorf("artefact description\n got %q\nwant %q", artefacts[0].Description, wantArtefact)
	}

	// A created PNJ's description links others but never itself.
	wantNPC := "Un netrunner en fuite, planqué à l'@[Afterlife](" + locationRef + ")."
	if npcs[0].Description != wantNPC {
		t.Errorf("npc description\n got %q\nwant %q", npcs[0].Description, wantNPC)
	}
	if strings.Contains(npcs[0].Description, npcRef) {
		t.Errorf("npc linked to itself: %q", npcs[0].Description)
	}

	// The reused location keeps the GM's words, unlinked and unedited.
	if locations[0].Description != "Le bar des solos. Arasaka n'y entre pas." {
		t.Errorf("reused location was rewritten: %q", locations[0].Description)
	}
}
