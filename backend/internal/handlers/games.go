package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

type GameHandler struct {
	db                  *sql.DB
	externalMaterialDir string
}

func (h *GameHandler) List(w http.ResponseWriter, r *http.Request) {
	games, err := db.ListGames(r.Context(), h.db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, games)
}

func (h *GameHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	game, err := db.GetGame(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if game == nil {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}
	writeJSON(w, http.StatusOK, game)
}

type gameBody struct {
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Genre string `json:"genre"`
}

func (h *GameHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body gameBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" || body.Slug == "" {
		writeError(w, http.StatusBadRequest, "name and slug are required")
		return
	}
	game, err := db.CreateGame(r.Context(), h.db, body.Name, body.Slug, body.Genre)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, game)
}

func (h *GameHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body gameBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" || body.Slug == "" {
		writeError(w, http.StatusBadRequest, "name and slug are required")
		return
	}
	game, err := db.UpdateGame(r.Context(), h.db, id, body.Name, body.Slug, body.Genre)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if game == nil {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}
	writeJSON(w, http.StatusOK, game)
}

func (h *GameHandler) UpdateVisualStyle(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		VisualStyle string `json:"visual_style"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	game, err := db.UpdateGameVisualStyle(r.Context(), h.db, id, body.VisualStyle)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if game == nil {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}
	writeJSON(w, http.StatusOK, game)
}

func (h *GameHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := db.DeleteGame(r.Context(), h.db, id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type GameDocument struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func (h *GameHandler) ListDocuments(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	game, err := db.GetGame(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if game == nil {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}

	base := filepath.Join(h.externalMaterialDir, filepath.Clean("/"+game.Slug))
	docs := []GameDocument{}

	if _, err := os.Stat(base); os.IsNotExist(err) {
		writeJSON(w, http.StatusOK, docs)
		return
	}

	err = filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(base, path)
		if strings.HasPrefix(rel, ".") {
			return nil
		}
		url := "/external-material/" + game.Slug + "/" + filepath.ToSlash(rel)
		docs = append(docs, GameDocument{Name: rel, URL: url})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, docs)
}

// ── Lore entities ────────────────────────────────────────────────────────────
//
// Structured facts extracted from a game's sourcebooks (locations, factions,
// NPC archetypes, ...). Reading is open like the rest of the game catalogue;
// writing is the administrator's, same as everything else on a game.

func (h *GameHandler) ListLoreEntities(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	entities, err := db.ListGameLoreEntities(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, entities)
}

type gameLoreEntityBody struct {
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Tags        string `json:"tags"`
	Summary     string `json:"summary"`
	Excerpt     string `json:"excerpt"`
	SourceTitle string `json:"source_title"`
	SourcePage  int    `json:"source_page"`
}

func (h *GameHandler) CreateLoreEntity(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "id")
	var body gameLoreEntityBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Kind == "" || body.Name == "" {
		writeError(w, http.StatusBadRequest, "kind and name are required")
		return
	}
	game, err := db.GetGame(r.Context(), h.db, gameID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if game == nil {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}
	entity, err := db.CreateGameLoreEntity(r.Context(), h.db, db.CreateGameLoreEntityParams{
		GameID:      gameID,
		Kind:        body.Kind,
		Name:        body.Name,
		Tags:        body.Tags,
		Summary:     body.Summary,
		Excerpt:     body.Excerpt,
		SourceTitle: body.SourceTitle,
		SourcePage:  body.SourcePage,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, entity)
}

func (h *GameHandler) DeleteLoreEntity(w http.ResponseWriter, r *http.Request) {
	entityID := chi.URLParam(r, "entityId")
	if err := db.DeleteGameLoreEntity(r.Context(), h.db, entityID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Export / import ──────────────────────────────────────────────────────────
//
// A game's export bundles its catalogue metadata and its extracted lore
// entities — never the sourcebook PDFs or the raw page text pulled from them
// (see the comment on game_lore_entities in schema.sql). That's what makes it
// safe to hand to another gamemaster running their own instance: "install
// Cyberpunk Red" imports the game and its structured knowledge, and the GM
// supplies their own copy of the actual sourcebook locally if they want
// full-text search on top of it.

type gameExportMeta struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Genre       string `json:"genre"`
	VisualStyle string `json:"visual_style"`
}

type gameLoreEntityExport struct {
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Tags        string `json:"tags"`
	Summary     string `json:"summary"`
	SourceTitle string `json:"source_title"`
	SourcePage  int    `json:"source_page"`
}

type gameExportDoc struct {
	ExportedAt   string                 `json:"exported_at"`
	Version      int                    `json:"version"`
	Game         gameExportMeta         `json:"game"`
	LoreEntities []gameLoreEntityExport `json:"lore_entities"`
}

func (h *GameHandler) Export(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	game, err := db.GetGame(ctx, h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if game == nil {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}

	entities, err := db.ListGameLoreEntities(ctx, h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	exported := make([]gameLoreEntityExport, 0, len(entities))
	for _, e := range entities {
		exported = append(exported, gameLoreEntityExport{
			Kind:        e.Kind,
			Name:        e.Name,
			Tags:        e.Tags,
			Summary:     e.Summary,
			SourceTitle: e.SourceTitle,
			SourcePage:  e.SourcePage,
		})
	}

	doc := gameExportDoc{
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Version:    1,
		Game: gameExportMeta{
			Name:        game.Name,
			Slug:        game.Slug,
			Genre:       game.Genre,
			VisualStyle: game.VisualStyle,
		},
		LoreEntities: exported,
	}

	filename := fmt.Sprintf("lore-game-%s.json", safeFilename(game.Slug))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	json.NewEncoder(w).Encode(doc) //nolint:errcheck
}

func (h *GameHandler) Import(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var doc gameExportDoc
	if err := json.NewDecoder(r.Body).Decode(&doc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if doc.Game.Name == "" || doc.Game.Slug == "" {
		writeError(w, http.StatusBadRequest, "name and slug are required")
		return
	}

	existing, err := db.GetGameBySlug(ctx, h.db, doc.Game.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing != nil {
		writeError(w, http.StatusConflict, fmt.Sprintf("un jeu avec le slug %q existe déjà", doc.Game.Slug))
		return
	}

	game, err := db.CreateGame(ctx, h.db, doc.Game.Name, doc.Game.Slug, doc.Game.Genre)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if doc.Game.VisualStyle != "" {
		if _, err := db.UpdateGameVisualStyle(ctx, h.db, game.ID, doc.Game.VisualStyle); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	for _, e := range doc.LoreEntities {
		if e.Kind == "" || e.Name == "" {
			continue
		}
		if _, err := db.CreateGameLoreEntity(ctx, h.db, db.CreateGameLoreEntityParams{
			GameID:      game.ID,
			Kind:        e.Kind,
			Name:        e.Name,
			Tags:        e.Tags,
			Summary:     e.Summary,
			SourceTitle: e.SourceTitle,
			SourcePage:  e.SourcePage,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	game, err = db.GetGame(ctx, h.db, game.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, game)
}
