package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

// ── NPC images ────────────────────────────────────────────────────────────────

func (h *ImageLLMHandler) GenerateNPCImages(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	npcID := chi.URLParam(r, "npcId")

	npc, err := db.GetCampaignNPC(r.Context(), h.db, npcID)
	if err != nil || npc == nil {
		writeError(w, http.StatusNotFound, "NPC not found")
		return
	}

	imgCfg, err := h.readImageConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error reading image config")
		return
	}
	if err := requireImageProviderConfigured(imgCfg); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	pendingDir := filepath.Join(h.uploadsDir, "npcs", npcID, "pending")
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

	var agentID string
	if imgCfg.Provider != "openrouter" {
		agentID, err = h.ensureGameAgent(r.Context(), game, imgCfg.MistralAPIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Mistral agent error: "+err.Error())
			return
		}
	}

	mentions := newMentionResolver(r.Context(), h.db, campaignID)
	prompt := appendVisualStyle(buildNPCImagePrompt(npc.Name, npc.Role, mentions.resolve(npc.Description)), imgCfg, game)

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	candidates, err := h.spawnImages(ctx, imgCfg, agentID, "npcs", npcID, pendingDir, prompt)
	if err != nil {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	if candidates == nil {
		candidates = []PendingImage{}
	}
	writeJSON(w, http.StatusOK, candidates)
}

func (h *ImageLLMHandler) ConfirmNPCImages(w http.ResponseWriter, r *http.Request) {
	npcID := chi.URLParam(r, "npcId")

	var body struct {
		Selected []string `json:"selected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	npc, err := db.GetCampaignNPC(r.Context(), h.db, npcID)
	if err != nil || npc == nil {
		writeError(w, http.StatusNotFound, "NPC not found")
		return
	}

	pendingDir := filepath.Join(h.uploadsDir, "npcs", npcID, "pending")
	finalDir := filepath.Join(h.uploadsDir, "npcs", npcID)
	if err := os.MkdirAll(finalDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create final dir")
		return
	}

	var images []NPCImage
	json.Unmarshal([]byte(npc.Images), &images) //nolint:errcheck

	for _, id := range body.Selected {
		src := filepath.Join(pendingDir, id+".png")
		dst := filepath.Join(finalDir, id+".png")
		if err := os.Rename(src, dst); err != nil {
			if copyFile(src, dst) == nil {
				os.Remove(src)
			}
		}
		url := fmt.Sprintf("/uploads/npcs/%s/%s.png", npcID, id)
		images = append(images, NPCImage{ID: id, URL: url, Label: ""})
	}

	os.RemoveAll(pendingDir)

	if images == nil {
		images = []NPCImage{}
	}
	imagesJSON, _ := json.Marshal(images)
	updated, err := db.UpdateNPCImages(r.Context(), h.db, npcID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── Location images ───────────────────────────────────────────────────────────

func (h *ImageLLMHandler) GenerateLocationImages(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	locationID := chi.URLParam(r, "locationId")

	location, err := db.GetCampaignLocation(r.Context(), h.db, locationID)
	if err != nil || location == nil {
		writeError(w, http.StatusNotFound, "location not found")
		return
	}

	imgCfg, err := h.readImageConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error reading image config")
		return
	}
	if err := requireImageProviderConfigured(imgCfg); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	pendingDir := filepath.Join(h.uploadsDir, "locations", locationID, "pending")
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

	var agentID string
	if imgCfg.Provider != "openrouter" {
		agentID, err = h.ensureGameAgent(r.Context(), game, imgCfg.MistralAPIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Mistral agent error: "+err.Error())
			return
		}
	}

	mentions := newMentionResolver(r.Context(), h.db, campaignID)
	prompt := appendVisualStyle(buildLocationImagePrompt(location.Name, location.Atmosphere, mentions.resolve(location.Description)), imgCfg, game)

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	candidates, err := h.spawnImages(ctx, imgCfg, agentID, "locations", locationID, pendingDir, prompt)
	if err != nil {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	if candidates == nil {
		candidates = []PendingImage{}
	}
	writeJSON(w, http.StatusOK, candidates)
}

func (h *ImageLLMHandler) ConfirmLocationImages(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "locationId")

	var body struct {
		Selected []string `json:"selected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	location, err := db.GetCampaignLocation(r.Context(), h.db, locationID)
	if err != nil || location == nil {
		writeError(w, http.StatusNotFound, "location not found")
		return
	}

	pendingDir := filepath.Join(h.uploadsDir, "locations", locationID, "pending")
	finalDir := filepath.Join(h.uploadsDir, "locations", locationID)
	if err := os.MkdirAll(finalDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create final dir")
		return
	}

	var images []LocationImage
	json.Unmarshal([]byte(location.Images), &images) //nolint:errcheck

	for _, id := range body.Selected {
		src := filepath.Join(pendingDir, id+".png")
		dst := filepath.Join(finalDir, id+".png")
		if err := os.Rename(src, dst); err != nil {
			if copyFile(src, dst) == nil {
				os.Remove(src)
			}
		}
		url := fmt.Sprintf("/uploads/locations/%s/%s.png", locationID, id)
		images = append(images, LocationImage{ID: id, URL: url, Label: "", Type: "illustration"})
	}

	os.RemoveAll(pendingDir)

	if images == nil {
		images = []LocationImage{}
	}
	imagesJSON, _ := json.Marshal(images)
	updated, err := db.UpdateLocationImages(r.Context(), h.db, locationID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── Faction images ────────────────────────────────────────────────────────────

func (h *ImageLLMHandler) GenerateFactionImages(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	factionID := chi.URLParam(r, "factionId")

	faction, err := db.GetCampaignFaction(r.Context(), h.db, factionID)
	if err != nil || faction == nil {
		writeError(w, http.StatusNotFound, "faction not found")
		return
	}

	imgCfg, err := h.readImageConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error reading image config")
		return
	}
	if err := requireImageProviderConfigured(imgCfg); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	pendingDir := filepath.Join(h.uploadsDir, "factions", factionID, "pending")
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

	var agentID string
	if imgCfg.Provider != "openrouter" {
		agentID, err = h.ensureGameAgent(r.Context(), game, imgCfg.MistralAPIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Mistral agent error: "+err.Error())
			return
		}
	}

	mentions := newMentionResolver(r.Context(), h.db, campaignID)
	prompt := appendVisualStyle(buildFactionImagePrompt(faction.Name, faction.Type, mentions.resolve(faction.Description)), imgCfg, game)

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	candidates, err := h.spawnImages(ctx, imgCfg, agentID, "factions", factionID, pendingDir, prompt)
	if err != nil {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	if candidates == nil {
		candidates = []PendingImage{}
	}
	writeJSON(w, http.StatusOK, candidates)
}

func (h *ImageLLMHandler) ConfirmFactionImages(w http.ResponseWriter, r *http.Request) {
	factionID := chi.URLParam(r, "factionId")

	var body struct {
		Selected []string `json:"selected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	faction, err := db.GetCampaignFaction(r.Context(), h.db, factionID)
	if err != nil || faction == nil {
		writeError(w, http.StatusNotFound, "faction not found")
		return
	}

	pendingDir := filepath.Join(h.uploadsDir, "factions", factionID, "pending")
	finalDir := filepath.Join(h.uploadsDir, "factions", factionID)
	if err := os.MkdirAll(finalDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create final dir")
		return
	}

	var images []FactionImage
	json.Unmarshal([]byte(faction.Images), &images) //nolint:errcheck

	for _, id := range body.Selected {
		src := filepath.Join(pendingDir, id+".png")
		dst := filepath.Join(finalDir, id+".png")
		if err := os.Rename(src, dst); err != nil {
			if copyFile(src, dst) == nil {
				os.Remove(src)
			}
		}
		url := fmt.Sprintf("/uploads/factions/%s/%s.png", factionID, id)
		images = append(images, FactionImage{ID: id, URL: url, Label: ""})
	}

	os.RemoveAll(pendingDir)

	if images == nil {
		images = []FactionImage{}
	}
	imagesJSON, _ := json.Marshal(images)
	updated, err := db.UpdateFactionImages(r.Context(), h.db, factionID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── Prompt builders ───────────────────────────────────────────────────────────

func buildNPCImagePrompt(name, role, description string) string {
	parts := fmt.Sprintf(`Character portrait of "%s"`, name)
	if role != "" {
		parts += fmt.Sprintf(", %s", role)
	}
	if description != "" {
		parts += fmt.Sprintf(". %s", description)
	}
	return parts
}

func buildLocationImagePrompt(name, atmosphere, description string) string {
	parts := fmt.Sprintf(`Illustration of a location named "%s"`, name)
	if atmosphere != "" {
		parts += fmt.Sprintf(". Atmosphere: %s", atmosphere)
	}
	if description != "" {
		parts += fmt.Sprintf(". %s", description)
	}
	return parts
}

func buildFactionImagePrompt(name, ftype, description string) string {
	parts := fmt.Sprintf(`Emblem or sigil for a faction named "%s"`, name)
	if ftype != "" {
		parts += fmt.Sprintf(" (%s)", ftype)
	}
	if description != "" {
		parts += fmt.Sprintf(". %s", description)
	}
	return parts
}
