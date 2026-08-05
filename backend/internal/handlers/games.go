package handlers

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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

type lorePage struct {
	Entities []db.GameLoreEntity `json:"entities"`
	Total    int                 `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
}

// ListLoreEntities paginates server-side — a game's lore can run into the
// thousands of rows (Night City 2045 alone is 2000+), so ?page/?page_size
// and the ?kind/?q filters are pushed down to SQL rather than shipping
// everything to the client and filtering there.
func (h *GameHandler) ListLoreEntities(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	kind := r.URL.Query().Get("kind")
	q := r.URL.Query().Get("q")

	page := 1
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	pageSize := 50
	if v := r.URL.Query().Get("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			pageSize = n
		}
	}

	entities, total, err := db.ListGameLoreEntitiesPage(r.Context(), h.db, id, kind, q, pageSize, (page-1)*pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, lorePage{Entities: entities, Total: total, Page: page, PageSize: pageSize})
}

// GetLoreEntity fetches a single entity by ID — used when the browse UI
// navigates to an entity via a relation link that may point outside the
// currently loaded page.
func (h *GameHandler) GetLoreEntity(w http.ResponseWriter, r *http.Request) {
	entityID := chi.URLParam(r, "entityId")
	entity, err := db.GetGameLoreEntity(r.Context(), h.db, entityID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entity == nil {
		writeError(w, http.StatusNotFound, "entity not found")
		return
	}
	writeJSON(w, http.StatusOK, entity)
}

// ListLoreEntityKinds powers the browse UI's filter chips with counts
// ("Faction (281)") without pulling every row just to count them.
func (h *GameHandler) ListLoreEntityKinds(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	counts, err := db.CountGameLoreEntitiesByKind(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, counts)
}

// GetLoreEntityRelations returns one entity's relations, split by direction,
// with the other end's name/kind embedded so the client never needs the
// full (thousands-of-rows) entity list just to render a detail view.
func (h *GameHandler) GetLoreEntityRelations(w http.ResponseWriter, r *http.Request) {
	entityID := chi.URLParam(r, "entityId")
	outgoing, incoming, err := db.ListGameLoreEntityRelationsFor(r.Context(), h.db, entityID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"outgoing": outgoing, "incoming": incoming})
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

// ListLoreRelations returns every typed link between two of this game's lore
// entities (e.g. "Emilia Ortega" --manages--> "Downtown"). Endpoints are IDs
// only — the client already has the full entity list (ListLoreEntities) to
// resolve names/kinds against, so this stays a plain, cheap table dump rather
// than a join.
func (h *GameHandler) ListLoreRelations(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	relations, err := db.ListGameLoreEntityRelations(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, relations)
}

// ── Export / import ──────────────────────────────────────────────────────────
//
// A game's export bundles its catalogue metadata, its extracted lore entities
// and the typed relations between them — never the sourcebook PDFs or the raw
// page text pulled from them (see the comment on game_lore_entities in
// schema.sql). That's what makes it safe to hand to another gamemaster
// running their own instance: "install Cyberpunk Red" imports the game and
// its structured knowledge, and the GM supplies their own copy of the actual
// sourcebook locally if they want full-text search on top of it.
//
// The wire format is a zip (manifest.json inside) rather than bare JSON so a
// download is a single double-click-to-install artifact — and so a later
// addition (a cover image, a bundled PDF a GM has the rights to redistribute)
// has somewhere to live without changing the container format again.

const gameExportManifestName = "manifest.json"

type gameExportMeta struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Genre       string `json:"genre"`
	VisualStyle string `json:"visual_style"`
}

// ID is export-local, not the source instance's real row ID — it exists only
// so Relations below can reference "the third entity in this file" without
// caring what ID it happens to get on the importing instance.
type gameLoreEntityExport struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Tags        string `json:"tags"`
	Summary     string `json:"summary"`
	SourceTitle string `json:"source_title"`
	SourcePage  int    `json:"source_page"`
}

type gameLoreEntityRelationExport struct {
	FromEntityID string `json:"from_entity_id"`
	ToEntityID   string `json:"to_entity_id"`
	Relation     string `json:"relation"`
	SourceTitle  string `json:"source_title"`
	SourcePage   int    `json:"source_page"`
}

type gameExportDoc struct {
	ExportedAt   string                         `json:"exported_at"`
	Version      int                            `json:"version"`
	Game         gameExportMeta                 `json:"game"`
	LoreEntities []gameLoreEntityExport         `json:"lore_entities"`
	Relations    []gameLoreEntityRelationExport `json:"relations"`
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
			ID:          e.ID,
			Kind:        e.Kind,
			Name:        e.Name,
			Tags:        e.Tags,
			Summary:     e.Summary,
			SourceTitle: e.SourceTitle,
			SourcePage:  e.SourcePage,
		})
	}

	relations, err := db.ListGameLoreEntityRelations(ctx, h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	exportedRelations := make([]gameLoreEntityRelationExport, 0, len(relations))
	for _, rel := range relations {
		exportedRelations = append(exportedRelations, gameLoreEntityRelationExport{
			FromEntityID: rel.FromEntityID,
			ToEntityID:   rel.ToEntityID,
			Relation:     rel.Relation,
			SourceTitle:  rel.SourceTitle,
			SourcePage:   rel.SourcePage,
		})
	}

	doc := gameExportDoc{
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Version:    2,
		Game: gameExportMeta{
			Name:        game.Name,
			Slug:        game.Slug,
			Genre:       game.Genre,
			VisualStyle: game.VisualStyle,
		},
		LoreEntities: exported,
		Relations:    exportedRelations,
	}

	manifest, err := json.Marshal(doc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	zf, err := zw.Create(gameExportManifestName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := zf.Write(manifest); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := zw.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	filename := fmt.Sprintf("lore-game-%s.zip", safeFilename(game.Slug))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Write(buf.Bytes()) //nolint:errcheck
}

// maxGameImportSize caps the uploaded zip the same way image uploads are
// capped elsewhere (see uploads.go) — a manifest of even a few thousand lore
// entities is a few MB of JSON, so this leaves generous headroom.
const maxGameImportSize = 32 << 20

func (h *GameHandler) Import(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if err := r.ParseMultipartForm(maxGameImportSize); err != nil {
		writeError(w, http.StatusBadRequest, "invalid upload")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxGameImportSize+1))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(data) > maxGameImportSize {
		writeError(w, http.StatusBadRequest, "file too large")
		return
	}

	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "not a valid zip file")
		return
	}
	manifestFile, err := zr.Open(gameExportManifestName)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("zip is missing %s", gameExportManifestName))
		return
	}
	defer manifestFile.Close()

	var doc gameExportDoc
	if err := json.NewDecoder(manifestFile).Decode(&doc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid manifest")
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

	// Maps the manifest's export-local entity IDs to the IDs this instance
	// just minted, so Relations below (which only knows the old IDs) can be
	// re-pointed at the new rows.
	idMap := make(map[string]string, len(doc.LoreEntities))
	for _, e := range doc.LoreEntities {
		if e.Kind == "" || e.Name == "" {
			continue
		}
		entity, err := db.CreateGameLoreEntity(ctx, h.db, db.CreateGameLoreEntityParams{
			GameID:      game.ID,
			Kind:        e.Kind,
			Name:        e.Name,
			Tags:        e.Tags,
			Summary:     e.Summary,
			SourceTitle: e.SourceTitle,
			SourcePage:  e.SourcePage,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if e.ID != "" {
			idMap[e.ID] = entity.ID
		}
	}

	for _, rel := range doc.Relations {
		fromID, ok := idMap[rel.FromEntityID]
		if !ok {
			continue
		}
		toID, ok := idMap[rel.ToEntityID]
		if !ok {
			continue
		}
		if err := db.UpsertGameLoreEntityRelation(ctx, h.db, db.CreateGameLoreEntityRelationParams{
			GameID:       game.ID,
			FromEntityID: fromID,
			ToEntityID:   toID,
			Relation:     rel.Relation,
			SourceTitle:  rel.SourceTitle,
			SourcePage:   rel.SourcePage,
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
