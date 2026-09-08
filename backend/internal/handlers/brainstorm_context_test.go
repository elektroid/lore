package handlers

import (
	"strings"
	"testing"

	db "lore/internal/db"
	"lore/internal/llm"
)

func TestContextWarning(t *testing.T) {
	history := []llm.Message{{Role: "user", Content: strings.Repeat("a", 4000)}}
	prompt := strings.Repeat("b", 4000)
	// 8000 characters ≈ 2000 tokens.

	t.Run("silent well below the window", func(t *testing.T) {
		if got := contextWarning(262144, prompt, history); got != "" {
			t.Errorf("want no warning on a 256k window, got %q", got)
		}
	})

	t.Run("silent when the window is unknown", func(t *testing.T) {
		// Ollama declares no context length; guessing one would mean warning
		// about a wall that may not be there.
		if got := contextWarning(0, prompt, history); got != "" {
			t.Errorf("want no warning without a known window, got %q", got)
		}
	})

	t.Run("warns past three quarters", func(t *testing.T) {
		got := contextWarning(2500, prompt, history)
		if got == "" {
			t.Fatal("want a warning at 2000/2500 tokens")
		}
		if !strings.Contains(got, "2000") || !strings.Contains(got, "2500") || !strings.Contains(got, "80 %") {
			t.Errorf("warning should carry the numbers, got %q", got)
		}
	})

	t.Run("exactly at the threshold warns", func(t *testing.T) {
		if got := contextWarning(2000*100/75, prompt, history); got == "" {
			t.Error("want a warning right at 75%")
		}
	})
}

func TestEstimateTokensCountsPromptAndHistory(t *testing.T) {
	got := estimateTokens(strings.Repeat("x", 400), []llm.Message{
		{Content: strings.Repeat("y", 400)},
		{Content: strings.Repeat("z", 400)},
	})
	if got != 300 {
		t.Errorf("estimateTokens = %d, want 300", got)
	}
}

func TestAppendCampaignEntities(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	campaign, _ := mkCampaignScenario(t, database, "entities@test.local")
	other, _ := mkCampaignScenario(t, database, "other@test.local")
	campaignID := campaign.ID

	t.Run("silent on an empty campaign", func(t *testing.T) {
		var sb strings.Builder
		appendCampaignEntities(ctx, &sb, database, campaignID)
		if sb.String() != "" {
			t.Errorf("want nothing appended, got %q", sb.String())
		}
	})

	if _, err := db.CreateCampaignNPC(ctx, database, campaignID, "Smithy", "fixer", "d", "q", "m", ""); err != nil {
		t.Fatal(err)
	}
	// An entity left unnamed must not show up as an empty list item.
	if _, err := db.CreateCampaignNPC(ctx, database, campaignID, "", "", "", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateCampaignLocation(ctx, database, campaignID, "Heywood", "Night City", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateCampaignFaction(ctx, database, campaignID, "Arasaka", "corpo", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateCampaignArtefact(ctx, database, campaignID, "Black Lotus", ""); err != nil {
		t.Fatal(err)
	}
	// Another campaign's cast must not leak into this prompt.
	if _, err := db.CreateCampaignFaction(ctx, database, other.ID, "Militech", "corpo", "", ""); err != nil {
		t.Fatal(err)
	}

	var sb strings.Builder
	appendCampaignEntities(ctx, &sb, database, campaignID)
	got := sb.String()

	for _, want := range []string{"PNJ : Smithy", "Lieux : Heywood", "Factions : Arasaka", "Artefacts : Black Lotus"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "Militech") {
		t.Errorf("another campaign's faction leaked in:\n%s", got)
	}
	if strings.Contains(got, ", ,") || strings.Contains(got, ": ,") {
		t.Errorf("an unnamed entity produced an empty list item:\n%s", got)
	}
	// Names only — a description would risk carrying an unresolved mention ref.
	if strings.Contains(got, "fixer") || strings.Contains(got, "Night City") {
		t.Errorf("secondary fields leaked into the prompt:\n%s", got)
	}
}
