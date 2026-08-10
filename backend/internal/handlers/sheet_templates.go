package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

// SheetTemplateHandler handles admin-authored character-sheet templates.
// Reading is open to any authenticated user — a campaign or game editor
// needs to read a template's shape to render a character/NPC sheet against
// it. Writing is the administrator's, same split as GameHandler.
type SheetTemplateHandler struct {
	db *sql.DB
}

func (h *SheetTemplateHandler) List(w http.ResponseWriter, r *http.Request) {
	templates, err := db.ListSheetTemplates(r.Context(), h.db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, templates)
}

func (h *SheetTemplateHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tmpl, err := db.GetSheetTemplate(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tmpl == nil {
		writeError(w, http.StatusNotFound, "sheet template not found")
		return
	}
	writeJSON(w, http.StatusOK, tmpl)
}

type sheetTemplateBody struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
}

func (h *SheetTemplateHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body sheetTemplateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if body.Schema == "" {
		body.Schema = `{"sections":[]}`
	}
	tmpl, err := db.CreateSheetTemplate(r.Context(), h.db, body.Name, body.Schema)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, tmpl)
}

func (h *SheetTemplateHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body sheetTemplateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if body.Schema == "" {
		body.Schema = `{"sections":[]}`
	}
	tmpl, err := db.UpdateSheetTemplate(r.Context(), h.db, id, body.Name, body.Schema)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tmpl == nil {
		writeError(w, http.StatusNotFound, "sheet template not found")
		return
	}
	writeJSON(w, http.StatusOK, tmpl)
}

func (h *SheetTemplateHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := db.DeleteSheetTemplate(r.Context(), h.db, id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
