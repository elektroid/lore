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

// DevelopNPCSuggestion generates enriched NPC fields without saving.
// The client shows a review dialog and applies after confirmation.
func (h *EntityHandler) DevelopNPCSuggestion(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	npcID := chi.URLParam(r, "npcId")

	npc, err := db.GetCampaignNPC(r.Context(), h.db, npcID)
	if err != nil || npc == nil {
		writeError(w, http.StatusNotFound, "PNJ introuvable")
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

	var sb strings.Builder
	sb.WriteString("Tu es un assistant spécialisé dans l'écriture de scénarios de jeux de rôle (JdR).\n")
	sb.WriteString("Tu réponds UNIQUEMENT avec du JSON valide, sans markdown, sans explication.\n")
	sb.WriteString("Réponds toujours en français.\n")
	appendCampaignContext(&sb, campaign)

	npcJSON, _ := json.Marshal(map[string]string{
		"name":        npc.Name,
		"role":        npc.Role,
		"description": npc.Description,
		"motivation":  npc.Motivation,
		"quote":       npc.Quote,
	})

	prompt := fmt.Sprintf(
		"Voici un PNJ dans une campagne JdR :\n%s\n\n"+
			"Décris ce personnage en 2 phrases max (physique + psychologie marquants), "+
			"affine sa motivation profonde en une phrase courte, et propose une réplique type mémorable.\n"+
			"Réponds avec : {\"role\":\"...\",\"description\":\"...\",\"motivation\":\"...\",\"quote\":\"...\"}",
		string(npcJSON))

	client := llm.NewClient(cfg)
	type npcResult struct {
		Role        string `json:"role"`
		Description string `json:"description"`
		Motivation  string `json:"motivation"`
		Quote       string `json:"quote"`
	}
	result, err := llm.Decode[npcResult](r.Context(), client, sb.String(), prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}
