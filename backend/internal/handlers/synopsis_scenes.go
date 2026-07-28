package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

func (h *SynopsisHandler) ListScenes(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	scenes, err := db.ListScenes(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, scenes)
}

func (h *SynopsisHandler) CreateScene(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	var body struct {
		Type        string `json:"type"`
		Status      string `json:"status"`
		SortOrder   int    `json:"sort_order"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Outcome     string `json:"outcome"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	scene, err := db.CreateScene(r.Context(), h.db, db.CreateSceneParams{
		ScenarioID:  scenarioID,
		Type:        body.Type,
		Status:      body.Status,
		SortOrder:   body.SortOrder,
		Title:       body.Title,
		Description: body.Description,
		Outcome:     body.Outcome,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, scene)
}

func (h *SynopsisHandler) UpdateScene(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	sceneID := chi.URLParam(r, "sceneId")
	var body struct {
		Title         string `json:"title"`
		Status        string `json:"status"`
		Description   string `json:"description"`
		Outcome       string `json:"outcome"`
		Notes         string `json:"notes"`
		LocationID    string `json:"location_id"`
		IsStart       bool   `json:"is_start"`
		IsEnd         bool   `json:"is_end"`
		PlaylistType  string `json:"playlist_type"`
		PlaylistValue string `json:"playlist_value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if body.LocationID != "" && !h.entityInScenarioCampaign(r, db.TableLocations, body.LocationID) {
		writeError(w, http.StatusNotFound, "lieu introuvable dans cette campagne")
		return
	}
	if body.IsStart {
		if err := db.ClearSceneStart(r.Context(), h.db, scenarioID); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	scene, err := db.UpdateScene(r.Context(), h.db, sceneID, db.UpdateSceneParams{
		Title:         body.Title,
		Status:        body.Status,
		Description:   body.Description,
		Outcome:       body.Outcome,
		Notes:         body.Notes,
		LocationID:    body.LocationID,
		IsStart:       body.IsStart,
		IsEnd:         body.IsEnd,
		PlaylistType:  body.PlaylistType,
		PlaylistValue: body.PlaylistValue,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, scene)
}

func (h *SynopsisHandler) DeleteScene(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteScene(r.Context(), h.db, chi.URLParam(r, "sceneId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SynopsisHandler) ReorderScenes(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids requis")
		return
	}
	if err := db.ReorderScenesIn(r.Context(), h.db, scenarioID, body.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	scenes, err := db.ListScenes(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, scenes)
}

func (h *SynopsisHandler) AddSceneNPC(w http.ResponseWriter, r *http.Request) {
	sceneID := chi.URLParam(r, "sceneId")
	var body struct {
		NPCID string `json:"npc_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.NPCID == "" {
		writeError(w, http.StatusBadRequest, "npc_id requis")
		return
	}
	if !h.entityInScenarioCampaign(r, db.TableNPCs, body.NPCID) {
		writeError(w, http.StatusNotFound, "PNJ introuvable dans cette campagne")
		return
	}
	if err := db.AddSceneNPC(r.Context(), h.db, sceneID, body.NPCID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	scene, err := db.GetScene(r.Context(), h.db, sceneID)
	if err != nil || scene == nil {
		writeError(w, http.StatusInternalServerError, "scène introuvable")
		return
	}
	writeJSON(w, http.StatusOK, scene)
}

func (h *SynopsisHandler) RemoveSceneNPC(w http.ResponseWriter, r *http.Request) {
	if err := db.RemoveSceneNPC(r.Context(), h.db, chi.URLParam(r, "sceneId"), chi.URLParam(r, "npcId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SynopsisHandler) AddSceneArtefact(w http.ResponseWriter, r *http.Request) {
	sceneID := chi.URLParam(r, "sceneId")
	var body struct {
		ArtefactID string `json:"artefact_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ArtefactID == "" {
		writeError(w, http.StatusBadRequest, "artefact_id required")
		return
	}
	if !h.entityInScenarioCampaign(r, db.TableArtefacts, body.ArtefactID) {
		writeError(w, http.StatusNotFound, "artefact introuvable dans cette campagne")
		return
	}
	if err := db.AddSceneArtefact(r.Context(), h.db, sceneID, body.ArtefactID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	scene, err := db.GetScene(r.Context(), h.db, sceneID)
	if err != nil || scene == nil {
		writeError(w, http.StatusInternalServerError, "scene not found")
		return
	}
	writeJSON(w, http.StatusOK, scene)
}

func (h *SynopsisHandler) RemoveSceneArtefact(w http.ResponseWriter, r *http.Request) {
	if err := db.RemoveSceneArtefact(r.Context(), h.db, chi.URLParam(r, "sceneId"), chi.URLParam(r, "artefactId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// entityInScenarioCampaign checks an id that arrived in a request body against
// the campaign behind the scenario in the URL. The route guards cover path
// params; ids in JSON need the same check or they become the way in.
func (h *SynopsisHandler) entityInScenarioCampaign(r *http.Request, table, entityID string) bool {
	campaignID, err := db.CampaignIDForScenario(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil || campaignID == "" {
		return false
	}
	return db.EntityInCampaign(r.Context(), h.db, table, entityID, campaignID)
}
