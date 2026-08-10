package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"

	"lore/internal/auth"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

// ── Export types ──────────────────────────────────────────────────────────────

type campaignExportDoc struct {
	ExportedAt string                `json:"exported_at"`
	Version    int                   `json:"version"`
	Campaign   campaignExportMeta    `json:"campaign"`
	NPCs       []db.CampaignNPC      `json:"npcs"`
	Locations  []db.CampaignLocation `json:"locations"`
	Artefacts  []db.CampaignArtefact `json:"artefacts"`
	Links      exportLinks           `json:"links"`
	Scenarios  []scenarioExport      `json:"scenarios"`
}

type campaignExportMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Genre     string `json:"genre"`
	GameID    string `json:"game_id"`
	GameName  string `json:"game_name"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type exportLinks struct {
	NPCArtefact []db.NPCArtefactLink `json:"npc_artefact"`
}

type scenarioExport struct {
	Scenario db.Scenario      `json:"scenario"`
	Synopsis *db.Synopsis     `json:"synopsis"`
	NPCs     []db.SynopsisNPC `json:"synopsis_npcs"`
	Scenes   []db.Scene       `json:"scenes"`
}

func safeFilename(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else {
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

type CampaignHandler struct {
	db *sql.DB
}

func (h *CampaignHandler) List(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	items, err := db.ListCampaignsForUser(r.Context(), h.db, user.ID, user.Role == "superuser")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Strip sensitive fields for member-only campaigns
	type memberView struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		GameID   string `json:"game_id"`
		GameName string `json:"game_name"`
		Access   string `json:"access"`
	}
	type ownerView struct {
		db.Campaign
		Access string `json:"access"`
	}
	out := make([]any, len(items))
	for i, item := range items {
		if item.Access == "member" {
			out[i] = memberView{ID: item.ID, Name: item.Name, GameID: item.GameID, GameName: item.GameName, Access: "member"}
		} else {
			out[i] = ownerView{Campaign: item.Campaign, Access: item.Access}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// Get returns the campaign to its owner, a delegated member (access =
// "member", the gamemaster-delegation tier — see requireCampaignAccess), or a
// superuser. Every page a delegated GM can reach (the Meneur hub, PlayPage,
// SynopsisPage in read mode) fetches the campaign this way for its name.
func (h *CampaignHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	campaign, err := db.GetCampaign(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if campaign == nil {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}
	access := "owner"
	if user.Role != "superuser" && campaign.OwnerID != user.ID {
		isMember, err := db.IsCampaignMember(r.Context(), h.db, id, user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !isMember {
			writeError(w, http.StatusForbidden, "campaign access required")
			return
		}
		access = "member"
	}
	writeJSON(w, http.StatusOK, struct {
		db.Campaign
		Access string `json:"access"`
	}{Campaign: *campaign, Access: access})
}

type createCampaignBody struct {
	Name      string `json:"name"`
	Genre     string `json:"genre"`
	GameID    string `json:"game_id"`
	LLMConfig string `json:"llm_config"`
}

func (h *CampaignHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body createCampaignBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	// Get owner from auth context
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if !h.validGameID(r, body.GameID) {
		writeError(w, http.StatusBadRequest, "jeu introuvable")
		return
	}

	campaign, err := db.CreateCampaign(r.Context(), h.db, db.CreateCampaignParams{
		Name:      body.Name,
		Genre:     body.Genre,
		GameID:    body.GameID,
		LLMConfig: body.LLMConfig,
		OwnerID:   user.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, campaign)
}

type updateCampaignBody struct {
	Name      string `json:"name"`
	Genre     string `json:"genre"`
	GameID    string `json:"game_id"`
	LLMConfig string `json:"llm_config"`
}

func (h *CampaignHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	existing, err := db.GetCampaign(r.Context(), h.db, id)
	if err != nil || existing == nil {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}
	if user.Role != "superuser" && existing.OwnerID != user.ID {
		writeError(w, http.StatusForbidden, "campaign owner access required")
		return
	}
	var body updateCampaignBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	if !h.validGameID(r, body.GameID) {
		writeError(w, http.StatusBadRequest, "jeu introuvable")
		return
	}

	campaign, err := db.UpdateCampaign(r.Context(), h.db, db.UpdateCampaignParams{
		ID:        id,
		Name:      body.Name,
		Genre:     body.Genre,
		GameID:    body.GameID,
		LLMConfig: body.LLMConfig,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if campaign == nil {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}
	writeJSON(w, http.StatusOK, campaign)
}

func (h *CampaignHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	campaign, err := db.GetCampaign(r.Context(), h.db, id)
	if err != nil || campaign == nil {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}
	if user.Role != "superuser" && campaign.OwnerID != user.ID {
		writeError(w, http.StatusForbidden, "campaign owner access required")
		return
	}
	if err := db.DeleteCampaign(r.Context(), h.db, id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CampaignHandler) Export(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	campaign, err := db.GetCampaign(ctx, h.db, id)
	if err != nil || campaign == nil {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}
	if user.Role != "superuser" && campaign.OwnerID != user.ID {
		writeError(w, http.StatusForbidden, "campaign owner access required")
		return
	}

	npcs, _ := db.ListCampaignNPCs(ctx, h.db, id)
	locations, _ := db.ListCampaignLocations(ctx, h.db, id)
	artefacts, _ := db.ListCampaignArtefacts(ctx, h.db, id)

	npcArtLinks := []db.NPCArtefactLink{}
	for _, a := range artefacts {
		links, err := db.ListNPCArtefactLinks(ctx, h.db, a.ID)
		if err == nil {
			npcArtLinks = append(npcArtLinks, links...)
		}
	}

	rawScenarios, _ := db.ListScenarios(ctx, h.db, id)
	scenarios := make([]scenarioExport, 0, len(rawScenarios))
	for _, s := range rawScenarios {
		synopsis, _ := db.GetSynopsisByScenario(ctx, h.db, s.ID)
		snpcs, _ := db.ListSynopsisNPCs(ctx, h.db, s.ID)
		scenes, _ := db.ListScenes(ctx, h.db, s.ID)
		scenarios = append(scenarios, scenarioExport{
			Scenario: s,
			Synopsis: synopsis,
			NPCs:     snpcs,
			Scenes:   scenes,
		})
	}

	doc := campaignExportDoc{
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Version:    1,
		Campaign: campaignExportMeta{
			ID:        campaign.ID,
			Name:      campaign.Name,
			Genre:     campaign.Genre,
			GameID:    campaign.GameID,
			GameName:  campaign.GameName,
			CreatedAt: campaign.CreatedAt,
			UpdatedAt: campaign.UpdatedAt,
		},
		NPCs:      npcs,
		Locations: locations,
		Artefacts: artefacts,
		Links:     exportLinks{NPCArtefact: npcArtLinks},
		Scenarios: scenarios,
	}

	filename := fmt.Sprintf("lore-%s.json", safeFilename(campaign.Name))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	json.NewEncoder(w).Encode(doc)
}

// ListMemberCharacters returns all campaign members with their characters for the campaign's game.
func (h *CampaignHandler) ListMemberCharacters(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	members, err := db.ListCampaignMemberCharacters(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// ListMembers returns all members of a campaign
func (h *CampaignHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Check if user has permission to view campaign members
	// For now, require campaign membership or superuser
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	// Check if user is owner, member, or superuser
	campaign, err := db.GetCampaign(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if campaign == nil {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}
	if campaign.OwnerID != user.ID && user.Role != "superuser" {
		isMember, err := db.IsCampaignMember(r.Context(), h.db, id, user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !isMember {
			writeError(w, http.StatusForbidden, "access denied")
			return
		}
	}

	members, err := db.ListCampaignMembers(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, members)
}

// AddMember adds a user to a campaign
type addMemberRequest struct {
	UserID string `json:"user_id"`
}

func (h *CampaignHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	// Only campaign owner or superuser can add members
	campaign, err := db.GetCampaign(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if campaign == nil {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}

	// Check if user is the owner or superuser
	if campaign.OwnerID != user.ID && user.Role != "superuser" {
		writeError(w, http.StatusForbidden, "only campaign owner or superuser can add members")
		return
	}

	var req addMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.UserID == "" {
		writeError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	// Verify the user exists
	targetUser, err := db.GetUserByID(r.Context(), h.db, req.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if targetUser == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	if err := db.AddCampaignMember(r.Context(), h.db, id, req.UserID); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			writeError(w, http.StatusConflict, "user is already a member of this campaign")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// RemoveMember removes a user from a campaign
func (h *CampaignHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := chi.URLParam(r, "userId")

	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	// Only campaign owner or superuser can remove members
	campaign, err := db.GetCampaign(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if campaign == nil {
		writeError(w, http.StatusNotFound, "campaign not found")
		return
	}

	// Check if user is the owner or superuser
	if campaign.OwnerID != user.ID && user.Role != "superuser" {
		writeError(w, http.StatusForbidden, "only campaign owner or superuser can remove members")
		return
	}

	// Protect the campaign owner from removal
	if userID == campaign.OwnerID {
		writeError(w, http.StatusForbidden, "cannot remove the campaign owner")
		return
	}

	if err := db.RemoveCampaignMember(r.Context(), h.db, id, userID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// validGameID accepts an empty game (a campaign may have none) and otherwise
// requires a game that exists. Without this the insert fails on the foreign key
// and the client gets a 500 carrying a raw SQLite message.
func (h *CampaignHandler) validGameID(r *http.Request, gameID string) bool {
	if gameID == "" {
		return true
	}
	game, err := db.GetGame(r.Context(), h.db, gameID)
	return err == nil && game != nil
}
