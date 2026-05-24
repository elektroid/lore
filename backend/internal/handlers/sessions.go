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

func (h *SynopsisHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	sessions, err := db.ListSessions(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (h *SynopsisHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	var body struct {
		Name string `json:"name"`
		Date string `json:"date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	session, err := db.CreateSession(r.Context(), h.db, db.CreateSessionParams{
		ScenarioID: scenarioID,
		Name:       body.Name,
		Date:       body.Date,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (h *SynopsisHandler) UpdateSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	var body struct {
		Name             string `json:"name"`
		Date             string `json:"date"`
		Players          string `json:"players"`
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
		Players:          body.Players,
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

// ── Session players ───────────────────────────────────────────────────────────

func (h *SynopsisHandler) ListSessionPlayers(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	players, err := db.ListSessionPlayers(r.Context(), h.db, sessionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, players)
}

func (h *SynopsisHandler) SetSessionPlayer(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	userID := chi.URLParam(r, "userId")
	var body struct {
		CharacterID string `json:"character_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if err := db.SetSessionPlayer(r.Context(), h.db, sessionID, userID, body.CharacterID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SynopsisHandler) RemoveSessionPlayer(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	userID := chi.URLParam(r, "userId")
	if err := db.RemoveSessionPlayer(r.Context(), h.db, sessionID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
