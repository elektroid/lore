package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
	Name string `json:"name"`
	Slug string `json:"slug"`
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
	game, err := db.CreateGame(r.Context(), h.db, body.Name, body.Slug)
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
	game, err := db.UpdateGame(r.Context(), h.db, id, body.Name, body.Slug)
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
