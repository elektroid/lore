package handlers

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

// The printable campaign — everything the document needs, in one request.
//
// A campaign print is the whole book: the pitch, every scenario with its scenes,
// and the entire cast, gazetteer and props with their pictures. Assembling that
// from the existing endpoints means one request per scenario times four entity
// types, all of them fired from a page that must be fully painted before
// `window.print()` runs. One payload removes an entire class of "the PDF came
// out with half the portraits missing".
//
// Guarded by requireCampaignAccess, not owner: a delegated Meneur printing the
// campaign to run it at a table is exactly the point.
// See docs/print.md.

// printCampaign is the campaign as the book needs it, and no more.
//
// Deliberately not db.Campaign: that carries llm_config, which can hold an
// encrypted API key. A document has no use for it, and a payload that ships
// what it does not need is a payload waiting to be pasted somewhere.
type printCampaign struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Genre    string `json:"genre"`
	GameName string `json:"game_name"`
	Pitch    string `json:"pitch"`
}

type printDoc struct {
	Campaign  printCampaign         `json:"campaign"`
	Scenarios []printScenario       `json:"scenarios"`
	NPCs      []db.CampaignNPC      `json:"npcs"`
	Locations []db.CampaignLocation `json:"locations"`
	Factions  []db.CampaignFaction  `json:"factions"`
	Artefacts []db.CampaignArtefact `json:"artefacts"`
}

type printScenario struct {
	Scenario db.Scenario          `json:"scenario"`
	Synopsis *db.Synopsis         `json:"synopsis"`
	Scenes   []db.Scene           `json:"scenes"`
	NPCs     []db.SynopsisNPC     `json:"synopsis_npcs"`
	Factions []db.SynopsisFaction `json:"synopsis_factions"`
}

type PrintHandler struct {
	db *sql.DB
}

func (h *PrintHandler) Campaign(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	campaign, err := db.GetCampaign(ctx, h.db, id)
	if err != nil || campaign == nil {
		writeError(w, http.StatusNotFound, "campagne introuvable")
		return
	}

	doc := printDoc{
		Campaign: printCampaign{
			ID:       campaign.ID,
			Name:     campaign.Name,
			Genre:    campaign.Genre,
			GameName: campaign.GameName,
			Pitch:    campaign.Pitch,
		},
		Scenarios: []printScenario{},
		NPCs:      []db.CampaignNPC{},
		Locations: []db.CampaignLocation{},
		Factions:  []db.CampaignFaction{},
		Artefacts: []db.CampaignArtefact{},
	}

	// An entity list that fails to load costs that appendix, not the document.
	// A GM printing at midnight before a session wants the scenes even if the
	// gazetteer query fell over.
	if v, err := db.ListCampaignNPCs(ctx, h.db, id); err == nil {
		doc.NPCs = v
	}
	if v, err := db.ListCampaignLocations(ctx, h.db, id); err == nil {
		doc.Locations = v
	}
	if v, err := db.ListCampaignFactions(ctx, h.db, id); err == nil {
		doc.Factions = v
	}
	if v, err := db.ListCampaignArtefacts(ctx, h.db, id); err == nil {
		doc.Artefacts = v
	}

	scenarios, err := db.ListScenarios(ctx, h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, s := range scenarios {
		// Archived scenarios are out of the campaign's running order and out of
		// its book — the author archived them to stop thinking about them.
		if s.ArchivedAt != nil && *s.ArchivedAt != "" {
			continue
		}
		ps := printScenario{
			Scenario: s,
			Scenes:   []db.Scene{},
			NPCs:     []db.SynopsisNPC{},
			Factions: []db.SynopsisFaction{},
		}
		ps.Synopsis, _ = db.GetSynopsisByScenario(ctx, h.db, s.ID)
		if v, err := db.ListScenes(ctx, h.db, s.ID); err == nil {
			ps.Scenes = v
		}
		if v, err := db.ListSynopsisNPCs(ctx, h.db, s.ID); err == nil {
			ps.NPCs = v
		}
		if v, err := db.ListSynopsisFactions(ctx, h.db, s.ID); err == nil {
			ps.Factions = v
		}
		doc.Scenarios = append(doc.Scenarios, ps)
	}

	writeJSON(w, http.StatusOK, doc)
}
