package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

// Secrets that have appeared in this repository's own config files and source.
// Anyone can read them, so an instance still using one has no authentication:
// a forged superuser token is a copy-paste away, and — because the same secret
// derives the API-key encryption key — the stored LLM keys are readable too.
var knownWeakSecrets = map[string]bool{
	"":                        true,
	"change-me-in-production": true,
	"default-dev-secret-change-in-production": true,
	"changeme":    true,
	"secret":      true,
	"test-secret": true,
}

// IsWeakSecret reports whether s is a published default or too short to matter.
func IsWeakSecret(s string) bool {
	return knownWeakSecrets[strings.TrimSpace(s)] || len(strings.TrimSpace(s)) < 16
}

// LocalOnly reports whether the server is bound to the loopback interface,
// i.e. reachable only from this machine.
func (c *Config) LocalOnly() bool {
	switch strings.ToLower(strings.TrimSpace(c.Server.Host)) {
	case "localhost", "127.0.0.1", "::1", "":
		return true
	}
	return false
}

// EncryptionKey is the key stored API keys are encrypted with.
//
// It falls back to the JWT secret, which is what every existing installation
// used, so nothing already encrypted becomes unreadable. Setting [crypto].key
// separately is the way out of the trap that fallback creates: rotating the JWT
// secret — exactly what the config file tells you to do in production —
// otherwise silently makes every stored LLM key undecryptable.
func (c *Config) EncryptionKey() string {
	if k := strings.TrimSpace(c.Crypto.Key); k != "" {
		return k
	}
	return c.JWT.Secret
}

// Validate refuses to start an instance that is both reachable and insecure.
//
// The rule is exposure, not environment: a weak secret on a loopback-only dev
// server is a warning, the same secret on an interface someone else can reach
// is fatal. That keeps `make dev` working with the example config while making
// the dangerous deployment impossible rather than merely discouraged.
//
// Returns the fatal error, plus warnings the caller should print.
func (c *Config) Validate() (warnings []string, err error) {
	weakJWT := IsWeakSecret(c.JWT.Secret)
	weakEnc := IsWeakSecret(c.EncryptionKey())

	if c.LocalOnly() {
		if weakJWT {
			warnings = append(warnings,
				"jwt.secret is a default or too short — fine on localhost, refused when bound to a network interface. "+
					"Generate one with: openssl rand -hex 32")
		}
		if c.Crypto.Key == "" && !weakJWT {
			warnings = append(warnings,
				"crypto.key is unset, so stored API keys are encrypted with jwt.secret — "+
					"rotating that secret will make them unreadable. Set [crypto].key to decouple them.")
		}
		return warnings, nil
	}

	if weakJWT {
		return warnings, fmt.Errorf(
			"jwt.secret is a published default or shorter than 16 characters, and the server is bound to %s "+
				"where others can reach it.\n\nAnyone could forge an administrator session.\n\n"+
				"Set a real secret in your config:\n\n  [jwt]\n  secret = \"%s\"\n",
			c.Server.Host, mustRandomHex(32))
	}
	if weakEnc {
		return warnings, fmt.Errorf(
			"crypto.key is set but is a published default or shorter than 16 characters.\n\n"+
				"Set a real one:\n\n  [crypto]\n  key = \"%s\"\n", mustRandomHex(32))
	}
	if !c.Server.SecureCookies {
		warnings = append(warnings,
			"server.secure_cookies is false while listening on a network interface — "+
				"set it to true when serving over HTTPS, or session cookies travel in clear.")
	}
	if c.Crypto.Key == "" {
		warnings = append(warnings,
			"crypto.key is unset, so stored API keys are encrypted with jwt.secret — "+
				"rotating that secret will make them unreadable. Set [crypto].key to decouple them.")
	}
	return warnings, nil
}

func mustRandomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "<run: openssl rand -hex 32>"
	}
	return hex.EncodeToString(b)
}
