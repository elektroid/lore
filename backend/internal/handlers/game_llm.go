package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
	"lore/internal/llm"
)

type GameLLMHandler struct {
	db     *sql.DB
	encKey string
}

func (h *GameLLMHandler) GenerateVisualStyle(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	game, err := db.GetGame(r.Context(), h.db, id)
	if err != nil || game == nil {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}

	cfg, err := loadLLMConfig(r.Context(), h.db, h.encKey)
	if err != nil || cfg.BaseURL == "" {
		writeError(w, http.StatusBadRequest, "LLM config missing — configure it in Settings")
		return
	}

	var sb strings.Builder
	sb.WriteString("You are an expert in tabletop RPG game systems and their visual aesthetics.\n")
	sb.WriteString("Respond ONLY with valid JSON, no markdown, no explanation.\n")

	prompt := fmt.Sprintf(
		`The tabletop RPG game system is: "%s".

Write a concise visual style description (2-4 sentences, ~50 words) suitable for injecting into image generation prompts.
Focus on: art style, color palette, mood, lighting, visual tone, and key aesthetic keywords that define this game's look.
Do NOT describe story or mechanics — only visual aesthetics.
Respond with: {"visual_style":"..."}`,
		game.Name,
	)

	client := llm.NewClient(cfg)
	type result struct {
		VisualStyle string `json:"visual_style"`
	}
	res, err := llm.Decode[result](r.Context(), client, sb.String(), prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "LLM error: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, res)
}
