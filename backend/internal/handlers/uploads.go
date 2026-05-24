package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	db "lore/internal/db"
)

type UploadsHandler struct {
	db         *sql.DB
	uploadsDir string
}

type LocationImage struct {
	ID    string `json:"id"`
	URL   string `json:"url"`
	Label string `json:"label"`
	Type  string `json:"type"` // "illustration" | "map"
}

var allowedExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true,
}

func (h *UploadsHandler) UploadLocationImage(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "locationId")

	loc, err := db.GetCampaignLocation(r.Context(), h.db, locationID)
	if err != nil || loc == nil {
		writeError(w, http.StatusNotFound, "lieu introuvable")
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "fichier trop volumineux ou invalide")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "champ 'file' requis")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedExts[ext] {
		writeError(w, http.StatusBadRequest, "format non supporté (jpg, png, webp, gif)")
		return
	}

	imageID := uuid.New().String()
	filename := imageID + ext
	dir := filepath.Join(h.uploadsDir, "locations", locationID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "impossible de créer le répertoire")
		return
	}

	dst, err := os.Create(filepath.Join(dir, filename))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "impossible d'enregistrer le fichier")
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		writeError(w, http.StatusInternalServerError, "erreur lors de l'enregistrement")
		return
	}

	imgType := r.FormValue("type")
	if imgType != "map" {
		imgType = "illustration"
	}
	label := r.FormValue("label")

	url := fmt.Sprintf("/uploads/locations/%s/%s", locationID, filename)
	newImage := LocationImage{ID: imageID, URL: url, Label: label, Type: imgType}

	var images []LocationImage
	json.Unmarshal([]byte(loc.Images), &images) //nolint:errcheck
	images = append(images, newImage)

	imagesJSON, _ := json.Marshal(images)
	updated, err := db.UpdateLocationImages(r.Context(), h.db, locationID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, updated)
}

func (h *UploadsHandler) DeleteLocationImage(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "locationId")
	imageID := chi.URLParam(r, "imageId")

	loc, err := db.GetCampaignLocation(r.Context(), h.db, locationID)
	if err != nil || loc == nil {
		writeError(w, http.StatusNotFound, "lieu introuvable")
		return
	}

	var images []LocationImage
	json.Unmarshal([]byte(loc.Images), &images) //nolint:errcheck

	var kept []LocationImage
	var deleted *LocationImage
	for _, img := range images {
		if img.ID == imageID {
			deleted = &img
		} else {
			kept = append(kept, img)
		}
	}
	if deleted == nil {
		writeError(w, http.StatusNotFound, "image introuvable")
		return
	}

	// Remove file from disk (best-effort)
	if deleted.URL != "" {
		relPath := strings.TrimPrefix(deleted.URL, "/uploads/")
		_ = os.Remove(filepath.Join(h.uploadsDir, relPath))
	}

	if kept == nil {
		kept = []LocationImage{}
	}
	imagesJSON, _ := json.Marshal(kept)
	updated, err := db.UpdateLocationImages(r.Context(), h.db, locationID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *UploadsHandler) UpdateImageMeta(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "locationId")
	imageID := chi.URLParam(r, "imageId")

	var body struct {
		Label string `json:"label"`
		Type  string `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}

	loc, err := db.GetCampaignLocation(r.Context(), h.db, locationID)
	if err != nil || loc == nil {
		writeError(w, http.StatusNotFound, "lieu introuvable")
		return
	}

	var images []LocationImage
	json.Unmarshal([]byte(loc.Images), &images) //nolint:errcheck

	found := false
	for i := range images {
		if images[i].ID == imageID {
			if body.Label != "" {
				images[i].Label = body.Label
			}
			if body.Type == "map" || body.Type == "illustration" {
				images[i].Type = body.Type
			}
			found = true
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, "image introuvable")
		return
	}

	imagesJSON, _ := json.Marshal(images)
	updated, err := db.UpdateLocationImages(r.Context(), h.db, locationID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── NPC image handlers ────────────────────────────────────────────────────────

type NPCImage struct {
	ID    string `json:"id"`
	URL   string `json:"url"`
	Label string `json:"label"`
}

func (h *UploadsHandler) UploadNPCImage(w http.ResponseWriter, r *http.Request) {
	npcID := chi.URLParam(r, "npcId")

	npc, err := db.GetCampaignNPC(r.Context(), h.db, npcID)
	if err != nil || npc == nil {
		writeError(w, http.StatusNotFound, "PNJ introuvable")
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "fichier trop volumineux ou invalide")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "champ 'file' requis")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedExts[ext] {
		writeError(w, http.StatusBadRequest, "format non supporté (jpg, png, webp, gif)")
		return
	}

	imageID := uuid.New().String()
	filename := imageID + ext
	dir := filepath.Join(h.uploadsDir, "npcs", npcID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "impossible de créer le répertoire")
		return
	}

	dst, err := os.Create(filepath.Join(dir, filename))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "impossible d'enregistrer le fichier")
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		writeError(w, http.StatusInternalServerError, "erreur lors de l'enregistrement")
		return
	}

	url := fmt.Sprintf("/uploads/npcs/%s/%s", npcID, filename)
	newImage := NPCImage{ID: imageID, URL: url, Label: r.FormValue("label")}

	var images []NPCImage
	json.Unmarshal([]byte(npc.Images), &images) //nolint:errcheck
	images = append(images, newImage)

	imagesJSON, _ := json.Marshal(images)
	updated, err := db.UpdateNPCImages(r.Context(), h.db, npcID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, updated)
}

// ── Artefact image handlers ───────────────────────────────────────────────────

type ArtefactImage struct {
	ID    string `json:"id"`
	URL   string `json:"url"`
	Label string `json:"label"`
}

func (h *UploadsHandler) UploadArtefactImage(w http.ResponseWriter, r *http.Request) {
	artefactID := chi.URLParam(r, "artefactId")

	artefact, err := db.GetCampaignArtefact(r.Context(), h.db, artefactID)
	if err != nil || artefact == nil {
		writeError(w, http.StatusNotFound, "artefact not found")
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "fichier trop volumineux ou invalide")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "champ 'file' requis")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedExts[ext] {
		writeError(w, http.StatusBadRequest, "format non supporté (jpg, png, webp, gif)")
		return
	}

	imageID := uuid.New().String()
	filename := imageID + ext
	dir := filepath.Join(h.uploadsDir, "artefacts", artefactID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "impossible de créer le répertoire")
		return
	}

	dst, err := os.Create(filepath.Join(dir, filename))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "impossible d'enregistrer le fichier")
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		writeError(w, http.StatusInternalServerError, "erreur lors de l'enregistrement")
		return
	}

	url := fmt.Sprintf("/uploads/artefacts/%s/%s", artefactID, filename)
	newImage := ArtefactImage{ID: imageID, URL: url, Label: r.FormValue("label")}

	var images []ArtefactImage
	json.Unmarshal([]byte(artefact.Images), &images) //nolint:errcheck
	images = append(images, newImage)

	imagesJSON, _ := json.Marshal(images)
	updated, err := db.UpdateArtefactImages(r.Context(), h.db, artefactID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, updated)
}

func (h *UploadsHandler) DeleteArtefactImage(w http.ResponseWriter, r *http.Request) {
	artefactID := chi.URLParam(r, "artefactId")
	imageID := chi.URLParam(r, "imageId")

	artefact, err := db.GetCampaignArtefact(r.Context(), h.db, artefactID)
	if err != nil || artefact == nil {
		writeError(w, http.StatusNotFound, "artefact not found")
		return
	}

	var images []ArtefactImage
	json.Unmarshal([]byte(artefact.Images), &images) //nolint:errcheck

	var kept []ArtefactImage
	var deleted *ArtefactImage
	for _, img := range images {
		if img.ID == imageID {
			deleted = &img
		} else {
			kept = append(kept, img)
		}
	}
	if deleted == nil {
		writeError(w, http.StatusNotFound, "image introuvable")
		return
	}

	if deleted.URL != "" {
		relPath := strings.TrimPrefix(deleted.URL, "/uploads/")
		_ = os.Remove(filepath.Join(h.uploadsDir, relPath))
	}

	if kept == nil {
		kept = []ArtefactImage{}
	}
	imagesJSON, _ := json.Marshal(kept)
	updated, err := db.UpdateArtefactImages(r.Context(), h.db, artefactID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── Faction image handlers ────────────────────────────────────────────────────

type FactionImage struct {
	ID    string `json:"id"`
	URL   string `json:"url"`
	Label string `json:"label"`
}

func (h *UploadsHandler) UploadFactionImage(w http.ResponseWriter, r *http.Request) {
	factionID := chi.URLParam(r, "factionId")

	faction, err := db.GetCampaignFaction(r.Context(), h.db, factionID)
	if err != nil || faction == nil {
		writeError(w, http.StatusNotFound, "faction introuvable")
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "fichier trop volumineux ou invalide")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "champ 'file' requis")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedExts[ext] {
		writeError(w, http.StatusBadRequest, "format non supporté (jpg, png, webp, gif)")
		return
	}

	imageID := uuid.New().String()
	filename := imageID + ext
	dir := filepath.Join(h.uploadsDir, "factions", factionID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "impossible de créer le répertoire")
		return
	}

	dst, err := os.Create(filepath.Join(dir, filename))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "impossible d'enregistrer le fichier")
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		writeError(w, http.StatusInternalServerError, "erreur lors de l'enregistrement")
		return
	}

	url := fmt.Sprintf("/uploads/factions/%s/%s", factionID, filename)
	newImage := FactionImage{ID: imageID, URL: url, Label: r.FormValue("label")}

	var images []FactionImage
	json.Unmarshal([]byte(faction.Images), &images) //nolint:errcheck
	images = append(images, newImage)

	imagesJSON, _ := json.Marshal(images)
	updated, err := db.UpdateFactionImages(r.Context(), h.db, factionID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, updated)
}

func (h *UploadsHandler) DeleteFactionImage(w http.ResponseWriter, r *http.Request) {
	factionID := chi.URLParam(r, "factionId")
	imageID := chi.URLParam(r, "imageId")

	faction, err := db.GetCampaignFaction(r.Context(), h.db, factionID)
	if err != nil || faction == nil {
		writeError(w, http.StatusNotFound, "faction introuvable")
		return
	}

	var images []FactionImage
	json.Unmarshal([]byte(faction.Images), &images) //nolint:errcheck

	var kept []FactionImage
	var deleted *FactionImage
	for _, img := range images {
		if img.ID == imageID {
			deleted = &img
		} else {
			kept = append(kept, img)
		}
	}
	if deleted == nil {
		writeError(w, http.StatusNotFound, "image introuvable")
		return
	}

	if deleted.URL != "" {
		relPath := strings.TrimPrefix(deleted.URL, "/uploads/")
		_ = os.Remove(filepath.Join(h.uploadsDir, relPath))
	}

	if kept == nil {
		kept = []FactionImage{}
	}
	imagesJSON, _ := json.Marshal(kept)
	updated, err := db.UpdateFactionImages(r.Context(), h.db, factionID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *UploadsHandler) DeleteNPCImage(w http.ResponseWriter, r *http.Request) {
	npcID := chi.URLParam(r, "npcId")
	imageID := chi.URLParam(r, "imageId")

	npc, err := db.GetCampaignNPC(r.Context(), h.db, npcID)
	if err != nil || npc == nil {
		writeError(w, http.StatusNotFound, "PNJ introuvable")
		return
	}

	var images []NPCImage
	json.Unmarshal([]byte(npc.Images), &images) //nolint:errcheck

	var kept []NPCImage
	var deleted *NPCImage
	for _, img := range images {
		if img.ID == imageID {
			deleted = &img
		} else {
			kept = append(kept, img)
		}
	}
	if deleted == nil {
		writeError(w, http.StatusNotFound, "image introuvable")
		return
	}

	if deleted.URL != "" {
		relPath := strings.TrimPrefix(deleted.URL, "/uploads/")
		_ = os.Remove(filepath.Join(h.uploadsDir, relPath))
	}

	if kept == nil {
		kept = []NPCImage{}
	}
	imagesJSON, _ := json.Marshal(kept)
	updated, err := db.UpdateNPCImages(r.Context(), h.db, npcID, string(imagesJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
