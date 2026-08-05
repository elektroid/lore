package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
	"lore/internal/llm"
)

// DevelopFaction generates enriched description + motivation for a faction.
// It returns suggestions only — the client applies them field by field after
// GM review, same as NPCs, locations and artefacts.
func (h *EntityHandler) DevelopFaction(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	factionID := chi.URLParam(r, "factionId")

	faction, err := db.GetCampaignFaction(r.Context(), h.db, factionID)
	if err != nil || faction == nil {
		writeError(w, http.StatusNotFound, "faction introuvable")
		return
	}

	campaign, err := db.GetCampaign(r.Context(), h.db, campaignID)
	if err != nil || campaign == nil {
		writeError(w, http.StatusNotFound, "campagne introuvable")
		return
	}

	cfg, err := loadLLMConfig(r.Context(), h.db, h.encKey)
	if err != nil || cfg.BaseURL == "" {
		writeError(w, http.StatusBadRequest, "configuration LLM manquante — configurez-la dans les Paramètres")
		return
	}

	req := decodeDevelopRequest(r)
	current := map[string]string{
		"name":        faction.Name,
		"type":        faction.Type,
		"description": faction.Description,
		"motivation":  faction.Motivation,
	}
	applyCurrentOverrides(current, req.Current, "name", "type", "description", "motivation")
	// The GM may have cited other entities in these fields; the model needs
	// their names, not their refs. See mentions.go.
	newMentionResolver(r.Context(), h.db, campaignID).resolveAll(current)

	var sb strings.Builder
	sb.WriteString("Tu es un assistant spécialisé dans l'écriture de scénarios de jeux de rôle (JdR).\n")
	sb.WriteString("Tu réponds UNIQUEMENT avec du JSON valide, sans markdown, sans explication.\n")
	sb.WriteString("Réponds toujours en français.\n")
	appendCampaignContext(&sb, campaign)
	appendGameLoreContext(r.Context(), &sb, h.db, campaign.GameID, joinMapValues(current))
	appendSteering(&sb, req)

	factionJSON, _ := json.Marshal(current)

	prompt := fmt.Sprintf(
		"Voici une faction dans une campagne JdR :\n%s\n\n"+
			"Écris une description de cette faction en 2 paragraphes maximum (120 mots max) : structure, influence, méthodes. "+
			"Affine aussi sa motivation profonde en une phrase courte (15 mots max). "+
			"Si une description ou motivation existe déjà, prolonge et affine l'idée plutôt que de la remplacer par une idée sans rapport.\n"+
			"Réponds avec : {\"description\":\"...\",\"motivation\":\"...\"}",
		string(factionJSON))

	client := llm.NewClient(cfg)
	type factionResult struct {
		Description string `json:"description"`
		Motivation  string `json:"motivation"`
	}
	result, err := llm.Decode[factionResult](r.Context(), client, sb.String(), prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}
