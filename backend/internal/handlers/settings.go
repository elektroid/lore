package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"lore/internal/auth"
	"lore/internal/crypto"
	db "lore/internal/db"
	"lore/internal/llm"
)

type SettingsHandler struct {
	db     *sql.DB
	encKey string
}

// mistralKeySentinel lets the frontend ask the LLM config to reuse the
// already-configured Mistral (image generation) API key, without ever
// having to see its plaintext value.
const mistralKeySentinel = "__use_mistral_key__"

func (h *SettingsHandler) GetLLM(w http.ResponseWriter, r *http.Request) {
	raw, err := db.GetSetting(r.Context(), h.db, "llm_config")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var cfg llm.Config
	json.Unmarshal([]byte(raw), &cfg) //nolint:errcheck
	if cfg.APIKey != "" {
		plain, err := crypto.Decrypt(h.encKey, cfg.APIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "clé illisible")
			return
		}
		if plain != "" {
			cfg.APIKey = crypto.MaskedKey
		}
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *SettingsHandler) PutLLM(w http.ResponseWriter, r *http.Request) {
	var cfg llm.Config
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}
	if cfg.APIKey == mistralKeySentinel {
		imgCfg, err := loadImageConfig(r.Context(), h.db, h.encKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if imgCfg.MistralAPIKey == "" {
			writeError(w, http.StatusBadRequest, "aucune clé Mistral enregistrée à réutiliser")
			return
		}
		enc, err := crypto.Encrypt(h.encKey, imgCfg.MistralAPIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "échec du chiffrement")
			return
		}
		cfg.APIKey = enc
	} else if crypto.IsMasked(cfg.APIKey) {
		// Keep the existing encrypted value.
		raw, _ := db.GetSetting(r.Context(), h.db, "llm_config")
		var existing llm.Config
		json.Unmarshal([]byte(raw), &existing) //nolint:errcheck
		cfg.APIKey = existing.APIKey
	} else {
		enc, err := crypto.Encrypt(h.encKey, cfg.APIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "échec du chiffrement")
			return
		}
		cfg.APIKey = enc
	}
	b, _ := json.Marshal(cfg)
	if err := db.SetSetting(r.Context(), h.db, "llm_config", string(b)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if requester, ok := auth.GetUserFromContext(r); ok {
		db.LogAuditEvent(r.Context(), h.db, requester.ID, "llm_config_updated", "settings", "llm_config", cfg.BaseURL, clientIP(r))
	}

	// Return with key masked.
	if cfg.APIKey != "" {
		cfg.APIKey = crypto.MaskedKey
	}
	writeJSON(w, http.StatusOK, cfg)
}

// ListLLMModels proxies GET {base_url}/models for the settings UI, so an
// admin can pick a model from a live list instead of typing an ID. Accepts an
// unsaved base_url/api_key pair (e.g. while editing the form before saving);
// an empty or masked api_key falls back to the already-stored LLM key.
func (h *SettingsHandler) ListLLMModels(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}
	if req.BaseURL == "" {
		writeError(w, http.StatusBadRequest, "base_url requis")
		return
	}

	apiKey := req.APIKey
	if apiKey == "" || crypto.IsMasked(apiKey) {
		existing, err := loadLLMConfig(r.Context(), h.db, h.encKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		apiKey = existing.APIKey
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	client := llm.NewClient(llm.Config{BaseURL: req.BaseURL, APIKey: apiKey, Timeout: 15 * time.Second})
	models, err := client.ListModels(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, models)
}

// MistralConfig is the pre-multi-provider image settings shape, kept only so
// readRawImageConfig can migrate an existing install's "mistral_config"
// setting (and lore.toml's [mistral] seed, see main.go) into ImageConfig once.
type MistralConfig struct {
	APIKey     string `json:"api_key"`
	ImageCount int    `json:"image_count"`
}

const legacyMistralSettingKey = "mistral_config"
const imageSettingKey = "image_config"

// ImageConfig holds settings for every supported image-generation provider at
// once (rather than one active provider's fields only), so switching
// providers in the UI doesn't lose a previously-entered key. Provider selects
// which one is actually used.
type ImageConfig struct {
	Provider         string `json:"provider"` // "mistral" | "openrouter"
	MistralAPIKey    string `json:"mistral_api_key"`
	OpenRouterAPIKey string `json:"openrouter_api_key"`
	OpenRouterModel  string `json:"openrouter_model"`
	ImageCount       int    `json:"image_count"`
}

// readRawImageConfig returns the "image_config" setting, migrating once from
// the legacy Mistral-only "mistral_config" setting if "image_config" has
// never been saved. API key fields are returned exactly as stored (encrypted,
// or legacy plaintext) — callers decide whether to mask or decrypt them.
func readRawImageConfig(ctx context.Context, database *sql.DB) (ImageConfig, error) {
	raw, err := db.GetSetting(ctx, database, imageSettingKey)
	if err != nil {
		return ImageConfig{}, err
	}
	var cfg ImageConfig
	if raw != "" && raw != "{}" {
		json.Unmarshal([]byte(raw), &cfg) //nolint:errcheck
		if cfg.Provider == "" {
			cfg.Provider = "mistral"
		}
		if cfg.ImageCount == 0 {
			cfg.ImageCount = 3
		}
		return cfg, nil
	}

	legacyRaw, err := db.GetSetting(ctx, database, legacyMistralSettingKey)
	if err != nil {
		return ImageConfig{}, err
	}
	var legacy MistralConfig
	json.Unmarshal([]byte(legacyRaw), &legacy) //nolint:errcheck
	cfg = ImageConfig{Provider: "mistral", MistralAPIKey: legacy.APIKey, ImageCount: legacy.ImageCount}
	if cfg.ImageCount == 0 {
		cfg.ImageCount = 3
	}
	return cfg, nil
}

func (h *SettingsHandler) GetImageConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := readRawImageConfig(r.Context(), h.db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if cfg.MistralAPIKey != "" {
		plain, err := crypto.Decrypt(h.encKey, cfg.MistralAPIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "clé Mistral illisible")
			return
		}
		if plain != "" {
			cfg.MistralAPIKey = crypto.MaskedKey
		}
	}
	if cfg.OpenRouterAPIKey != "" {
		plain, err := crypto.Decrypt(h.encKey, cfg.OpenRouterAPIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "clé OpenRouter illisible")
			return
		}
		if plain != "" {
			cfg.OpenRouterAPIKey = crypto.MaskedKey
		}
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *SettingsHandler) PutImageConfig(w http.ResponseWriter, r *http.Request) {
	var cfg ImageConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}
	if cfg.ImageCount == 0 {
		cfg.ImageCount = 3
	}
	if cfg.Provider == "" {
		cfg.Provider = "mistral"
	}

	existing, err := readRawImageConfig(r.Context(), h.db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if crypto.IsMasked(cfg.MistralAPIKey) {
		cfg.MistralAPIKey = existing.MistralAPIKey
	} else {
		enc, err := crypto.Encrypt(h.encKey, cfg.MistralAPIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "échec du chiffrement")
			return
		}
		cfg.MistralAPIKey = enc
	}

	if crypto.IsMasked(cfg.OpenRouterAPIKey) {
		cfg.OpenRouterAPIKey = existing.OpenRouterAPIKey
	} else {
		enc, err := crypto.Encrypt(h.encKey, cfg.OpenRouterAPIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "échec du chiffrement")
			return
		}
		cfg.OpenRouterAPIKey = enc
	}

	b, _ := json.Marshal(cfg)
	if err := db.SetSetting(r.Context(), h.db, imageSettingKey, string(b)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if requester, ok := auth.GetUserFromContext(r); ok {
		db.LogAuditEvent(r.Context(), h.db, requester.ID, "image_config_updated", "settings", imageSettingKey, cfg.Provider, clientIP(r))
	}

	if cfg.MistralAPIKey != "" {
		cfg.MistralAPIKey = crypto.MaskedKey
	}
	if cfg.OpenRouterAPIKey != "" {
		cfg.OpenRouterAPIKey = crypto.MaskedKey
	}
	writeJSON(w, http.StatusOK, cfg)
}
