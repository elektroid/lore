package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"lore/internal/auth"
	db "lore/internal/db"
)

// DoodleHandler serves the doodle scheduling poll: a GM-owned title plus a
// handful of proposed date/time slots, shared by URL. See schema.sql for why
// it carries no campaign, run or player reference — a doodle is a plain
// utility, not part of the story/play model.
//
// Two trust levels live in this one file: everything under /doodles/{id} is
// the owner's authenticated management view, everything under
// /doodles/share/{token} is the public voting page (see isPublicEndpoint).
type DoodleHandler struct {
	db *sql.DB
}

type doodleDetail struct {
	Doodle      db.Doodle                  `json:"doodle"`
	Slots       []db.DoodleSlot            `json:"slots"`
	Respondents []db.DoodleRespondentVotes `json:"respondents"`
}

func (h *DoodleHandler) loadDetail(w http.ResponseWriter, r *http.Request, doodle *db.Doodle) {
	slots, err := db.ListDoodleSlots(r.Context(), h.db, doodle.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondents, err := db.ListDoodleRespondentVotes(r.Context(), h.db, doodle.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, doodleDetail{Doodle: *doodle, Slots: slots, Respondents: respondents})
}

// ── Owner-authenticated ──────────────────────────────────────────────────────

func (h *DoodleHandler) List(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	doodles, err := db.ListDoodlesByOwner(r.Context(), h.db, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, doodles)
}

type doodleBody struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Closed      bool   `json:"closed"`
}

func (h *DoodleHandler) Create(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	var body doodleBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	body.Title = strings.TrimSpace(body.Title)
	if body.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	doodle, err := db.CreateDoodle(r.Context(), h.db, user.ID, body.Title, body.Description)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.loadDetail(w, r, doodle)
}

// loadOwned fetches a doodle and checks the caller owns it, writing an error
// response and returning nil if not.
func (h *DoodleHandler) loadOwned(w http.ResponseWriter, r *http.Request) *db.Doodle {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return nil
	}
	id := chi.URLParam(r, "id")
	doodle, err := db.GetDoodle(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if doodle == nil {
		writeError(w, http.StatusNotFound, "doodle not found")
		return nil
	}
	if doodle.OwnerID != user.ID && user.Role != "superuser" {
		writeError(w, http.StatusForbidden, "not your doodle")
		return nil
	}
	return doodle
}

func (h *DoodleHandler) Get(w http.ResponseWriter, r *http.Request) {
	doodle := h.loadOwned(w, r)
	if doodle == nil {
		return
	}
	h.loadDetail(w, r, doodle)
}

func (h *DoodleHandler) Update(w http.ResponseWriter, r *http.Request) {
	doodle := h.loadOwned(w, r)
	if doodle == nil {
		return
	}
	var body doodleBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	body.Title = strings.TrimSpace(body.Title)
	if body.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	updated, err := db.UpdateDoodle(r.Context(), h.db, doodle.ID, body.Title, body.Description, body.Closed)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.loadDetail(w, r, updated)
}

func (h *DoodleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	doodle := h.loadOwned(w, r)
	if doodle == nil {
		return
	}
	if err := db.DeleteDoodle(r.Context(), h.db, doodle.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type doodleSlotBody struct {
	StartsAt string `json:"starts_at"`
}

func (h *DoodleHandler) AddSlot(w http.ResponseWriter, r *http.Request) {
	doodle := h.loadOwned(w, r)
	if doodle == nil {
		return
	}
	var body doodleSlotBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.StartsAt == "" {
		writeError(w, http.StatusBadRequest, "starts_at is required")
		return
	}
	if _, err := db.AddDoodleSlot(r.Context(), h.db, doodle.ID, body.StartsAt); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.loadDetail(w, r, doodle)
}

func (h *DoodleHandler) UpdateSlot(w http.ResponseWriter, r *http.Request) {
	doodle := h.loadOwned(w, r)
	if doodle == nil {
		return
	}
	var body doodleSlotBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.StartsAt == "" {
		writeError(w, http.StatusBadRequest, "starts_at is required")
		return
	}
	slotID := chi.URLParam(r, "slotId")
	if err := db.UpdateDoodleSlot(r.Context(), h.db, doodle.ID, slotID, body.StartsAt); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "slot not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.loadDetail(w, r, doodle)
}

func (h *DoodleHandler) DeleteSlot(w http.ResponseWriter, r *http.Request) {
	doodle := h.loadOwned(w, r)
	if doodle == nil {
		return
	}
	slotID := chi.URLParam(r, "slotId")
	if err := db.DeleteDoodleSlot(r.Context(), h.db, doodle.ID, slotID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.loadDetail(w, r, doodle)
}

// ── Public (share token) ─────────────────────────────────────────────────────

func (h *DoodleHandler) PublicGet(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	doodle, err := db.GetDoodleByShareToken(r.Context(), h.db, token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if doodle == nil {
		writeError(w, http.StatusNotFound, "doodle not found")
		return
	}
	slots, err := db.ListDoodleSlots(r.Context(), h.db, doodle.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondents, err := db.ListDoodleRespondentVotes(r.Context(), h.db, doodle.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// The public page gets the title/description/closed state, never the
	// owner ID or share token itself.
	writeJSON(w, http.StatusOK, map[string]any{
		"title":       doodle.Title,
		"description": doodle.Description,
		"closed":      doodle.Closed,
		"slots":       slots,
		"respondents": respondents,
	})
}

type doodlePublicVoteBody struct {
	Name    string            `json:"name"`
	Answers map[string]string `json:"answers"`
}

func (h *DoodleHandler) PublicVote(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	doodle, err := db.GetDoodleByShareToken(r.Context(), h.db, token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if doodle == nil {
		writeError(w, http.StatusNotFound, "doodle not found")
		return
	}
	if doodle.Closed {
		writeError(w, http.StatusForbidden, "ce sondage est clos")
		return
	}
	var body doodlePublicVoteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if len(body.Name) > 80 {
		writeError(w, http.StatusBadRequest, "name is too long")
		return
	}
	rv, err := db.SubmitDoodleVotes(r.Context(), h.db, doodle.ID, body.Name, body.Answers)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rv)
}
