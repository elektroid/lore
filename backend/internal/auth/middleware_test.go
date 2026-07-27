package auth

import "testing"

// The static application must be reachable without a session, or the login page
// 401s and nobody can ever get in. The API must not be.
func TestPublicEndpointBoundary(t *testing.T) {
	open := []string{
		"/", "/login", "/campaigns/abc-123", "/assets/index-B5YvlSsd.js", "/favicon.ico",
		"/uploads/locations/uuid/uuid.png",
		"/api/auth/login", "/api/auth/register", "/api/auth/csrf",
		"/api/table/deadbeef", "/api/table/deadbeef/stream",
	}
	for _, p := range open {
		if !isPublicEndpoint(p) {
			t.Errorf("%s should be reachable without a session", p)
		}
	}

	closed := []string{
		"/api/campaigns", "/api/campaigns/x/npcs", "/api/settings/llm",
		"/api/users", "/api/scenarios/x/beats", "/api/auth/me",
		"/external-material/rulebook.pdf",
	}
	for _, p := range closed {
		if isPublicEndpoint(p) {
			t.Errorf("%s must require a session", p)
		}
	}
}
