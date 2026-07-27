package auth

import (
	"fmt"
	"strings"

	"lore/internal/config"
)

// ConfigToTokenService creates a TokenService from config
func ConfigToTokenService(cfg *config.Config) (*TokenService, error) {
	accessExpiry, err := ParseDuration(cfg.JWT.AccessExpiry)
	if err != nil {
		return nil, fmt.Errorf("invalid access expiry: %w", err)
	}
	refreshExpiry, err := ParseDuration(cfg.JWT.RefreshExpiry)
	if err != nil {
		return nil, fmt.Errorf("invalid refresh expiry: %w", err)
	}

	// No fallback secret. There used to be a hardcoded one here, which meant an
	// instance with no jwt.secret signed its tokens with a string published in
	// this repository — anyone could mint themselves an administrator session.
	// config.Validate decides how strict to be about a *weak* secret; an absent
	// one is never acceptable.
	if strings.TrimSpace(cfg.JWT.Secret) == "" {
		return nil, fmt.Errorf("jwt.secret is not set — generate one with: openssl rand -hex 32")
	}

	return NewTokenService(cfg.JWT.Secret, accessExpiry, refreshExpiry), nil
}
