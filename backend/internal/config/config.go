package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Server           ServerConfig           `toml:"server"`
	Database         DatabaseConfig         `toml:"database"`
	Uploads          UploadsConfig          `toml:"uploads"`
	ExternalMaterial ExternalMaterialConfig `toml:"external_material"`
	LLM              LLMConfig              `toml:"llm"`
	Mistral          MistralConfig          `toml:"mistral"`
	JWT              JWTConfig              `toml:"jwt"`
	CORS             CORSConfig             `toml:"cors"`
	Bootstrap        BootstrapConfig        `toml:"bootstrap"`
	Crypto           CryptoConfig           `toml:"crypto"`
	Auth             AuthConfig             `toml:"auth"`
	SMTP             SMTPConfig             `toml:"smtp"`
	Journal          JournalConfig          `toml:"journal"`
}

// JournalConfig controls the write journal — the append-only record of every
// mutating request, with the row as it stood before it. See
// docs/adr/0002-write-journal-for-recovery.md.
//
// On by default, because it exists precisely for the period when the app is
// not yet trusted not to lose an author's prose. It holds the full text of
// everything anyone writes, so turning it off is a real decision — and this
// makes it a one-liner.
type JournalConfig struct {
	Enabled  *bool  `toml:"enabled"`
	Retain   string `toml:"retain"`    // e.g. "30d"; empty means 30 days
	MaxBytes string `toml:"max_bytes"` // e.g. "500MB"; empty means 500 MB
}

func (c JournalConfig) On() bool { return c.Enabled == nil || *c.Enabled }

// RetainDays parses Retain, falling back to 30 days. Anything unparseable is
// the default rather than an error: a typo in a debug facility's retention
// must not stop the server booting.
func (c JournalConfig) RetainDays() int {
	v := strings.TrimSpace(strings.ToLower(c.Retain))
	if v == "" {
		return 30
	}
	n, err := strconv.Atoi(strings.TrimSuffix(v, "d"))
	if err != nil || n <= 0 {
		return 30
	}
	return n
}

// MaxBytesValue parses MaxBytes ("500MB", "2GB", "1048576"), default 500 MB.
func (c JournalConfig) MaxBytesValue() int64 {
	v := strings.TrimSpace(strings.ToUpper(c.MaxBytes))
	if v == "" {
		return 500 << 20
	}
	mult := int64(1)
	switch {
	case strings.HasSuffix(v, "GB"):
		mult, v = 1<<30, strings.TrimSuffix(v, "GB")
	case strings.HasSuffix(v, "MB"):
		mult, v = 1<<20, strings.TrimSuffix(v, "MB")
	case strings.HasSuffix(v, "KB"):
		mult, v = 1<<10, strings.TrimSuffix(v, "KB")
	}
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil || n <= 0 {
		return 500 << 20
	}
	return n * mult
}

// SMTPConfig holds outbound mail relay settings. Empty Host means mail
// sending is disabled — callers must check SMTP.Enabled() before use, since
// no email flow (password reset, invites…) has anything to fall back to.
type SMTPConfig struct {
	Host     string `toml:"host"`
	Port     int    `toml:"port"`
	Username string `toml:"username"`
	Password string `toml:"password"`
	From     string `toml:"from"` // e.g. "Lore Engine <noreply@example.com>"
}

// Enabled reports whether outbound mail is configured.
func (c SMTPConfig) Enabled() bool {
	return strings.TrimSpace(c.Host) != ""
}

// CryptoConfig holds the key stored API keys are encrypted with. Empty means
// "reuse jwt.secret", which is what every existing install did — see
// Config.EncryptionKey.
type CryptoConfig struct {
	Key string `toml:"key"`
}

type AuthConfig struct {
	// Registration is "open" (anyone may create an account) or "closed"
	// (only the bootstrap user and accounts an administrator promotes).
	// Defaults to open: there is no admin-side user creation screen yet, so
	// closing it by default would leave an operator no way to add players.
	Registration string `toml:"registration"`
}

// RegistrationOpen reports whether self-service signup is allowed.
func (c *Config) RegistrationOpen() bool {
	return !strings.EqualFold(strings.TrimSpace(c.Auth.Registration), "closed")
}

type ExternalMaterialConfig struct {
	Dir string `toml:"dir"`
}

type MistralConfig struct {
	APIKey     string `toml:"api_key"`
	ImageCount int    `toml:"image_count"`
}

type LLMConfig struct {
	BaseURL   string `toml:"base_url"`
	APIKey    string `toml:"api_key"`
	Model     string `toml:"model"`
	MaxTokens int    `toml:"max_tokens"`
}

type ServerConfig struct {
	Host          string `toml:"host"`
	Port          int    `toml:"port"`
	SecureCookies bool   `toml:"secure_cookies"`
}

type DatabaseConfig struct {
	Path string `toml:"path"`
}

type UploadsConfig struct {
	Dir string `toml:"dir"`
}

type JWTConfig struct {
	Secret        string `toml:"secret"`
	AccessExpiry  string `toml:"access_expiry"`  // e.g., "24h"
	RefreshExpiry string `toml:"refresh_expiry"` // e.g., "168h" (7 days)
	SigningMethod string `toml:"signing_method"` // e.g., "HS256"
}

type CORSConfig struct {
	Origins     []string `toml:"origins"`
	Credentials bool     `toml:"credentials"`
}

type BootstrapConfig struct {
	User string `toml:"user"` // "email:password:role"
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		Server:           ServerConfig{Host: "localhost", Port: 8080},
		Database:         DatabaseConfig{Path: "lore.db"},
		Uploads:          UploadsConfig{Dir: "./data/uploads"},
		ExternalMaterial: ExternalMaterialConfig{Dir: "./external-material"},
		Mistral:          MistralConfig{ImageCount: 3},
		JWT: JWTConfig{
			AccessExpiry:  "24h",
			RefreshExpiry: "168h", // 7 days
			SigningMethod: "HS256",
		},
		CORS: CORSConfig{
			Origins:     []string{"http://localhost:5173"},
			Credentials: true,
		},
		Auth: AuthConfig{Registration: "open"},
		SMTP: SMTPConfig{Port: 587},
	}

	if _, err := os.Stat(path); err == nil {
		if _, err := toml.DecodeFile(path, cfg); err != nil {
			return nil, fmt.Errorf("config file: %w", err)
		}
	}

	if v := os.Getenv("LORE_HOST"); v != "" {
		cfg.Server.Host = v
	}
	if v := os.Getenv("LORE_PORT"); v != "" {
		port, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("LORE_PORT must be a number: %w", err)
		}
		cfg.Server.Port = port
	}
	if v := os.Getenv("LORE_DB_PATH"); v != "" {
		cfg.Database.Path = v
	}

	// JWT config from env
	if v := os.Getenv("LORE_JWT_SECRET"); v != "" {
		cfg.JWT.Secret = v
	}
	if v := os.Getenv("LORE_JWT_ACCESS_EXPIRY"); v != "" {
		cfg.JWT.AccessExpiry = v
	}
	if v := os.Getenv("LORE_JWT_REFRESH_EXPIRY"); v != "" {
		cfg.JWT.RefreshExpiry = v
	}

	// CORS origins from env (comma-separated, overrides config)
	if v := os.Getenv("LORE_CORS_ORIGINS"); v != "" {
		cfg.CORS.Origins = strings.Split(v, ",")
		fmt.Println("WARNING: CORS origins set via LORE_CORS_ORIGINS environment variable. For production, consider using the config file.")
	}

	// Bootstrap user from env
	if v := os.Getenv("LORE_BOOTSTRAP_USER"); v != "" {
		cfg.Bootstrap.User = v
	}
	if v := os.Getenv("LORE_CRYPTO_KEY"); v != "" {
		cfg.Crypto.Key = v
	}
	if v := os.Getenv("LORE_REGISTRATION"); v != "" {
		cfg.Auth.Registration = v
	}

	return cfg, nil
}
