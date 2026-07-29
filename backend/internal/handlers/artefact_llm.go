package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

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

	mistralCfg, err := h.readMistralConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error reading Mistral config")
		return
	}
	if mistralCfg.APIKey == "" {
		writeError(w, http.StatusBadRequest, "Mistral API key not configured — configure it in Settings")
		return
	}

	pendingDir := filepath.Join(h.uploadsDir, "artefacts", artefactID, "pending")
	os.RemoveAll(pendingDir)
	if err := os.MkdirAll(pendingDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create pending dir")
		return
	}

	game, err := h.getGameForCampaign(r.Context(), campaignID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error looking up game")
		return
	}

	agentID, err := h.ensureGameAgent(r.Context(), game, mistralCfg.APIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Mistral agent error: "+err.Error())
		return
	}

	mentions := newMentionResolver(r.Context(), h.db, campaignID)
	prompt := buildArtefactImagePrompt(artefact.Name, mentions.resolve(artefact.Description))

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	candidates, err := h.spawnImages(ctx, agentID, "artefacts", artefactID, pendingDir, prompt, mistralCfg.APIKey, mistralCfg.ImageCount)
	if err != nil {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	if candidates == nil {
		candidates = []PendingImage{}
	}
	writeJSON(w, http.StatusOK, candidates)
}

func (h *ImageLLMHandler) ConfirmArtefactImages(w http.ResponseWriter, r *http.Request) {
	artefactID := chi.URLParam(r, "artefactId")

	var body struct {
		Selected []string `json:"selected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	artefact, err := db.GetCampaignArtefact(r.Context(), h.db, artefactID)
	if err != nil || artefact == nil {
		writeError(w, http.StatusNotFound, "artefact not found")
		return
	}

	pendingDir := filepath.Join(h.uploadsDir, "artefacts", artefactID, "pending")
	finalDir := filepath.Join(h.uploadsDir, "artefacts", artefactID)
	if err := os.MkdirAll(finalDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create final dir")
		return
	}

	var images []ArtefactImage
	json.Unmarshal([]byte(artefact.Images), &images) //nolint:errcheck

	for _, id := range body.Selected {
		src := filepath.Join(pendingDir, id+".png")
		dst := filepath.Join(finalDir, id+".png")
		if err := os.Rename(src, dst); err != nil {
			if copyFile(src, dst) == nil {
				os.Remove(src)
			}
		}
		url := fmt.Sprintf("/uploads/artefacts/%s/%s.png", artefactID, id)
		images = append(images, ArtefactImage{ID: id, URL: url, Label: ""})
	}

	os.RemoveAll(pendingDir)

	if images == nil {
		images = []ArtefactImage{}
	}
	imagesJSON, _ := json.Marshal(images)
	updated, err := db.UpdateArtefactImages(r.Context(), h.db, artefactID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func buildArtefactImagePrompt(name, description string) string {
	desc := description
	if desc == "" {
		desc = "a mysterious artefact"
	}
	return fmt.Sprintf(`Illustration of an artefact named "%s". %s`, name, desc)
}
