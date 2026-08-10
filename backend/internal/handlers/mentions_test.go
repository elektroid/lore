package handlers

import (
	"context"
	"strings"
	"testing"

	db "lore/internal/db"

	_ "modernc.org/sqlite"
)

// A mention only earns its keep if the model reads a name. These check the two
// halves of that: every kind of ref resolves, and a ref that no longer resolves
// still leaves a name behind rather than a uuid.

func TestResolveMentionsCoversEveryEntityKind(t *testing.T) {
	database := testDB(t)
	ctx := context.Background()

	campaign, err := db.CreateCampaign(ctx, database, db.CreateCampaignParams{Name: "Nuit blanche"})
	if err != nil {
		t.Fatalf("campaign: %v", err)
	}

	npc, err := db.CreateCampaignNPC(ctx, database, campaign.ID, "Rache Bartmoss", "netrunner légendaire", "", "", "", "")
	if err != nil {
		t.Fatalf("npc: %v", err)
	}
	artefact, err := db.CreateCampaignArtefact(ctx, database, campaign.ID, "Le Cortex noir", "")
	if err != nil {
		t.Fatalf("artefact: %v", err)
	}
	location, err := db.CreateCampaignLocation(ctx, database, campaign.ID, "Afterlife", "Night City", "Watson", "", "")
	if err != nil {
		t.Fatalf("location: %v", err)
	}
	faction, err := db.CreateCampaignFaction(ctx, database, campaign.ID, "Arasaka", "corpo", "", "")
	if err != nil {
		t.Fatalf("faction: %v", err)
	}

	mentions := newMentionResolver(ctx, database, campaign.ID)

	// PNJ refs are bare uuids; every other kind carries its prefix.
	text := "@[Rache](" + npc.ID + ") planque @[le cortex](artefact:" + artefact.ID + ")" +
		" à @[l'Afterlife](location:" + location.ID + "), loin d'@[Arasaka](faction:" + faction.ID + ")."

	got := mentions.resolve(text)

	// The PNJ's role rides along: a name alone tells the model nothing.
	want := "Rache Bartmoss (netrunner légendaire) planque Le Cortex noir à Afterlife, loin d'Arasaka."
	if got != want {
		t.Errorf("resolve\n got %q\nwant %q", got, want)
	}
	if strings.Contains(got, npc.ID) || strings.Contains(got, "artefact:") {
		t.Errorf("refs leaked into the prompt: %q", got)
	}
}

func TestResolveMentionsFallsBackToTheStoredName(t *testing.T) {
	database := testDB(t)
	ctx := context.Background()

	campaign, err := db.CreateCampaign(ctx, database, db.CreateCampaignParams{Name: "Nuit blanche"})
	if err != nil {
		t.Fatalf("campaign: %v", err)
	}
	mentions := newMentionResolver(ctx, database, campaign.ID)

	// Nothing in this campaign resolves — the deleted-entity case, and the case
	// of a prefix written by a newer frontend than this server.
	for _, ref := range []string{"3f2a-gone", "artefact:3f2a-gone", "sombrero:3f2a-gone"} {
		got := mentions.resolve("Il cherche @[Dexter DeShawn](" + ref + ") depuis.")
		if got != "Il cherche Dexter DeShawn depuis." {
			t.Errorf("ref %q: got %q", ref, got)
		}
	}
}

func TestResolveMentionsLeavesOrdinaryProseAlone(t *testing.T) {
	m := mentionResolver{labels: map[string]string{}}
	for _, text := range []string{
		"",
		"Une soirée sans personne à citer.",
		// A bare @ is how a mention starts being typed; it must survive a save.
		"Il s'appelle @ quelque chose, un mail@exemple.fr traîne aussi.",
		// Markdown links are the same shape minus the @ — they must not be eaten.
		"Voir [le dossier](https://exemple.fr/dossier).",
	} {
		if got := m.resolve(text); got != text {
			t.Errorf("resolve(%q) = %q, want unchanged", text, got)
		}
	}
}
