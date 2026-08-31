package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"lore/internal/auth"
	db "lore/internal/db"
)

type UserHandler struct {
	db *sql.DB
}

// List returns all users — accessible to any authenticated user (needed for campaign member selection)
func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	users, err := db.ListUsers(r.Context(), h.db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	type publicUser struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Email     string `json:"email"`
		Role      string `json:"role"`
		CreatedAt string `json:"created_at"`
	}
	out := make([]publicUser, len(users))
	for i, u := range users {
		out[i] = publicUser{ID: u.ID, Name: u.Name, Email: u.Email, Role: u.Role, CreatedAt: u.CreatedAt}
	}
	writeJSON(w, http.StatusOK, out)
}

// Create adds a user account directly — superuser only. Exists because
// self-registration can be closed (`[auth] registration = "closed"` in
// lore.toml) or an instance may simply not want it open, and an author
// granting campaign access can only pick from accounts that already exist
// (docs/users-authors.md §5, "a player has to register before an author can
// add them"). There is no invite email — see CLAUDE.md, "Email verification
// is disabled" — so the admin sets the initial password directly, the same
// way `[bootstrap]` seeds the first account.
func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
	requester, ok := auth.GetUserFromContext(r)
	if !ok || requester.Role != "superuser" {
		writeError(w, http.StatusForbidden, "superuser required")
		return
	}

	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		writeError(w, http.StatusBadRequest, "a valid email is required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if req.Role == "" {
		req.Role = "player"
	}
	if req.Role != "player" && req.Role != "superuser" {
		writeError(w, http.StatusBadRequest, "role must be 'player' or 'superuser'")
		return
	}

	existing, err := db.GetUserByEmail(r.Context(), h.db, req.Email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing != nil {
		writeError(w, http.StatusConflict, "email already registered")
		return
	}

	created, err := db.CreateUser(r.Context(), h.db, db.CreateUserParams{
		Email:    req.Email,
		Password: req.Password,
		Name:     req.Name,
		Role:     req.Role,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	db.LogAuditEvent(r.Context(), h.db, requester.ID, "user_created", "user", created.ID, created.Email, clientIP(r))

	writeJSON(w, http.StatusCreated, userToResponse(created))
}

// UpdateRole changes a user's role — superuser only
func (h *UserHandler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	requester, ok := auth.GetUserFromContext(r)
	if !ok || requester.Role != "superuser" {
		writeError(w, http.StatusForbidden, "superuser required")
		return
	}

	targetID := chi.URLParam(r, "id")

	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Role != "player" && req.Role != "superuser" {
		writeError(w, http.StatusBadRequest, "role must be 'player' or 'superuser'")
		return
	}

	updated, err := db.UpdateUserRole(r.Context(), h.db, targetID, req.Role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if updated == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	action := "role_demoted"
	if req.Role == "superuser" {
		action = "role_promoted"
	}
	db.LogAuditEvent(r.Context(), h.db, requester.ID, action, "user", updated.ID, updated.Email, clientIP(r))

	writeJSON(w, http.StatusOK, userToResponse(updated))
}
