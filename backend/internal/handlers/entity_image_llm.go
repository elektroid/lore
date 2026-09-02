package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

// generateEntityImages runs the Mistral/OpenRouter image-generation flow
// shared by every entity kind: config validation, pending-dir setup, agent
// negotiation, and the actual spawn. Only prompt-building varies per kind,
// so the caller supplies that as buildPrompt once it has already fetched
// (and 404-checked) the entity itself.
func (h *ImageLLMHandler) generateEntityImages(w http.ResponseWriter, r *http.Request, campaignID, kindDir, entityID string, buildPrompt func(imgCfg ImageConfig, game *db.Game) string) {
	imgCfg, err := h.readImageConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error reading image config")
		return
	}
	if err := requireImageProviderConfigured(imgCfg); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	pendingDir := filepath.Join(h.uploadsDir, kindDir, entityID, "pending")
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

	prompt := buildPrompt(imgCfg, game)

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	candidates, err := h.spawnImages(ctx, imgCfg, agentID, kindDir, entityID, pendingDir, prompt)
	if err != nil {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	if candidates == nil {
		candidates = []PendingImage{}
	}
	writeJSON(w, http.StatusOK, candidates)
}

// decodeSelectedImages reads the {"selected": [...]} body every Confirm*
// handler expects.
func decodeSelectedImages(w http.ResponseWriter, r *http.Request) ([]string, bool) {
	var body struct {
		Selected []string `json:"selected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return nil, false
	}
	return body.Selected, true
}

// confirmEntityImages runs the shared "promote selected pending images to
// final storage and persist the updated image list" flow. makeImage is the
// one real per-kind difference — e.g. LocationImage carries an extra Type
// field the others don't — and update is that kind's db.Update*Images.
func confirmEntityImages[T any, U any](
	w http.ResponseWriter, r *http.Request,
	h *ImageLLMHandler, kindDir, entityID, existingImagesJSON string, selected []string,
	makeImage func(id, url string) T,
	update func(ctx context.Context, database *sql.DB, id, imagesJSON string) (*U, error),
) {
	pendingDir := filepath.Join(h.uploadsDir, kindDir, entityID, "pending")
	finalDir := filepath.Join(h.uploadsDir, kindDir, entityID)
	if err := os.MkdirAll(finalDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create final dir")
		return
	}

	var images []T
	json.Unmarshal([]byte(existingImagesJSON), &images) //nolint:errcheck

	for _, id := range selected {
		src := filepath.Join(pendingDir, id+".png")
		dst := filepath.Join(finalDir, id+".png")
		if err := os.Rename(src, dst); err != nil {
			if copyFile(src, dst) == nil {
				os.Remove(src)
			}
		}
		url := fmt.Sprintf("/uploads/%s/%s/%s.png", kindDir, entityID, id)
		images = append(images, makeImage(id, url))
	}

	os.RemoveAll(pendingDir)

	if images == nil {
		images = []T{}
	}
	imagesJSON, _ := json.Marshal(images)
	updated, err := update(r.Context(), h.db, entityID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── NPC images ────────────────────────────────────────────────────────────────

func (h *ImageLLMHandler) GenerateNPCImages(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	npcID := chi.URLParam(r, "npcId")

	npc, err := db.GetCampaignNPC(r.Context(), h.db, npcID)
	if err != nil || npc == nil {
		writeError(w, http.StatusNotFound, "NPC not found")
		return
	}

	mentions := newMentionResolver(r.Context(), h.db, campaignID)
	h.generateEntityImages(w, r, campaignID, "npcs", npcID, func(imgCfg ImageConfig, game *db.Game) string {
		return appendVisualStyle(buildNPCImagePrompt(npc.Name, npc.Role, mentions.resolve(npc.Description)), imgCfg, game)
	})
}

func (h *ImageLLMHandler) ConfirmNPCImages(w http.ResponseWriter, r *http.Request) {
	npcID := chi.URLParam(r, "npcId")

	selected, ok := decodeSelectedImages(w, r)
	if !ok {
		return
	}

	npc, err := db.GetCampaignNPC(r.Context(), h.db, npcID)
	if err != nil || npc == nil {
		writeError(w, http.StatusNotFound, "NPC not found")
		return
	}

	confirmEntityImages(w, r, h, "npcs", npcID, npc.Images, selected,
		func(id, url string) NPCImage { return NPCImage{ID: id, URL: url, Label: ""} },
		db.UpdateNPCImages,
	)
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

	mentions := newMentionResolver(r.Context(), h.db, campaignID)
	h.generateEntityImages(w, r, campaignID, "locations", locationID, func(imgCfg ImageConfig, game *db.Game) string {
		return appendVisualStyle(buildLocationImagePrompt(location.Name, location.Atmosphere, mentions.resolve(location.Description)), imgCfg, game)
	})
}

func (h *ImageLLMHandler) ConfirmLocationImages(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "locationId")

	selected, ok := decodeSelectedImages(w, r)
	if !ok {
		return
	}

	location, err := db.GetCampaignLocation(r.Context(), h.db, locationID)
	if err != nil || location == nil {
		writeError(w, http.StatusNotFound, "location not found")
		return
	}

	confirmEntityImages(w, r, h, "locations", locationID, location.Images, selected,
		func(id, url string) LocationImage { return LocationImage{ID: id, URL: url, Label: "", Type: "illustration"} },
		db.UpdateLocationImages,
	)
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

	mentions := newMentionResolver(r.Context(), h.db, campaignID)
	h.generateEntityImages(w, r, campaignID, "factions", factionID, func(imgCfg ImageConfig, game *db.Game) string {
		return appendVisualStyle(buildFactionImagePrompt(faction.Name, faction.Type, mentions.resolve(faction.Description)), imgCfg, game)
	})
}

func (h *ImageLLMHandler) ConfirmFactionImages(w http.ResponseWriter, r *http.Request) {
	factionID := chi.URLParam(r, "factionId")

	selected, ok := decodeSelectedImages(w, r)
	if !ok {
		return
	}

	faction, err := db.GetCampaignFaction(r.Context(), h.db, factionID)
	if err != nil || faction == nil {
		writeError(w, http.StatusNotFound, "faction not found")
		return
	}

	confirmEntityImages(w, r, h, "factions", factionID, faction.Images, selected,
		func(id, url string) FactionImage { return FactionImage{ID: id, URL: url, Label: ""} },
		db.UpdateFactionImages,
	)
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
