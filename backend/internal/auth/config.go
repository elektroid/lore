package auth

import (
	"fmt"
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

	secret := cfg.JWT.Secret
	if secret == "" {
		// Generate a default secret if none provided (for dev only)
		// In production, this should be set in config
		secret = "default-dev-secret-change-in-production"
	}

	return NewTokenService(secret, accessExpiry, refreshExpiry), nil
}
