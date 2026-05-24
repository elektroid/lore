package handlers

import (
	"context"
	"database/sql"
	"encoding/json"

	db "lore/internal/db"
	"lore/internal/crypto"
	"lore/internal/llm"
)

// loadLLMConfig reads llm_config from settings and decrypts the api_key.
func loadLLMConfig(ctx context.Context, database *sql.DB, encKey string) (llm.Config, error) {
	raw, err := db.GetSetting(ctx, database, "llm_config")
	if err != nil {
		return llm.Config{}, err
	}
	var cfg llm.Config
	json.Unmarshal([]byte(raw), &cfg) //nolint:errcheck
	if cfg.APIKey != "" {
		plain, err := crypto.Decrypt(encKey, cfg.APIKey)
		if err != nil {
			return llm.Config{}, err
		}
		cfg.APIKey = plain
	}
	return cfg, nil
}

// loadMistralConfig reads mistral_config from settings and decrypts the api_key.
func loadMistralConfig(ctx context.Context, database *sql.DB, encKey string) (MistralConfig, error) {
	raw, err := db.GetSetting(ctx, database, "mistral_config")
	if err != nil {
		return MistralConfig{}, err
	}
	var cfg MistralConfig
	json.Unmarshal([]byte(raw), &cfg) //nolint:errcheck
	if cfg.ImageCount == 0 {
		cfg.ImageCount = 3
	}
	if cfg.APIKey != "" {
		plain, err := crypto.Decrypt(encKey, cfg.APIKey)
		if err != nil {
			return MistralConfig{}, err
		}
		cfg.APIKey = plain
	}
	return cfg, nil
}
