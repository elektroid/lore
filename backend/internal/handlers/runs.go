package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

// Runs — a group of players and their playthrough of a campaign. Everything a
// group accumulates hangs off here rather than off the authored campaign, so
// two groups can run the same material without seeing each other's progress.
// See docs/adr/0001-runs-separate-story-from-play.md.
type RunHandler struct {
	db *sql.DB
}

func (h *RunHandler) List(w http.ResponseWriter, r *http.Request) {
	runs, err := db.ListRuns(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, runs)
}

func (h *RunHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "nom requis")
		return
	}
	run, err := db.CreateRun(r.Context(), h.db, chi.URLParam(r, "id"), body.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, run)
}

func (h *RunHandler) Get(w http.ResponseWriter, r *http.Request) {
	run, err := db.GetRun(r.Context(), h.db, chi.URLParam(r, "runId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if run == nil {
		writeError(w, http.StatusNotFound, "groupe introuvable")
		return
	}
	writeJSON(w, http.StatusOK, run)
}

var runStatuses = map[string]bool{"active": true, "finished": true, "archived": true}

func (h *RunHandler) Update(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name   string `json:"name"`
		Notes  string `json:"notes"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if body.Status == "" {
		body.Status = "active"
	}
	if !runStatuses[body.Status] {
		writeError(w, http.StatusBadRequest, "statut invalide (active|finished|archived)")
		return
	}
	run, err := db.UpdateRun(r.Context(), h.db, db.UpdateRunParams{
		ID:     chi.URLParam(r, "runId"),
		Name:   body.Name,
		Notes:  body.Notes,
		Status: body.Status,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, run)
}

// Delete removes the group and everything it played — sessions, rolls, beats,
// scene progress. The campaign it played is untouched.
func (h *RunHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteRun(r.Context(), h.db, chi.URLParam(r, "runId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Party ─────────────────────────────────────────────────────────────────────

func (h *RunHandler) ListPlayers(w http.ResponseWriter, r *http.Request) {
	players, err := db.ListRunPlayers(r.Context(), h.db, chi.URLParam(r, "runId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, players)
}

// SetPlayer adds someone to the party or reassigns their character.
//
// Both ids are checked against the campaign rather than trusted from the path:
// the route guard proves the caller owns the campaign, not that this user is a
// member of it or that this character is that user's.
func (h *RunHandler) SetPlayer(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	runID := chi.URLParam(r, "runId")
	userID := chi.URLParam(r, "userId")

	var body struct {
		CharacterID string `json:"character_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}

	member, err := db.IsCampaignMember(r.Context(), h.db, campaignID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !member {
		writeError(w, http.StatusNotFound, "cet utilisateur n'a pas accès à la campagne")
		return
	}

	if body.CharacterID != "" {
		owns, err := db.CharacterBelongsToUser(r.Context(), h.db, body.CharacterID, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !owns {
			writeError(w, http.StatusNotFound, "personnage introuvable pour ce joueur")
			return
		}
	}

	if err := db.SetRunPlayer(r.Context(), h.db, runID, userID, body.CharacterID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *RunHandler) RemovePlayer(w http.ResponseWriter, r *http.Request) {
	if err := db.RemoveRunPlayer(r.Context(), h.db,
		chi.URLParam(r, "runId"), chi.URLParam(r, "userId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Progress ──────────────────────────────────────────────────────────────────

// GetRunScenes returns how far a group has got in one scenario, as a map of
// scene id to state. Hangs off the scenario because that is what the caller is
// looking at; the run id is validated against the scenario's campaign.
func (h *SynopsisHandler) GetRunScenes(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	runID := chi.URLParam(r, "runId")
	if !h.runInScenarioCampaign(r, runID) {
		writeError(w, http.StatusNotFound, "groupe introuvable dans cette campagne")
		return
	}
	states, err := db.ListRunSceneStates(r.Context(), h.db, runID, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, states)
}
