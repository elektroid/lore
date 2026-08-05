package handlers

import (
	"context"
	"database/sql"
	"encoding/json"

	"lore/internal/crypto"
	db "lore/internal/db"
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

// loadImageConfig reads image_config from settings (migrating once from the
// legacy mistral_config key, see readRawImageConfig) and decrypts both
// providers' API keys.
func loadImageConfig(ctx context.Context, database *sql.DB, encKey string) (ImageConfig, error) {
	cfg, err := readRawImageConfig(ctx, database)
	if err != nil {
		return ImageConfig{}, err
	}
	if cfg.MistralAPIKey != "" {
		plain, err := crypto.Decrypt(encKey, cfg.MistralAPIKey)
		if err != nil {
			return ImageConfig{}, err
		}
		cfg.MistralAPIKey = plain
	}
	if cfg.OpenRouterAPIKey != "" {
		plain, err := crypto.Decrypt(encKey, cfg.OpenRouterAPIKey)
		if err != nil {
			return ImageConfig{}, err
		}
		cfg.OpenRouterAPIKey = plain
	}
	return cfg, nil
}
