package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
	"lore/internal/improv"
	"lore/internal/llm"
)

// Improvised beats — the play-mode capture path and what the LLM does with it
// afterwards. See docs/play-improv.md. Handlers hang off SynopsisHandler, which
// already carries the scenario-scoped db + encKey.

const developBeatMaxTokens = 800

// ── Capture ───────────────────────────────────────────────────────────────────

// CreateBeat is the capture path. One insert. No LLM, no lookups beyond the
// session, because the GM is mid-sentence at a table and everything else can
// wait until they are not.
func (h *SynopsisHandler) CreateBeat(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")

	var body struct {
		SessionID string `json:"session_id"`
		Note      string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}
	body.Note = strings.TrimSpace(body.Note)
	if body.Note == "" {
		writeError(w, http.StatusBadRequest, "la note est vide")
		return
	}
	if body.SessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id requis")
		return
	}

	// The anchor is the session's active scene — free, because the console
	// already tracks it, and it is what adoption inserts after.
	session, err := db.GetSession(r.Context(), h.db, body.SessionID)
	if err != nil || session == nil {
		writeError(w, http.StatusNotFound, "session introuvable")
		return
	}

	beat, err := db.CreateSessionBeat(r.Context(), h.db, db.CreateBeatParams{
		SessionID:     body.SessionID,
		ScenarioID:    scenarioID,
		AnchorSceneID: session.ActiveSceneID,
		Note:          body.Note,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, beat)
}

// ── Read / edit / delete ──────────────────────────────────────────────────────

// ListBeats returns a scenario's beats. ?session_id= narrows to one evening;
// without it this is the cross-session view prep opens with.
func (h *SynopsisHandler) ListBeats(w http.ResponseWriter, r *http.Request) {
	beats, err := db.ListSessionBeats(r.Context(), h.db,
		chi.URLParam(r, "id"), r.URL.Query().Get("session_id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, beats)
}

func (h *SynopsisHandler) UpdateBeat(w http.ResponseWriter, r *http.Request) {
	beat, err := db.GetSessionBeat(r.Context(), h.db, chi.URLParam(r, "beatId"))
	if err != nil || beat == nil {
		writeError(w, http.StatusNotFound, "note introuvable")
		return
	}

	// Every field is optional: the panel patches one thing at a time, and the
	// GM's raw note must survive a request that never mentions it.
	var body struct {
		Note        *string `json:"note"`
		Status      *string `json:"status"`
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Outcome     *string `json:"outcome"`
		Notes       *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}

	p := db.UpdateBeatParams{
		Note: beat.Note, Status: beat.Status, Title: beat.Title,
		Description: beat.Description, Outcome: beat.Outcome, Notes: beat.Notes,
		Coherency: beat.Coherency,
	}
	if body.Note != nil {
		p.Note = strings.TrimSpace(*body.Note)
	}
	if body.Status != nil {
		p.Status = *body.Status
	}
	if body.Title != nil {
		p.Title = *body.Title
	}
	if body.Description != nil {
		p.Description = *body.Description
	}
	if body.Outcome != nil {
		p.Outcome = *body.Outcome
	}
	if body.Notes != nil {
		p.Notes = *body.Notes
	}

	updated, err := db.UpdateSessionBeat(r.Context(), h.db, beat.ID, p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *SynopsisHandler) DeleteBeat(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteSessionBeat(r.Context(), h.db, chi.URLParam(r, "beatId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Develop ───────────────────────────────────────────────────────────────────

// beatSceneLines numbers the beat sheet so the model can point at scenes
// without inventing UUIDs, and marks what this session already did with them.
func (h *SynopsisHandler) beatSceneLines(ctx context.Context, scenarioID, sessionID, anchorID string) ([]improv.SceneLine, error) {
	scenes, err := db.ListScenes(ctx, h.db, scenarioID)
	if err != nil {
		return nil, err
	}
	states := map[string]string{}
	if sessionID != "" {
		if s, err := db.ListSessionScenes(ctx, h.db, sessionID); err == nil {
			states = s
		}
	}

	lines := make([]improv.SceneLine, 0, len(scenes))
	for i, s := range scenes {
		if s.Type == "divider" {
			continue
		}
		summary := s.Description
		if summary == "" {
			summary = s.Outcome
		}
		lines = append(lines, improv.SceneLine{
			Ref:      fmt.Sprintf("s%d", i+1),
			ID:       s.ID,
			Title:    s.Title,
			Summary:  truncateRunes(summary, 160),
			Status:   s.Status,
			Played:   s.Played || states[s.ID] == "cleared",
			Voided:   states[s.ID] == "void",
			IsAnchor: s.ID == anchorID,
		})
	}
	return lines, nil
}

// DevelopBeat writes the improvisation up as a scene and reports what it
// changes. With review:true the suggestion comes back unsaved — the
// LLMSuggestionReview contract used everywhere else in the app.
func (h *SynopsisHandler) DevelopBeat(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")

	beat, err := db.GetSessionBeat(r.Context(), h.db, chi.URLParam(r, "beatId"))
	if err != nil || beat == nil {
		writeError(w, http.StatusNotFound, "note introuvable")
		return
	}

	var body struct {
		Review      bool              `json:"review"`
		Fields      []string          `json:"fields"`
		Instruction string            `json:"instruction"`
		Current     map[string]string `json:"current"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	scenario, err := db.GetScenario(r.Context(), h.db, scenarioID)
	if err != nil || scenario == nil {
		writeError(w, http.StatusNotFound, "scénario introuvable")
		return
	}
	campaign, err := db.GetCampaign(r.Context(), h.db, scenario.CampaignID)
	if err != nil || campaign == nil {
		writeError(w, http.StatusNotFound, "campagne introuvable")
		return
	}

	cfg, err := loadLLMConfig(r.Context(), h.db, h.encKey)
	if err != nil || cfg.BaseURL == "" {
		writeError(w, http.StatusBadRequest, "configuration LLM manquante — configurez-la dans les Paramètres")
		return
	}
	cfg.MaxTokens = developBeatMaxTokens

	lines, err := h.beatSceneLines(r.Context(), scenarioID, beat.SessionID, beat.AnchorSceneID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	ctxPrompt := improv.Context{
		GameName: campaign.GameName,
		Genre:    campaign.Genre,
		Lore:     campaign.Lore,
	}
	if synopsis, err := db.GetSynopsisByScenario(r.Context(), h.db, scenarioID); err == nil && synopsis != nil {
		var hook struct {
			Content string `json:"content"`
		}
		_ = json.Unmarshal([]byte(synopsis.Hook), &hook)
		ctxPrompt.ScenarioPitch = hook.Content
	}

	// The note is the GM's record of what happened and is never regenerated;
	// only the write-up fields accept in-progress values from the editor.
	note := beat.Note
	if v, ok := body.Current["note"]; ok && strings.TrimSpace(v) != "" {
		note = v
	}

	prompt := improv.DevelopPrompt(note, lines, body.Instruction, body.Fields)
	result, err := llm.Decode[improv.DevelopResult](r.Context(), llm.NewClient(cfg),
		improv.SystemPrompt(ctxPrompt), prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}
	result.Clean(lines)

	if body.Review {
		writeJSON(w, http.StatusOK, result)
		return
	}

	updated, err := db.UpdateSessionBeat(r.Context(), h.db, beat.ID, db.UpdateBeatParams{
		Note:        beat.Note, // untouched, always
		Status:      "developed",
		Title:       result.Title,
		Description: result.Description,
		Outcome:     result.Outcome,
		Notes:       result.Notes,
		Coherency:   result.Coherency.JSON(),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── Adopt ─────────────────────────────────────────────────────────────────────

// AdoptBeat turns the beat into a real scene, inserted immediately after its
// anchor so the beat sheet reads in the order the evening actually went.
//
// It lands not-played on purpose: `played` drives "what is left to run", and
// the same beat may be adopted as setup for next time rather than as a record
// of last time. Wrongly marking it played hides it from the view the GM works
// from; wrongly leaving it unplayed costs one click.
func (h *SynopsisHandler) AdoptBeat(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")

	beat, err := db.GetSessionBeat(r.Context(), h.db, chi.URLParam(r, "beatId"))
	if err != nil || beat == nil {
		writeError(w, http.StatusNotFound, "note introuvable")
		return
	}
	if beat.Status == "adopted" {
		writeError(w, http.StatusConflict, "cette note est déjà devenue une scène")
		return
	}

	scenes, err := db.ListScenes(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Right after the anchor; at the end when there is no anchor left.
	sortOrder := len(scenes)
	locationID := ""
	for _, s := range scenes {
		if s.ID == beat.AnchorSceneID {
			sortOrder = s.SortOrder + 1
			locationID = s.LocationID
			break
		}
	}
	if sortOrder < len(scenes) {
		if err := db.ShiftScenesFrom(r.Context(), h.db, scenarioID, sortOrder); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	// An undeveloped beat is adopted on the GM's own words — some
	// improvisations do not need a co-writer.
	title := beat.Title
	if title == "" {
		title = truncateRunes(beat.Note, 60)
	}
	description := beat.Description
	if description == "" {
		description = beat.Note
	}

	scene, err := db.CreateScene(r.Context(), h.db, db.CreateSceneParams{
		ScenarioID:  scenarioID,
		Type:        "scene",
		Status:      "key_event",
		SortOrder:   sortOrder,
		Title:       title,
		Description: description,
		Outcome:     beat.Outcome,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	notes := beat.Notes
	if notes == "" {
		notes = "Improvisé en session : " + beat.Note
	}
	if _, err := db.UpdateScene(r.Context(), h.db, scene.ID, db.UpdateSceneParams{
		Title:       title,
		Status:      "key_event",
		Description: description,
		Outcome:     beat.Outcome,
		Notes:       notes,
		LocationID:  locationID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	updated, err := db.MarkBeatAdopted(r.Context(), h.db, beat.ID, scene.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, updated)
}

// truncateRunes cuts on a rune boundary so accented text never breaks mid-glyph.
func truncateRunes(s string, max int) string {
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return strings.TrimSpace(string(runes[:max])) + "…"
}
