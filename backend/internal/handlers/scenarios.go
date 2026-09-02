package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

type ScenarioHandler struct {
	db *sql.DB
}

func (h *ScenarioHandler) List(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "campaignID")
	scenarios, err := db.ListScenarios(r.Context(), h.db, campaignID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, scenarios)
}

func (h *ScenarioHandler) Create(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "campaignID")

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "le nom est requis")
		return
	}

	scenario, err := db.CreateScenario(r.Context(), h.db, db.CreateScenarioParams{
		CampaignID: campaignID,
		Name:       body.Name,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, scenario)
}

func (h *ScenarioHandler) Reorder(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "campaignID")

	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids requis")
		return
	}
	if err := db.ReorderScenariosIn(r.Context(), h.db, campaignID, body.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	scenarios, err := db.ListScenarios(r.Context(), h.db, campaignID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, scenarios)
}

func (h *ScenarioHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	scenario, err := db.GetScenario(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if scenario == nil {
		writeError(w, http.StatusNotFound, "scénario introuvable")
		return
	}
	writeJSON(w, http.StatusOK, scenario)
}

func (h *ScenarioHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var body struct {
		Name   string `json:"name"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "le nom est requis")
		return
	}
	if body.Status == "" {
		body.Status = "draft"
	}

	scenario, err := db.UpdateScenario(r.Context(), h.db, db.UpdateScenarioParams{
		ID:     id,
		Name:   body.Name,
		Status: body.Status,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if scenario == nil {
		writeError(w, http.StatusNotFound, "scénario introuvable")
		return
	}
	writeJSON(w, http.StatusOK, scenario)
}

func (h *ScenarioHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := db.DeleteScenario(r.Context(), h.db, id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ScenarioHandler) Duplicate(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "duplication non implémentée")
}
