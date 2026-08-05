package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
	"lore/internal/llm"
)

type BrainstormHandler struct {
	db     *sql.DB
	encKey string
}

// ── system prompt ─────────────────────────────────────────────────────────────

func buildBrainstormSystemPrompt(ctx context.Context, database *sql.DB, campaign *db.Campaign, scenario *db.Scenario, sc synopsisCtx, latestMessage string) string {
	var sb strings.Builder
	sb.WriteString("You are a creative assistant for tabletop RPG game masters. ")
	sb.WriteString("You help brainstorm and develop scenarios in a conversational way.\n")
	sb.WriteString("You ALWAYS reply with exactly this JSON format (nothing else):\n")
	sb.WriteString(`{"message":"your reply here","scene_suggestion":null}` + "\n")
	sb.WriteString("When you propose a concrete, developed scene, provide scene_suggestion:\n")
	sb.WriteString(`{"message":"...","scene_suggestion":{"title":"...","description":"...","outcome":"..."}}` + "\n")
	sb.WriteString("Be creative, concise and engaging.\n")

	appendCampaignContext(&sb, campaign)

	sb.WriteString(fmt.Sprintf("\n\nCurrent scenario: %s", scenario.Name))

	if sc.Hook.Content != "" {
		sb.WriteString(fmt.Sprintf("\nHook: %s", sc.Hook.Content))
	}

	if len(sc.NPCs) > 0 {
		sb.WriteString("\n\nNPCs:")
		for _, n := range sc.NPCs {
			sb.WriteString(fmt.Sprintf("\n- %s (%s)", n.Name, n.Role))
		}
	}

	if len(sc.Scenes) > 0 {
		sb.WriteString("\n\nExisting scenes:")
		for _, s := range sc.Scenes {
			if s.Type == "scene" {
				sb.WriteString(fmt.Sprintf("\n- %s", s.Title))
				if s.Description != "" {
					sb.WriteString(fmt.Sprintf(": %s", s.Description))
				}
			}
		}
	}

	appendGameLoreContext(ctx, &sb, database, campaign.GameID, sc.Hook.Content+" "+latestMessage)

	return sb.String()
}

// ── shared LLM setup ──────────────────────────────────────────────────────────

func (h *BrainstormHandler) llmSetup(r *http.Request, scenarioID string) (*llm.Client, *db.Campaign, *db.Scenario, synopsisCtx, error) {
	scenario, err := db.GetScenario(r.Context(), h.db, scenarioID)
	if err != nil || scenario == nil {
		return nil, nil, nil, synopsisCtx{}, fmt.Errorf("scenario not found")
	}
	campaign, err := db.GetCampaign(r.Context(), h.db, scenario.CampaignID)
	if err != nil || campaign == nil {
		return nil, nil, nil, synopsisCtx{}, fmt.Errorf("campaign not found")
	}
	cfg, err := loadLLMConfig(r.Context(), h.db, h.encKey)
	if err != nil || cfg.BaseURL == "" {
		return nil, nil, nil, synopsisCtx{}, fmt.Errorf("LLM config missing")
	}

	synopsis, _ := db.GetSynopsisByScenario(r.Context(), h.db, scenarioID)
	var sc synopsisCtx
	if synopsis != nil {
		sc = parseSynopsisCtx(synopsis)
	}
	// Same rule as the synopsis handler: refs become names on the way out.
	mentions := newMentionResolver(r.Context(), h.db, scenario.CampaignID)
	sc.Hook.Content = mentions.resolve(sc.Hook.Content)
	if snpcs, err := db.ListSynopsisNPCs(r.Context(), h.db, scenarioID); err == nil {
		sc.NPCs = make([]npcItem, len(snpcs))
		for i, n := range snpcs {
			sc.NPCs[i] = npcItem{ID: n.ID, Name: n.Name, Role: n.Role, Description: mentions.resolve(n.Description)}
		}
	}
	if scenes, err := db.ListScenes(r.Context(), h.db, scenarioID); err == nil {
		sc.Scenes = make([]sceneItem, len(scenes))
		for i, s := range scenes {
			sc.Scenes[i] = sceneItem{ID: s.ID, Type: s.Type, Title: s.Title, Description: mentions.resolve(s.Description)}
		}
	}

	return llm.NewClient(cfg), campaign, scenario, sc, nil
}

// ── thread CRUD ───────────────────────────────────────────────────────────────

func (h *BrainstormHandler) ListThreads(w http.ResponseWriter, r *http.Request) {
	threads, err := db.ListBrainstormThreads(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, threads)
}

func (h *BrainstormHandler) CreateThread(w http.ResponseWriter, r *http.Request) {
	thread, err := db.CreateBrainstormThread(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, thread)
}

func (h *BrainstormHandler) RenameThread(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid name")
		return
	}
	thread, err := db.RenameBrainstormThread(r.Context(), h.db, chi.URLParam(r, "threadId"), body.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, thread)
}

func (h *BrainstormHandler) DeleteThread(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteBrainstormThread(r.Context(), h.db, chi.URLParam(r, "threadId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *BrainstormHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	msgs, err := db.ListBrainstormMessages(r.Context(), h.db, chi.URLParam(r, "threadId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, msgs)
}

// ── chat ──────────────────────────────────────────────────────────────────────

type sceneSuggestion struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Outcome     string `json:"outcome"`
}

type assistantEnvelope struct {
	Message         string           `json:"message"`
	SceneSuggestion *sceneSuggestion `json:"scene_suggestion"`
}

type sendMessageResponse struct {
	Thread  *db.BrainstormThread  `json:"thread"`
	Message *db.BrainstormMessage `json:"message"`
}

func (h *BrainstormHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	threadID := chi.URLParam(r, "threadId")

	var body struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Text) == "" {
		writeError(w, http.StatusBadRequest, "invalid text")
		return
	}

	// Count existing messages to detect first turn
	count, _ := db.CountBrainstormMessages(r.Context(), h.db, threadID)
	isFirst := count == 0

	// Save user message
	if _, err := db.CreateBrainstormMessage(r.Context(), h.db, threadID, "user", body.Text); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Build LLM context
	client, campaign, scenario, sc, err := h.llmSetup(r, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	systemPrompt := buildBrainstormSystemPrompt(r.Context(), h.db, campaign, scenario, sc, body.Text)

	// Load full history for multi-turn
	history, err := db.ListBrainstormMessages(r.Context(), h.db, threadID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	msgs := make([]llm.Message, len(history))
	for i, m := range history {
		msgs[i] = llm.Message{Role: m.Role, Content: m.Content}
	}

	// Call LLM
	raw, err := client.Chat(r.Context(), systemPrompt, msgs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Parse envelope — store raw JSON as assistant message content
	parsed := llm.ExtractJSON(raw)
	var envelope assistantEnvelope
	if err := json.Unmarshal([]byte(parsed), &envelope); err != nil {
		// Fallback: treat entire reply as plain message
		envelope = assistantEnvelope{Message: raw}
	}
	// Re-serialise to a clean envelope for storage
	stored, _ := json.Marshal(envelope)

	assistantMsg, err := db.CreateBrainstormMessage(r.Context(), h.db, threadID, "assistant", string(stored))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	thread, err := db.GetBrainstormThread(r.Context(), h.db, threadID)
	if err != nil || thread == nil {
		writeError(w, http.StatusInternalServerError, "thread not found")
		return
	}

	// Auto-name on first turn
	if isFirst {
		namePrompt := fmt.Sprintf(
			"Generate a very short title (3 to 5 words max) for a TTRPG brainstorming conversation that starts with this message: \"%s\". Reply with the title only, no quotes or trailing punctuation.",
			body.Text,
		)
		if name, err := client.Complete(r.Context(), "You generate short titles for TTRPG brainstorming conversations. Reply with the requested title only.", namePrompt); err == nil {
			name = strings.TrimSpace(strings.Trim(name, `"'`))
			if name != "" && len(name) < 100 {
				if renamed, err := db.RenameBrainstormThread(r.Context(), h.db, threadID, name); err == nil {
					thread = renamed
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, sendMessageResponse{Thread: thread, Message: assistantMsg})
}
