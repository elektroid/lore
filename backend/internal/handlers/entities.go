package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

type EntityHandler struct {
	db     *sql.DB
	encKey string
}

// ── Campaign NPCs ─────────────────────────────────────────────────────────────

func (h *EntityHandler) ListNPCs(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListCampaignNPCs(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *EntityHandler) GetNPC(w http.ResponseWriter, r *http.Request) {
	npc, err := db.GetCampaignNPC(r.Context(), h.db, chi.URLParam(r, "npcId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if npc == nil {
		writeError(w, http.StatusNotFound, "PNJ introuvable")
		return
	}
	writeJSON(w, http.StatusOK, npc)
}

type npcBody struct {
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
	Quote       string `json:"quote"`
	Motivation  string `json:"motivation"`
}

func (h *EntityHandler) CreateNPC(w http.ResponseWriter, r *http.Request) {
	var b npcBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	npc, err := db.CreateCampaignNPC(r.Context(), h.db, chi.URLParam(r, "id"), b.Name, b.Role, b.Description, b.Quote, b.Motivation)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, npc)
}

func (h *EntityHandler) UpdateNPC(w http.ResponseWriter, r *http.Request) {
	var b npcBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	npc, err := db.UpdateCampaignNPC(r.Context(), h.db, chi.URLParam(r, "npcId"), b.Name, b.Role, b.Description, b.Quote, b.Motivation)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if npc == nil {
		writeError(w, http.StatusNotFound, "PNJ introuvable")
		return
	}
	writeJSON(w, http.StatusOK, npc)
}

func (h *EntityHandler) DeleteNPC(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteCampaignNPC(r.Context(), h.db, chi.URLParam(r, "npcId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Campaign Locations ────────────────────────────────────────────────────────

func (h *EntityHandler) ListLocations(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListCampaignLocations(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *EntityHandler) GetLocation(w http.ResponseWriter, r *http.Request) {
	loc, err := db.GetCampaignLocation(r.Context(), h.db, chi.URLParam(r, "locationId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if loc == nil {
		writeError(w, http.StatusNotFound, "lieu introuvable")
		return
	}
	writeJSON(w, http.StatusOK, loc)
}

type locationBody struct {
	Name        string `json:"name"`
	City        string `json:"city"`
	District    string `json:"district"`
	Description string `json:"description"`
	Atmosphere  string `json:"atmosphere"`
	Images      string `json:"images"`
}

func (h *EntityHandler) CreateLocation(w http.ResponseWriter, r *http.Request) {
	var b locationBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	loc, err := db.CreateCampaignLocation(r.Context(), h.db, chi.URLParam(r, "id"), b.Name, b.City, b.District, b.Description, b.Atmosphere)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, loc)
}

func (h *EntityHandler) UpdateLocation(w http.ResponseWriter, r *http.Request) {
	var b locationBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	images := b.Images
	if images == "" {
		images = "[]"
	}
	loc, err := db.UpdateCampaignLocation(r.Context(), h.db, chi.URLParam(r, "locationId"), b.Name, b.City, b.District, b.Description, b.Atmosphere, images)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if loc == nil {
		writeError(w, http.StatusNotFound, "lieu introuvable")
		return
	}
	writeJSON(w, http.StatusOK, loc)
}

func (h *EntityHandler) DeleteLocation(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteCampaignLocation(r.Context(), h.db, chi.URLParam(r, "locationId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}


// ── Campaign Artefacts ────────────────────────────────────────────────────────

func (h *EntityHandler) ListArtefacts(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListCampaignArtefacts(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *EntityHandler) GetArtefact(w http.ResponseWriter, r *http.Request) {
	a, err := db.GetCampaignArtefact(r.Context(), h.db, chi.URLParam(r, "artefactId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "artefact not found")
		return
	}
	writeJSON(w, http.StatusOK, a)
}

type artefactBody struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Images      string `json:"images"`
}

func (h *EntityHandler) CreateArtefact(w http.ResponseWriter, r *http.Request) {
	var b artefactBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	a, err := db.CreateCampaignArtefact(r.Context(), h.db, chi.URLParam(r, "id"), b.Name, b.Description)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

func (h *EntityHandler) UpdateArtefact(w http.ResponseWriter, r *http.Request) {
	var b artefactBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	images := b.Images
	if images == "" {
		images = "[]"
	}
	a, err := db.UpdateCampaignArtefact(r.Context(), h.db, chi.URLParam(r, "artefactId"), b.Name, b.Description, images)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "artefact not found")
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (h *EntityHandler) DeleteArtefact(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteCampaignArtefact(r.Context(), h.db, chi.URLParam(r, "artefactId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── NPC-Artefact Links ────────────────────────────────────────────────────────

func (h *EntityHandler) ListArtefactLinks(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListNPCArtefactLinks(r.Context(), h.db, chi.URLParam(r, "artefactId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type artefactLinkBody struct {
	NPCId  string `json:"npc_id"`
	Nature string `json:"nature"`
}

func (h *EntityHandler) CreateArtefactLink(w http.ResponseWriter, r *http.Request) {
	var b artefactLinkBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if b.NPCId == "" {
		writeError(w, http.StatusBadRequest, "npc_id required")
		return
	}
	link, err := db.CreateNPCArtefactLink(r.Context(), h.db, b.NPCId, chi.URLParam(r, "artefactId"), b.Nature)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, link)
}

func (h *EntityHandler) DeleteArtefactLink(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteNPCArtefactLink(r.Context(), h.db, chi.URLParam(r, "linkId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Campaign Factions ─────────────────────────────────────────────────────────

func (h *EntityHandler) ListFactions(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListCampaignFactions(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *EntityHandler) GetFaction(w http.ResponseWriter, r *http.Request) {
	f, err := db.GetCampaignFaction(r.Context(), h.db, chi.URLParam(r, "factionId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if f == nil {
		writeError(w, http.StatusNotFound, "faction introuvable")
		return
	}
	writeJSON(w, http.StatusOK, f)
}

type factionBody struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Motivation  string `json:"motivation"`
	Images      string `json:"images"`
}

func (h *EntityHandler) CreateFaction(w http.ResponseWriter, r *http.Request) {
	var b factionBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	f, err := db.CreateCampaignFaction(r.Context(), h.db, chi.URLParam(r, "id"), b.Name, b.Type, b.Description, b.Motivation)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (h *EntityHandler) UpdateFaction(w http.ResponseWriter, r *http.Request) {
	var b factionBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}
	images := b.Images
	if images == "" {
		images = "[]"
	}
	f, err := db.UpdateCampaignFaction(r.Context(), h.db, chi.URLParam(r, "factionId"), b.Name, b.Type, b.Description, b.Motivation, images)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if f == nil {
		writeError(w, http.StatusNotFound, "faction introuvable")
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (h *EntityHandler) DeleteFaction(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteCampaignFaction(r.Context(), h.db, chi.URLParam(r, "factionId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Global search ─────────────────────────────────────────────────────────────

func (h *EntityHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusOK, []db.SearchResult{})
		return
	}
	results, err := db.SearchCampaign(r.Context(), h.db, chi.URLParam(r, "id"), q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

