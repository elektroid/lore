package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
	"lore/internal/auth"
)

// CharacterHandler handles player character endpoints
type CharacterHandler struct {
	db *sql.DB
}

// List returns all characters for the current user
type listCharactersResponse struct {
	Characters []db.PlayerCharacter `json:"characters"`
}

func (h *CharacterHandler) List(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	chars, err := db.ListPlayerCharacters(r.Context(), h.db, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, listCharactersResponse{Characters: chars})
}

// Create creates a new player character
type createCharacterRequest struct {
	GameID      string `json:"game_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PersonalStory string `json:"personal_story"`
}

func (h *CharacterHandler) Create(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req createCharacterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	char, err := db.CreatePlayerCharacter(r.Context(), h.db, db.CreatePlayerCharacterParams{
		UserID:      user.ID,
		GameID:      req.GameID,
		Name:        req.Name,
		Description: req.Description,
		PersonalStory: req.PersonalStory,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, char)
}

// Get returns a single character
type getCharacterResponse struct {
	Character *db.PlayerCharacter `json:"character"`
}

func (h *CharacterHandler) Get(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	id := chi.URLParam(r, "id")
	char, err := db.GetPlayerCharacter(r.Context(), h.db, id, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if char == nil {
		writeError(w, http.StatusNotFound, "character not found")
		return
	}

	writeJSON(w, http.StatusOK, getCharacterResponse{Character: char})
}

// Update updates a player character
type updateCharacterRequest struct {
	Name           string `json:"name"`
	Description   string `json:"description"`
	PersonalStory string `json:"personal_story"`
}

func (h *CharacterHandler) Update(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	id := chi.URLParam(r, "id")

	var req updateCharacterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	char, err := db.UpdatePlayerCharacter(r.Context(), h.db, id, user.ID, db.UpdatePlayerCharacterParams{
		Name:           req.Name,
		Description:   req.Description,
		PersonalStory: req.PersonalStory,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if char == nil {
		writeError(w, http.StatusNotFound, "character not found")
		return
	}

	writeJSON(w, http.StatusOK, getCharacterResponse{Character: char})
}

// Delete deletes a player character
func (h *CharacterHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	id := chi.URLParam(r, "id")

	if err := db.DeletePlayerCharacter(r.Context(), h.db, id, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
