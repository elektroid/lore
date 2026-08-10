package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"lore/internal/auth"
	db "lore/internal/db"
)

// MeHandler is the authenticated player's own view of the runs they are seated
// in — account-scoped only, no campaign story content. See docs/runs.md and
// the "Player mode" design in the four-modes plan: campaign_members does not
// grant read access to authored material today, so this surface deliberately
// stays limited to what the player's own account already owns (their
// characters, their seat, their private notes) plus non-spoiler session
// metadata (name, date, table token).
type MeHandler struct {
	db *sql.DB
}

// List returns every run the current user is seated in.
type listPlayerRunsResponse struct {
	Runs []db.PlayerRun `json:"runs"`
}

func (h *MeHandler) ListRuns(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	runs, err := db.ListRunsForPlayer(r.Context(), h.db, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, listPlayerRunsResponse{Runs: runs})
}

// GetRun returns one run's player-facing detail. 404s — not 403s — for a run
// the caller isn't seated in, same convention as the GM-facing routes: the id
// in the URL proves nothing on its own.
func (h *MeHandler) GetRun(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	runID := chi.URLParam(r, "runId")

	seated, err := db.IsRunPlayer(r.Context(), h.db, runID, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !seated {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	run, err := db.GetRunForPlayer(r.Context(), h.db, runID, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if run == nil {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	writeJSON(w, http.StatusOK, run)
}

// SetCharacter lets a seated player pick their own character for a run. An
// empty character_id clears the assignment.
type setOwnCharacterRequest struct {
	CharacterID string `json:"character_id"`
}

func (h *MeHandler) SetCharacter(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	runID := chi.URLParam(r, "runId")

	seated, err := db.IsRunPlayer(r.Context(), h.db, runID, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !seated {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	var req setOwnCharacterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.CharacterID != "" {
		owns, err := db.CharacterBelongsToUser(r.Context(), h.db, req.CharacterID, user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !owns {
			writeError(w, http.StatusForbidden, "character does not belong to you")
			return
		}
	}

	if err := db.SetOwnRunCharacter(r.Context(), h.db, runID, user.ID, req.CharacterID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	run, err := db.GetRunForPlayer(r.Context(), h.db, runID, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, run)
}

// GetNotes returns the caller's private note for a run — an empty note, not an
// error, if they haven't written one yet.
func (h *MeHandler) GetNotes(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	runID := chi.URLParam(r, "runId")

	seated, err := db.IsRunPlayer(r.Context(), h.db, runID, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !seated {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	note, err := db.GetRunNote(r.Context(), h.db, runID, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, note)
}

// PutNotes saves the caller's private note for a run.
type putNotesRequest struct {
	Body string `json:"body"`
}

func (h *MeHandler) PutNotes(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	runID := chi.URLParam(r, "runId")

	seated, err := db.IsRunPlayer(r.Context(), h.db, runID, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !seated {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	var req putNotesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	note, err := db.UpsertRunNote(r.Context(), h.db, runID, user.ID, req.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, note)
}
