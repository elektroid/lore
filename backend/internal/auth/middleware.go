package auth

import (
	"context"
	"database/sql"
	"net/http"

	"lore/internal/db"
)

// Error codes for consistent error responses
const (
	ErrUnauthenticated = "UNAUTHENTICATED"
	ErrUnauthorized    = "UNAUTHORIZED"
	ErrCSRFInvalid     = "CSRF_INVALID"
	ErrRateLimited     = "RATE_LIMITED"
)

// AuthContextKey is the context key for auth claims
type AuthContextKey struct{}

// ContextUser represents the authenticated user in context
type ContextUser struct {
	ID   string
	Role string
}

// contextKey for CSRF token
type csrfContextKey struct{}

// CSRFContext holds CSRF token info
type CSRFContext struct {
	Token string
}

// isPublicEndpoint checks if the request path is for a public endpoint
func isPublicEndpoint(path string) bool {
	switch path {
	case "/api/auth/register", "/api/auth/login", "/api/auth/logout",
		"/api/auth/refresh", "/api/auth/csrf", "/api/auth/bootstrap":
		return true
	}
	return false
}

// AuthMiddleware creates a middleware that validates JWT tokens
func AuthMiddleware(tokenService *TokenService, database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth for public endpoints
			if isPublicEndpoint(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			// Get token from cookie
			accessToken, err := r.Cookie("lore_access")
			if err != nil {
				writeAuthError(w, http.StatusUnauthorized, ErrUnauthenticated, "authentication required")
				return
			}

			// Parse and validate token
			claims, err := tokenService.ParseAccessToken(accessToken.Value)
			if err != nil {
				writeAuthError(w, http.StatusUnauthorized, ErrUnauthenticated, "invalid or expired token")
				return
			}

			// Fetch user from database to ensure they still exist
			user, err := db.GetUserByID(r.Context(), database, claims.UserID)
			if err != nil || user == nil {
				writeAuthError(w, http.StatusUnauthorized, ErrUnauthenticated, "user not found")
				return
			}

			// Add user to context
			ctx := context.WithValue(r.Context(), AuthContextKey{}, ContextUser{
				ID:   user.ID,
				Role: user.Role,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// CSRFMiddleware creates a middleware that validates CSRF tokens
func CSRFMiddleware(tokenService *TokenService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip CSRF for safe methods and public endpoints
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			if isPublicEndpoint(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			// Get CSRF token from header
			headerToken := r.Header.Get("X-CSRF-Token")
			if headerToken == "" {
				writeAuthError(w, http.StatusForbidden, ErrCSRFInvalid, "CSRF token missing")
				return
			}

			// Get CSRF token from cookie
			cookie, err := r.Cookie("lore_csrf")
			if err != nil {
				writeAuthError(w, http.StatusForbidden, ErrCSRFInvalid, "CSRF cookie missing")
				return
			}

			// Verify tokens match (Double Submit Cookie pattern)
			if headerToken != cookie.Value {
				writeAuthError(w, http.StatusForbidden, ErrCSRFInvalid, "CSRF token mismatch")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// writeAuthError writes a standardized auth error response
func writeAuthError(w http.ResponseWriter, statusCode int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	w.Write([]byte(`{"error":{"code":"` + code + `","message":"` + message + `"}}`))
}

// GetUserFromContext extracts the user from request context
func GetUserFromContext(r *http.Request) (ContextUser, bool) {
	user, ok := r.Context().Value(AuthContextKey{}).(ContextUser)
	return user, ok
}

// RequireRole is a helper that checks if the current user has the required role
func RequireRole(requiredRole string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := GetUserFromContext(r)
			if !ok {
				writeAuthError(w, http.StatusUnauthorized, ErrUnauthenticated, "authentication required")
				return
			}

			if user.Role != requiredRole && user.Role != "superuser" {
				writeAuthError(w, http.StatusForbidden, ErrUnauthorized, "insufficient permissions")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireCampaignMember is a helper that checks if the current user is a member of the campaign
func RequireCampaignMember(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := GetUserFromContext(r)
			if !ok {
				writeAuthError(w, http.StatusUnauthorized, ErrUnauthenticated, "authentication required")
				return
			}

			// Extract campaign ID from URL
			campaignID := extractCampaignIDFromPath(r.URL.Path)
			if campaignID == "" {
				// If no campaign ID in path, check if user is superuser
				if user.Role != "superuser" {
					writeAuthError(w, http.StatusForbidden, ErrUnauthorized, "insufficient permissions")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			// Check if user is campaign member or superuser
			isMember, err := db.IsCampaignMember(r.Context(), database, campaignID, user.ID)
			if err != nil {
				writeAuthError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to check campaign membership")
				return
			}

			if !isMember && user.Role != "superuser" {
				writeAuthError(w, http.StatusForbidden, ErrUnauthorized, "access denied to this campaign")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// extractCampaignIDFromPath extracts campaign ID from URL path
// Handles paths like /api/campaigns/{id}/... or /api/scenarios/{id}/...
func extractCampaignIDFromPath(path string) string {
	// This is a simplified version - in practice, you'd use the chi URL params
	// For now, return empty string and let the handler extract it properly
	return ""
}

// RateLimitMiddleware creates a simple rate limiting middleware
// For production, consider using a more sophisticated library
func RateLimitMiddleware(maxRequests int, windowMinutes int) func(http.Handler) http.Handler {
	// Simple implementation - for production use a proper rate limiter
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// For now, just pass through - implement proper rate limiting later
			next.ServeHTTP(w, r)
		})
	}
}
