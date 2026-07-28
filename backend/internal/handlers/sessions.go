package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

type SessionHandler struct {
	db interface {
		QueryContext(ctx interface{}, query string, args ...interface{}) (interface{}, error)
	}
}

// ListSessions returns a scenario's sessions, narrowed to one group with
// ?run_id=. The console always passes it — two groups running the same scenario
// must not see each other's evenings.
func (h *SynopsisHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	runID := r.URL.Query().Get("run_id")
	if runID != "" && !h.runInScenarioCampaign(r, runID) {
		writeError(w, http.StatusNotFound, "groupe introuvable dans cette campagne")
		return
	}
	sessions, err := db.ListSessions(r.Context(), h.db, scenarioID, runID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (h *SynopsisHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	var body struct {
		RunID string `json:"run_id"`
		Name  string `json:"name"`
		Date  string `json:"date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	// An evening belongs to a group. Without one there is nowhere to record what
	// happened, and the scenario would inherit it as if it were written.
	if body.RunID == "" {
		writeError(w, http.StatusBadRequest, "run_id requis — une session appartient à un groupe")
		return
	}
	if !h.runInScenarioCampaign(r, body.RunID) {
		writeError(w, http.StatusNotFound, "groupe introuvable dans cette campagne")
		return
	}
	session, err := db.CreateSession(r.Context(), h.db, db.CreateSessionParams{
		ScenarioID: scenarioID,
		RunID:      body.RunID,
		Name:       body.Name,
		Date:       body.Date,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

// runInScenarioCampaign checks a run id that arrived on a scenario-scoped route.
// The route guard only proves the caller owns the scenario, which says nothing
// about a run id in the query string or body.
func (h *SynopsisHandler) runInScenarioCampaign(r *http.Request, runID string) bool {
	campaignID, err := db.CampaignIDForScenario(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil || campaignID == "" {
		return false
	}
	ok, err := db.RunInCampaign(r.Context(), h.db, runID, campaignID)
	return err == nil && ok
}

func (h *SynopsisHandler) UpdateSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	var body struct {
		Name             string `json:"name"`
		Date             string `json:"date"`
		ActiveLocationID string `json:"active_location_id"`
		ActiveSceneID    string `json:"active_scene_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	session, err := db.UpdateSession(r.Context(), h.db, db.UpdateSessionParams{
		ID:               sessionID,
		Name:             body.Name,
		Date:             body.Date,
		ActiveLocationID: body.ActiveLocationID,
		ActiveSceneID:    body.ActiveSceneID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (h *SynopsisHandler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	if err := db.DeleteSession(r.Context(), h.db, sessionID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SynopsisHandler) GetSessionScenes(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	states, err := db.ListSessionScenes(r.Context(), h.db, sessionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, states)
}

func (h *SynopsisHandler) SetSessionSceneState(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	sceneID := chi.URLParam(r, "sceneId")
	var body struct {
		State string `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.State == "" {
		writeError(w, http.StatusBadRequest, "state requis (cleared|void)")
		return
	}
	if body.State != "cleared" && body.State != "void" {
		writeError(w, http.StatusBadRequest, "state invalide")
		return
	}
	if err := db.SetSessionSceneState(r.Context(), h.db, sessionID, sceneID, body.State); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SynopsisHandler) ClearSessionSceneState(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	sceneID := chi.URLParam(r, "sceneId")
	if err := db.ClearSessionSceneState(r.Context(), h.db, sessionID, sceneID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
