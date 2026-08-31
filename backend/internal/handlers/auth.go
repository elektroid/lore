package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"lore/internal/auth"
	"lore/internal/config"
	db "lore/internal/db"
	"lore/internal/mail"
)

// AuthHandler handles authentication-related endpoints
type AuthHandler struct {
	db            *sql.DB
	tokenService  *auth.TokenService
	cfg           *config.Config
	secureCookies bool
	mailer        *mail.Mailer
}

// Register request/response types
type registerRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

type registerResponse struct {
	User  userResponse  `json:"user"`
	Token tokenResponse `json:"token"`
}

// Login request/response types
type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	User  userResponse  `json:"user"`
	Token tokenResponse `json:"token"`
}

// User response type (without sensitive data)
type userResponse struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	Role          string `json:"role"`
	EmailVerified bool   `json:"email_verified"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

// Token response type
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"` // seconds until access token expires
}

// Me response type
type meResponse struct {
	User userResponse `json:"user"`
}

// CSRF response type
type csrfResponse struct {
	CSRFToken string `json:"csrf_token"`
}

// Error response type
type errorResponse struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeErrorResponse(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(errorResponse{
		Error: errorDetail{Code: code, Message: message},
	})
}

// NewAuthHandler creates a new AuthHandler
func NewAuthHandler(database *sql.DB, tokenService *auth.TokenService, cfg *config.Config) *AuthHandler {
	return &AuthHandler{
		db:            database,
		tokenService:  tokenService,
		cfg:           cfg,
		secureCookies: cfg.Server.SecureCookies,
		mailer:        mail.New(cfg.SMTP),
	}
}

// Register creates a new user account
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	// An instance reachable from the internet usually wants exactly the players
	// its owner invited, not everyone who finds the URL. Open by default,
	// because there is no admin-side "create user" screen yet — see
	// [auth] registration in lore.toml.example.
	if !h.cfg.RegistrationOpen() {
		writeErrorResponse(w, http.StatusForbidden, "REGISTRATION_CLOSED",
			"les inscriptions sont fermées — demandez un compte à l'administrateur")
		return
	}

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	// Validate input
	if req.Email == "" {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "email is required")
		return
	}
	if req.Name == "" {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "name is required")
		return
	}
	if req.Password == "" {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "password is required")
		return
	}
	if len(req.Password) < 8 {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "password must be at least 8 characters")
		return
	}
	if !strings.Contains(req.Email, "@") {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid email format")
		return
	}

	// Check if email already exists
	existing, err := db.GetUserByEmail(r.Context(), h.db, req.Email)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to check existing user")
		return
	}
	if existing != nil {
		writeErrorResponse(w, http.StatusConflict, "EMAIL_EXISTS", "email already registered")
		return
	}

	// Create user
	user, err := db.CreateUser(r.Context(), h.db, db.CreateUserParams{
		Email:    req.Email,
		Password: req.Password,
		Name:     req.Name,
		Role:     "player", // Default role
	})
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create user")
		return
	}

	// Generate tokens
	accessToken, err := h.tokenService.GenerateAccessToken(user.ID, user.Role)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to generate access token")
		return
	}
	refreshToken, err := h.tokenService.GenerateRefreshToken(user.ID)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to generate refresh token")
		return
	}

	// Set tokens in cookies
	h.setAuthCookies(w, accessToken, refreshToken)

	// Generate CSRF token
	csrfToken := uuid.New().String()
	h.setCSRFCookie(w, csrfToken)

	db.LogAuditEvent(r.Context(), h.db, user.ID, "register", "user", user.ID, user.Email, clientIP(r))

	// Return response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(registerResponse{
		User: userToResponse(user),
		Token: tokenResponse{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresIn:    int(h.tokenService.AccessExpiry().Seconds()),
		},
	})
}

// Login authenticates a user
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	// Validate input
	if req.Email == "" {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "email is required")
		return
	}
	if req.Password == "" {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "password is required")
		return
	}

	// Get user by email
	user, err := db.GetUserByEmail(r.Context(), h.db, req.Email)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to find user")
		return
	}
	if user == nil {
		// Generic message to prevent email enumeration
		db.LogAuditEvent(r.Context(), h.db, "", "login_failed", "user", "", req.Email, clientIP(r))
		writeErrorResponse(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
		return
	}

	// Check password
	if !user.CheckPassword(req.Password) {
		db.LogAuditEvent(r.Context(), h.db, "", "login_failed", "user", user.ID, req.Email, clientIP(r))
		writeErrorResponse(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
		return
	}

	// Generate tokens
	accessToken, err := h.tokenService.GenerateAccessToken(user.ID, user.Role)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to generate access token")
		return
	}
	refreshToken, err := h.tokenService.GenerateRefreshToken(user.ID)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to generate refresh token")
		return
	}

	// Set tokens in cookies
	h.setAuthCookies(w, accessToken, refreshToken)

	// Generate CSRF token
	csrfToken := uuid.New().String()
	h.setCSRFCookie(w, csrfToken)

	db.LogAuditEvent(r.Context(), h.db, user.ID, "login", "user", user.ID, user.Email, clientIP(r))

	// Return response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loginResponse{
		User: userToResponse(user),
		Token: tokenResponse{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresIn:    int(h.tokenService.AccessExpiry().Seconds()),
		},
	})
}

// Logout clears authentication cookies
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	// Logout is a public route (no AuthMiddleware, see isPublicEndpoint), so
	// the actor isn't in context — read the cookie being cleared instead.
	// Best-effort: an expired or missing token just means no event is logged.
	if cookie, err := r.Cookie("lore_access"); err == nil {
		if claims, err := h.tokenService.ParseAccessToken(cookie.Value); err == nil {
			if user, err := db.GetUserByID(r.Context(), h.db, claims.UserID); err == nil && user != nil {
				db.LogAuditEvent(r.Context(), h.db, user.ID, "logout", "user", user.ID, user.Email, clientIP(r))
			}
		}
	}

	// Clear access token cookie
	h.clearCookie(w, "lore_access")
	// Clear refresh token cookie
	h.clearCookie(w, "lore_refresh")
	// Clear CSRF cookie
	h.clearCookie(w, "lore_csrf")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "logged out successfully"})
}

// UpdateMe updates the current authenticated user's profile
func (h *AuthHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeErrorResponse(w, http.StatusUnauthorized, "UNAUTHENTICATED", "authentication required")
		return
	}

	var req struct {
		Name            string `json:"name"`
		Email           string `json:"email"`
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}
	if req.Name == "" {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "name is required")
		return
	}
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "valid email is required")
		return
	}

	fullUser, err := db.GetUserByID(r.Context(), h.db, user.ID)
	if err != nil || fullUser == nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch user")
		return
	}

	// If changing password, validate current password first
	if req.NewPassword != "" {
		if req.CurrentPassword == "" {
			writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "current password is required to set a new password")
			return
		}
		if !fullUser.CheckPassword(req.CurrentPassword) {
			writeErrorResponse(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "current password is incorrect")
			return
		}
		if len(req.NewPassword) < 8 {
			writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "new password must be at least 8 characters")
			return
		}
	}

	// Check email uniqueness if changed
	if req.Email != fullUser.Email {
		existing, err := db.GetUserByEmail(r.Context(), h.db, req.Email)
		if err != nil {
			writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to check email")
			return
		}
		if existing != nil {
			writeErrorResponse(w, http.StatusConflict, "EMAIL_EXISTS", "email already in use")
			return
		}
	}

	updated, err := db.UpdateUser(r.Context(), h.db, user.ID, req.Name, req.Email)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update profile")
		return
	}

	if req.NewPassword != "" {
		if err := db.UpdateUserPassword(r.Context(), h.db, user.ID, req.NewPassword); err != nil {
			writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update password")
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(meResponse{User: userToResponse(updated)})
}

// Me returns the current authenticated user
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeErrorResponse(w, http.StatusUnauthorized, "UNAUTHENTICATED", "authentication required")
		return
	}

	// Fetch full user from database
	fullUser, err := db.GetUserByID(r.Context(), h.db, user.ID)
	if err != nil || fullUser == nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch user")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(meResponse{
		User: userToResponse(fullUser),
	})
}

// Refresh refreshes the access token using the refresh token
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	// Get refresh token from cookie
	refreshCookie, err := r.Cookie("lore_refresh")
	if err != nil {
		writeErrorResponse(w, http.StatusUnauthorized, "UNAUTHENTICATED", "refresh token required")
		return
	}

	// Parse refresh token
	claims, err := h.tokenService.ParseRefreshToken(refreshCookie.Value)
	if err != nil {
		// Clear invalid refresh token
		h.clearCookie(w, "lore_refresh")
		writeErrorResponse(w, http.StatusUnauthorized, "UNAUTHENTICATED", "invalid refresh token")
		return
	}

	// Verify it's actually a refresh token
	if claims.TokenType != "refresh" {
		h.clearCookie(w, "lore_refresh")
		writeErrorResponse(w, http.StatusUnauthorized, "UNAUTHENTICATED", "invalid token type")
		return
	}

	// Get user to verify they still exist and get their role
	user, err := db.GetUserByID(r.Context(), h.db, claims.UserID)
	if err != nil || user == nil {
		h.clearCookie(w, "lore_refresh")
		writeErrorResponse(w, http.StatusUnauthorized, "UNAUTHENTICATED", "user not found")
		return
	}

	// Generate new tokens
	accessToken, err := h.tokenService.GenerateAccessToken(user.ID, user.Role)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to generate access token")
		return
	}
	refreshToken, err := h.tokenService.GenerateRefreshToken(user.ID)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to generate refresh token")
		return
	}

	// Set new tokens in cookies
	h.setAuthCookies(w, accessToken, refreshToken)

	// Return new access token
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int(h.tokenService.AccessExpiry().Seconds()),
	})
}

// CSRF returns a new CSRF token
func (h *AuthHandler) CSRF(w http.ResponseWriter, r *http.Request) {
	// Generate CSRF token
	csrfToken := uuid.New().String()
	h.setCSRFCookie(w, csrfToken)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(csrfResponse{
		CSRFToken: csrfToken,
	})
}

// Bootstrap creates the first superuser if no users exist
// This is a special endpoint that should be disabled in production
func (h *AuthHandler) Bootstrap(w http.ResponseWriter, r *http.Request) {
	// Check if this is enabled via config
	if h.cfg.Bootstrap.User == "" {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "bootstrap is disabled")
		return
	}

	// Check if users already exist
	users, err := db.ListUsers(r.Context(), h.db)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to check existing users")
		return
	}
	if len(users) > 0 {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "users already exist, bootstrap disabled")
		return
	}

	// Parse bootstrap config: "email:password:role"
	parts := strings.Split(h.cfg.Bootstrap.User, ":")
	if len(parts) < 3 {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_CONFIG", "invalid bootstrap user format")
		return
	}
	email, password, role := parts[0], parts[1], parts[2]

	// Create the user
	user, err := db.CreateUser(r.Context(), h.db, db.CreateUserParams{
		Email:    email,
		Password: password,
		Name:     "Admin",
		Role:     role,
	})
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create bootstrap user")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(registerResponse{
		User: userToResponse(user),
	})
}

// ForgotPassword issues a password reset link and emails it, if the address
// belongs to an account and SMTP is configured. The response is identical
// either way — unknown email, no SMTP configured, or send failure all look
// the same to the caller — so this endpoint cannot be used to enumerate
// registered accounts.
func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "valid email is required")
		return
	}

	if h.mailer.Enabled() {
		if user, err := db.GetUserByEmail(r.Context(), h.db, req.Email); err == nil && user != nil {
			if token, err := db.CreatePasswordResetToken(r.Context(), h.db, user.ID); err == nil {
				link := resetLink(r, token)
				if err := h.mailer.SendPasswordReset(user.Email, user.Name, link); err != nil {
					log.Printf("password reset email to %s: %v", user.Email, err)
				} else {
					db.LogAuditEvent(r.Context(), h.db, user.ID, "password_reset_requested", "user", user.ID, user.Email, clientIP(r))
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé",
	})
}

// ResetPassword redeems a token minted by ForgotPassword and sets a new
// password. Every outstanding token for the user is deleted afterwards —
// including the one just used — so a copy of an old link cannot be replayed.
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}
	if req.Token == "" {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "token is required")
		return
	}
	if len(req.NewPassword) < 8 {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", "password must be at least 8 characters")
		return
	}

	userID, err := db.GetValidPasswordResetToken(r.Context(), h.db, req.Token)
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to validate token")
		return
	}
	if userID == "" {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_TOKEN", "lien invalide ou expiré")
		return
	}

	if err := db.UpdateUserPassword(r.Context(), h.db, userID, req.NewPassword); err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update password")
		return
	}
	db.DeletePasswordResetTokensForUser(r.Context(), h.db, userID) //nolint:errcheck

	if user, err := db.GetUserByID(r.Context(), h.db, userID); err == nil && user != nil {
		db.LogAuditEvent(r.Context(), h.db, user.ID, "password_reset", "user", user.ID, user.Email, clientIP(r))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "mot de passe mis à jour"})
}

// resetLink builds the absolute URL emailed to the user. There is no
// configured public base URL (see docs/deployment.md — the reverse proxy is
// the only thing that knows the external host), so this reconstructs it from
// the request instead: nginx forwards the original Host header unchanged
// (proxy_set_header Host $host) and sets X-Forwarded-Proto, which is exactly
// what's needed here.
func resetLink(r *http.Request, token string) string {
	scheme := "http"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host + "/reset-password?token=" + token
}

// Helper functions

func (h *AuthHandler) setAuthCookies(w http.ResponseWriter, accessToken, refreshToken string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "lore_access",
		Value:    accessToken,
		Path:     "/",
		Expires:  time.Now().Add(h.tokenService.AccessExpiry()),
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteStrictMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "lore_refresh",
		Value:    refreshToken,
		Path:     "/",
		Expires:  time.Now().Add(h.tokenService.RefreshExpiry()),
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteStrictMode,
	})
}

func (h *AuthHandler) setCSRFCookie(w http.ResponseWriter, csrfToken string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "lore_csrf",
		Value:    csrfToken,
		Path:     "/",
		Expires:  time.Now().Add(24 * time.Hour),
		HttpOnly: false, // must be JS-readable for CSRF double-submit pattern
		Secure:   h.secureCookies,
		SameSite: http.SameSiteStrictMode,
	})
}

func (h *AuthHandler) clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteStrictMode,
	})
}

func userToResponse(u *db.User) userResponse {
	return userResponse{
		ID:            u.ID,
		Email:         u.Email,
		Name:          u.Name,
		Role:          u.Role,
		EmailVerified: u.EmailVerified,
		CreatedAt:     u.CreatedAt,
		UpdatedAt:     u.UpdatedAt,
	}
}
