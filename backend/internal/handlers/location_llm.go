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

// DevelopLocation generates enriched description + atmosphere for a location.
// It returns suggestions only — the client applies them after user confirmation.
func (h *EntityHandler) DevelopLocation(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	locationID := chi.URLParam(r, "locationId")

	loc, err := db.GetCampaignLocation(r.Context(), h.db, locationID)
	if err != nil || loc == nil {
		writeError(w, http.StatusNotFound, "lieu introuvable")
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
		"name":        loc.Name,
		"atmosphere":  loc.Atmosphere,
		"description": loc.Description,
	}
	applyCurrentOverrides(current, req.Current, "name", "atmosphere", "description")

	var sb strings.Builder
	sb.WriteString("Tu es un assistant spécialisé dans l'écriture de scénarios de jeux de rôle (JdR).\n")
	sb.WriteString("Tu réponds UNIQUEMENT avec du JSON valide, sans markdown, sans explication.\n")
	sb.WriteString("Réponds toujours en français.\n")
	appendCampaignContext(&sb, campaign)
	appendSteering(&sb, req)

	locJSON, _ := json.Marshal(current)

	prompt := fmt.Sprintf(
		"Voici un lieu dans une campagne JdR :\n%s\n\n"+
			"Écris une description courte et immersive de ce lieu en 2 paragraphes maximum (150 mots max au total). "+
			"Elle doit être utilisable à voix haute pendant une session — évocatrice mais concise. "+
			"Affine aussi son atmosphère en une courte phrase (10 mots max). "+
			"Si une description ou atmosphère existe déjà, prolonge et affine l'idée plutôt que de la remplacer par une idée sans rapport.\n"+
			"Réponds avec : {\"description\":\"...\",\"atmosphere\":\"...\"}",
		string(locJSON))

	client := llm.NewClient(cfg)
	type locationResult struct {
		Description string `json:"description"`
		Atmosphere  string `json:"atmosphere"`
	}
	result, err := llm.Decode[locationResult](r.Context(), client, sb.String(), prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}
