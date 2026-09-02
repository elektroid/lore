package handlers

import (
	"database/sql"
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
	writeList(w, list, err)
}

func (h *EntityHandler) GetNPC(w http.ResponseWriter, r *http.Request) {
	npc, err := db.GetCampaignNPC(r.Context(), h.db, chi.URLParam(r, "npcId"))
	writeEntity(w, npc, err, "PNJ introuvable")
}

type npcBody struct {
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
	Quote       string `json:"quote"`
	Motivation  string `json:"motivation"`
	Sheet       string `json:"sheet"`
}

func (h *EntityHandler) CreateNPC(w http.ResponseWriter, r *http.Request) {
	b, ok := decodeJSON[npcBody](w, r, "corps invalide")
	if !ok {
		return
	}
	npc, err := db.CreateCampaignNPC(r.Context(), h.db, chi.URLParam(r, "id"), b.Name, b.Role, b.Description, b.Quote, b.Motivation, b.Sheet)
	writeCreated(w, npc, err)
}

func (h *EntityHandler) UpdateNPC(w http.ResponseWriter, r *http.Request) {
	b, ok := decodeJSON[npcBody](w, r, "corps invalide")
	if !ok {
		return
	}
	npc, err := db.UpdateCampaignNPC(r.Context(), h.db, chi.URLParam(r, "npcId"), b.Name, b.Role, b.Description, b.Quote, b.Motivation, b.Sheet)
	writeEntity(w, npc, err, "PNJ introuvable")
}

func (h *EntityHandler) DeleteNPC(w http.ResponseWriter, r *http.Request) {
	err := db.DeleteCampaignNPC(r.Context(), h.db, chi.URLParam(r, "npcId"))
	writeDeleted(w, err)
}

// ── Campaign Locations ────────────────────────────────────────────────────────

func (h *EntityHandler) ListLocations(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListCampaignLocations(r.Context(), h.db, chi.URLParam(r, "id"))
	writeList(w, list, err)
}

func (h *EntityHandler) GetLocation(w http.ResponseWriter, r *http.Request) {
	loc, err := db.GetCampaignLocation(r.Context(), h.db, chi.URLParam(r, "locationId"))
	writeEntity(w, loc, err, "lieu introuvable")
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
	b, ok := decodeJSON[locationBody](w, r, "corps invalide")
	if !ok {
		return
	}
	loc, err := db.CreateCampaignLocation(r.Context(), h.db, chi.URLParam(r, "id"), b.Name, b.City, b.District, b.Description, b.Atmosphere)
	writeCreated(w, loc, err)
}

func (h *EntityHandler) UpdateLocation(w http.ResponseWriter, r *http.Request) {
	b, ok := decodeJSON[locationBody](w, r, "corps invalide")
	if !ok {
		return
	}
	images := b.Images
	if images == "" {
		images = "[]"
	}
	loc, err := db.UpdateCampaignLocation(r.Context(), h.db, chi.URLParam(r, "locationId"), b.Name, b.City, b.District, b.Description, b.Atmosphere, images)
	writeEntity(w, loc, err, "lieu introuvable")
}

func (h *EntityHandler) DeleteLocation(w http.ResponseWriter, r *http.Request) {
	err := db.DeleteCampaignLocation(r.Context(), h.db, chi.URLParam(r, "locationId"))
	writeDeleted(w, err)
}

// ── Campaign Artefacts ────────────────────────────────────────────────────────

func (h *EntityHandler) ListArtefacts(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListCampaignArtefacts(r.Context(), h.db, chi.URLParam(r, "id"))
	writeList(w, list, err)
}

func (h *EntityHandler) GetArtefact(w http.ResponseWriter, r *http.Request) {
	a, err := db.GetCampaignArtefact(r.Context(), h.db, chi.URLParam(r, "artefactId"))
	writeEntity(w, a, err, "artefact not found")
}

type artefactBody struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Images      string `json:"images"`
}

func (h *EntityHandler) CreateArtefact(w http.ResponseWriter, r *http.Request) {
	b, ok := decodeJSON[artefactBody](w, r, "invalid body")
	if !ok {
		return
	}
	a, err := db.CreateCampaignArtefact(r.Context(), h.db, chi.URLParam(r, "id"), b.Name, b.Description)
	writeCreated(w, a, err)
}

func (h *EntityHandler) UpdateArtefact(w http.ResponseWriter, r *http.Request) {
	b, ok := decodeJSON[artefactBody](w, r, "invalid body")
	if !ok {
		return
	}
	images := b.Images
	if images == "" {
		images = "[]"
	}
	a, err := db.UpdateCampaignArtefact(r.Context(), h.db, chi.URLParam(r, "artefactId"), b.Name, b.Description, images)
	writeEntity(w, a, err, "artefact not found")
}

func (h *EntityHandler) DeleteArtefact(w http.ResponseWriter, r *http.Request) {
	err := db.DeleteCampaignArtefact(r.Context(), h.db, chi.URLParam(r, "artefactId"))
	writeDeleted(w, err)
}

// ── NPC-Artefact Links ────────────────────────────────────────────────────────

func (h *EntityHandler) ListArtefactLinks(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListNPCArtefactLinks(r.Context(), h.db, chi.URLParam(r, "artefactId"))
	writeList(w, list, err)
}

type artefactLinkBody struct {
	NPCId  string `json:"npc_id"`
	Nature string `json:"nature"`
}

func (h *EntityHandler) CreateArtefactLink(w http.ResponseWriter, r *http.Request) {
	b, ok := decodeJSON[artefactLinkBody](w, r, "invalid body")
	if !ok {
		return
	}
	if b.NPCId == "" {
		writeError(w, http.StatusBadRequest, "npc_id required")
		return
	}
	if !db.EntityInCampaign(r.Context(), h.db, db.TableNPCs, b.NPCId, chi.URLParam(r, "id")) {
		writeError(w, http.StatusNotFound, "PNJ introuvable dans cette campagne")
		return
	}
	link, err := db.CreateNPCArtefactLink(r.Context(), h.db, b.NPCId, chi.URLParam(r, "artefactId"), b.Nature)
	writeCreated(w, link, err)
}

func (h *EntityHandler) DeleteArtefactLink(w http.ResponseWriter, r *http.Request) {
	err := db.DeleteNPCArtefactLink(r.Context(), h.db, chi.URLParam(r, "linkId"))
	writeDeleted(w, err)
}

// ── Campaign Factions ─────────────────────────────────────────────────────────

func (h *EntityHandler) ListFactions(w http.ResponseWriter, r *http.Request) {
	list, err := db.ListCampaignFactions(r.Context(), h.db, chi.URLParam(r, "id"))
	writeList(w, list, err)
}

func (h *EntityHandler) GetFaction(w http.ResponseWriter, r *http.Request) {
	f, err := db.GetCampaignFaction(r.Context(), h.db, chi.URLParam(r, "factionId"))
	writeEntity(w, f, err, "faction introuvable")
}

type factionBody struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Motivation  string `json:"motivation"`
	Images      string `json:"images"`
}

func (h *EntityHandler) CreateFaction(w http.ResponseWriter, r *http.Request) {
	b, ok := decodeJSON[factionBody](w, r, "corps invalide")
	if !ok {
		return
	}
	f, err := db.CreateCampaignFaction(r.Context(), h.db, chi.URLParam(r, "id"), b.Name, b.Type, b.Description, b.Motivation)
	writeCreated(w, f, err)
}

func (h *EntityHandler) UpdateFaction(w http.ResponseWriter, r *http.Request) {
	b, ok := decodeJSON[factionBody](w, r, "corps invalide")
	if !ok {
		return
	}
	images := b.Images
	if images == "" {
		images = "[]"
	}
	f, err := db.UpdateCampaignFaction(r.Context(), h.db, chi.URLParam(r, "factionId"), b.Name, b.Type, b.Description, b.Motivation, images)
	writeEntity(w, f, err, "faction introuvable")
}

func (h *EntityHandler) DeleteFaction(w http.ResponseWriter, r *http.Request) {
	err := db.DeleteCampaignFaction(r.Context(), h.db, chi.URLParam(r, "factionId"))
	writeDeleted(w, err)
}

// ── Global search ─────────────────────────────────────────────────────────────

func (h *EntityHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusOK, []db.SearchResult{})
		return
	}
	results, err := db.SearchCampaign(r.Context(), h.db, chi.URLParam(r, "id"), q)
	writeList(w, results, err)
}
