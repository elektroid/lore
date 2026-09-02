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

// ── LLM develop ───────────────────────────────────────────────────────────────

func (h *ImageLLMHandler) DevelopArtefact(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	artefactID := chi.URLParam(r, "artefactId")

	artefact, err := db.GetCampaignArtefact(r.Context(), h.db, artefactID)
	if err != nil || artefact == nil {
		writeError(w, http.StatusNotFound, "artefact not found")
		return
	}

	campaign, err := db.GetCampaign(r.Context(), h.db, campaignID)
	if err != nil || campaign == nil {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}

	cfg, err := loadLLMConfig(r.Context(), h.db, h.encKey)
	if err != nil || cfg.BaseURL == "" {
		writeError(w, http.StatusBadRequest, "LLM config missing — configure it in Settings")
		return
	}

	req := decodeDevelopRequest(r)
	current := map[string]string{
		"name":        artefact.Name,
		"description": artefact.Description,
	}
	applyCurrentOverrides(current, req.Current, "name", "description")
	// The GM may have cited other entities in these fields; the model needs
	// their names, not their refs. See mentions.go.
	newMentionResolver(r.Context(), h.db, campaignID).resolveAll(current)

	var sb strings.Builder
	sb.WriteString("You are an assistant specialized in writing tabletop RPG scenarios.\n")
	sb.WriteString("Respond ONLY with valid JSON, no markdown, no explanation.\n")
	sb.WriteString("Always respond in French.\n")
	appendCampaignContext(&sb, campaign)
	appendGameLoreContext(r.Context(), &sb, h.db, campaign.GameID, joinMapValues(current))
	appendSteering(&sb, req)

	artefactJSON, _ := json.Marshal(current)

	prompt := fmt.Sprintf(
		"Voici un artefact dans une campagne JdR :\n%s\n\n"+
			"Écris une description évocatrice de cet artefact en 2 paragraphes maximum (150 mots max). "+
			"Elle doit être utilisable à voix haute pendant une session — mystérieuse et immersive. "+
			"Si une description existe déjà, prolonge et affine l'idée plutôt que de la remplacer par une idée sans rapport.\n"+
			"Réponds avec : {\"description\":\"...\"}",
		string(artefactJSON))

	client := llm.NewClient(cfg)
	type artefactResult struct {
		Description string `json:"description"`
	}
	result, err := llm.Decode[artefactResult](r.Context(), client, sb.String(), prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "LLM error: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ── Mistral image generation ──────────────────────────────────────────────────

func (h *ImageLLMHandler) GenerateArtefactImages(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	artefactID := chi.URLParam(r, "artefactId")

	artefact, err := db.GetCampaignArtefact(r.Context(), h.db, artefactID)
	if err != nil || artefact == nil {
		writeError(w, http.StatusNotFound, "artefact not found")
		return
	}

	mentions := newMentionResolver(r.Context(), h.db, campaignID)
	h.generateEntityImages(w, r, campaignID, "artefacts", artefactID, func(imgCfg ImageConfig, game *db.Game) string {
		return appendVisualStyle(buildArtefactImagePrompt(artefact.Name, mentions.resolve(artefact.Description)), imgCfg, game)
	})
}

func (h *ImageLLMHandler) ConfirmArtefactImages(w http.ResponseWriter, r *http.Request) {
	artefactID := chi.URLParam(r, "artefactId")

	selected, ok := decodeSelectedImages(w, r)
	if !ok {
		return
	}

	artefact, err := db.GetCampaignArtefact(r.Context(), h.db, artefactID)
	if err != nil || artefact == nil {
		writeError(w, http.StatusNotFound, "artefact not found")
		return
	}

	confirmEntityImages(w, r, h, "artefacts", artefactID, artefact.Images, selected,
		func(id, url string) ArtefactImage { return ArtefactImage{ID: id, URL: url, Label: ""} },
		db.UpdateArtefactImages,
	)
}

func buildArtefactImagePrompt(name, description string) string {
	desc := description
	if desc == "" {
		desc = "a mysterious artefact"
	}
	return fmt.Sprintf(`Illustration of an artefact named "%s". %s`, name, desc)
}
