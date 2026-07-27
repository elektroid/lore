package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

type SynopsisHandler struct {
	db     *sql.DB
	encKey string
}

func (h *SynopsisHandler) Get(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	synopsis, err := db.GetSynopsisByScenario(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if synopsis == nil {
		writeError(w, http.StatusNotFound, "synopsis introuvable")
		return
	}
	writeJSON(w, http.StatusOK, synopsis)
}

func (h *SynopsisHandler) Update(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")

	var body struct {
		Hook          json.RawMessage `json:"hook"`
		NPCs          json.RawMessage `json:"npcs"`
		OverviewCache string          `json:"overview_cache"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}

	synopsis, err := db.UpdateSynopsis(r.Context(), h.db, db.UpdateSynopsisParams{
		ScenarioID:    scenarioID,
		Hook:          rawOrDefault(body.Hook, "{}"),
		NPCs:          rawOrDefault(body.NPCs, "[]"),
		OverviewCache: body.OverviewCache,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, synopsis)
}

func (h *SynopsisHandler) ListSnapshots(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	synopsis, err := db.GetSynopsisByScenario(r.Context(), h.db, scenarioID)
	if err != nil || synopsis == nil {
		writeError(w, http.StatusNotFound, "synopsis introuvable")
		return
	}
	snapshots, err := db.ListSnapshots(r.Context(), h.db, synopsis.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snapshots)
}

func (h *SynopsisHandler) RestoreSnapshot(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	snapshotID := chi.URLParam(r, "snapshotID")

	// The snapshot's content is about to be written into this scenario, so it
	// had better be this scenario's snapshot.
	belongs, err := db.SnapshotInScenario(r.Context(), h.db, snapshotID, scenarioID)
	if err != nil || !belongs {
		writeError(w, http.StatusNotFound, "snapshot introuvable")
		return
	}
	snapshot, err := db.GetSnapshot(r.Context(), h.db, snapshotID)
	if err != nil || snapshot == nil {
		writeError(w, http.StatusNotFound, "snapshot introuvable")
		return
	}

	var data struct {
		Hook json.RawMessage `json:"hook"`
		NPCs json.RawMessage `json:"npcs"`
	}
	if err := json.Unmarshal([]byte(snapshot.Data), &data); err != nil {
		writeError(w, http.StatusInternalServerError, "données de snapshot corrompues")
		return
	}

	synopsis, err := db.UpdateSynopsis(r.Context(), h.db, db.UpdateSynopsisParams{
		ScenarioID: scenarioID,
		Hook:       rawOrDefault(data.Hook, "{}"),
		NPCs:       rawOrDefault(data.NPCs, "[]"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	label := "Restauration : " + snapshot.Label
	snapshotData := db.SynopsisToSnapshotData(synopsis)
	_ = db.CreateSnapshot(r.Context(), h.db, synopsis.ID, label, snapshotData)
	_ = db.DeleteOldestSnapshotsIfNeeded(r.Context(), h.db, synopsis.ID, 20)

	writeJSON(w, http.StatusOK, synopsis)
}

func (h *SynopsisHandler) ListNPCs(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	npcs, err := db.ListSynopsisNPCs(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, npcs)
}

func (h *SynopsisHandler) AddNPC(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	var body struct {
		NPCID string `json:"npc_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.NPCID == "" {
		writeError(w, http.StatusBadRequest, "npc_id requis")
		return
	}
	if !h.entityInScenarioCampaign(r, db.TableNPCs, body.NPCID) {
		writeError(w, http.StatusNotFound, "PNJ introuvable dans cette campagne")
		return
	}
	if err := db.AddSynopsisNPC(r.Context(), h.db, scenarioID, body.NPCID, "draft", 0); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	npcs, err := db.ListSynopsisNPCs(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, npcs)
}

func (h *SynopsisHandler) RemoveNPC(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	npcID := chi.URLParam(r, "npcId")
	if err := db.RemoveSynopsisNPC(r.Context(), h.db, scenarioID, npcID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SynopsisHandler) UpdateNPCStatus(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	npcID := chi.URLParam(r, "npcId")
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Status == "" {
		writeError(w, http.StatusBadRequest, "status requis")
		return
	}
	if err := db.UpdateSynopsisNPCStatus(r.Context(), h.db, scenarioID, npcID, body.Status); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	npcs, err := db.ListSynopsisNPCs(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, npcs)
}

func (h *SynopsisHandler) ListFactions(w http.ResponseWriter, r *http.Request) {
	factions, err := db.ListSynopsisFactions(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, factions)
}

func (h *SynopsisHandler) AddFaction(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	var body struct {
		FactionID string `json:"faction_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.FactionID == "" {
		writeError(w, http.StatusBadRequest, "faction_id requis")
		return
	}
	if !h.entityInScenarioCampaign(r, db.TableFactions, body.FactionID) {
		writeError(w, http.StatusNotFound, "faction introuvable dans cette campagne")
		return
	}
	if err := db.AddSynopsisFaction(r.Context(), h.db, scenarioID, body.FactionID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	factions, err := db.ListSynopsisFactions(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, factions)
}

func (h *SynopsisHandler) RemoveFaction(w http.ResponseWriter, r *http.Request) {
	if err := db.RemoveSynopsisFaction(r.Context(), h.db, chi.URLParam(r, "id"), chi.URLParam(r, "factionId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func rawOrDefault(msg json.RawMessage, def string) string {
	if len(msg) == 0 || string(msg) == "null" {
		return def
	}
	return string(msg)
}
