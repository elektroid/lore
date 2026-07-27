package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

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
		mistralCfg, err := loadMistralConfig(r.Context(), h.db, h.encKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if mistralCfg.APIKey == "" {
			writeError(w, http.StatusBadRequest, "aucune clé Mistral enregistrée à réutiliser")
			return
		}
		enc, err := crypto.Encrypt(h.encKey, mistralCfg.APIKey)
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
	// Return with key masked.
	if cfg.APIKey != "" {
		cfg.APIKey = crypto.MaskedKey
	}
	writeJSON(w, http.StatusOK, cfg)
}

type MistralConfig struct {
	APIKey     string `json:"api_key"`
	ImageCount int    `json:"image_count"`
}

func (h *SettingsHandler) GetMistral(w http.ResponseWriter, r *http.Request) {
	raw, err := db.GetSetting(r.Context(), h.db, "mistral_config")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var cfg MistralConfig
	json.Unmarshal([]byte(raw), &cfg) //nolint:errcheck
	if cfg.ImageCount == 0 {
		cfg.ImageCount = 3
	}
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

func (h *SettingsHandler) PutMistral(w http.ResponseWriter, r *http.Request) {
	var cfg MistralConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}
	if cfg.ImageCount == 0 {
		cfg.ImageCount = 3
	}
	if crypto.IsMasked(cfg.APIKey) {
		raw, _ := db.GetSetting(r.Context(), h.db, "mistral_config")
		var existing MistralConfig
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
	if err := db.SetSetting(r.Context(), h.db, "mistral_config", string(b)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if cfg.APIKey != "" {
		cfg.APIKey = crypto.MaskedKey
	}
	writeJSON(w, http.StatusOK, cfg)
}
