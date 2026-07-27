package config

import (
	"strings"
	"testing"
)

func cfg(host, jwtSecret, cryptoKey string) *Config {
	c := &Config{}
	c.Server.Host = host
	c.JWT.Secret = jwtSecret
	c.Crypto.Key = cryptoKey
	return c
}

const strongA = "0e5f1c3a9b7d2e4f6a8c0b1d3e5f7a9c2b4d6e8f0a1c3e5b7d9f2a4c6e8b0d1f"
const strongB = "9f2a4c6e8b0d1f3a5c7e9b0d2f4a6c8e0b1d3f5a7c9e2b4d6f8a0c1e3b5d7f9a"

func TestWeakSecretsAreRecognised(t *testing.T) {
	// Every one of these has appeared in this repository. An instance still
	// using one has no authentication at all.
	for _, s := range []string{
		"", "   ", "change-me-in-production",
		"default-dev-secret-change-in-production", "changeme", "secret", "short",
	} {
		if !IsWeakSecret(s) {
			t.Errorf("IsWeakSecret(%q) = false, want true", s)
		}
	}
	if IsWeakSecret(strongA) {
		t.Error("a 64-char random hex secret must not be considered weak")
	}
}

func TestWeakSecretIsFatalOnlyWhenReachable(t *testing.T) {
	// The rule is exposure, not environment — `make dev` must keep working
	// with the example config.
	for _, host := range []string{"localhost", "127.0.0.1", "::1", ""} {
		warnings, err := cfg(host, "change-me-in-production", "").Validate()
		if err != nil {
			t.Errorf("host %q: weak secret on loopback should warn, not refuse: %v", host, err)
		}
		if len(warnings) == 0 {
			t.Errorf("host %q: weak secret on loopback should still warn", host)
		}
	}

	for _, host := range []string{"0.0.0.0", "192.168.1.10", "lore.example.com"} {
		if _, err := cfg(host, "change-me-in-production", "").Validate(); err == nil {
			t.Errorf("host %q: weak secret on a reachable interface must refuse to start", host)
		}
	}
}

func TestStrongSecretStartsAnywhere(t *testing.T) {
	if _, err := cfg("0.0.0.0", strongA, strongB).Validate(); err != nil {
		t.Errorf("a properly configured instance must start: %v", err)
	}
}

func TestEncryptionKeyFallsBackToJWTSecret(t *testing.T) {
	// Existing installs encrypted their API keys with the JWT secret; nothing
	// already stored may become unreadable.
	if got := cfg("localhost", strongA, "").EncryptionKey(); got != strongA {
		t.Errorf("EncryptionKey with no crypto.key = %q, want the JWT secret", got)
	}
	if got := cfg("localhost", strongA, strongB).EncryptionKey(); got != strongB {
		t.Errorf("EncryptionKey with crypto.key set = %q, want the crypto key", got)
	}
}

func TestRotationTrapIsWarnedAbout(t *testing.T) {
	// Changing jwt.secret is exactly what the config file tells you to do, and
	// with no separate crypto.key it silently orphans every stored API key.
	warnings, err := cfg("localhost", strongA, "").Validate()
	if err != nil {
		t.Fatal(err)
	}
	if !mentions(warnings, "crypto.key") {
		t.Errorf("expected a warning about the shared key, got %v", warnings)
	}

	warnings, _ = cfg("localhost", strongA, strongB).Validate()
	if mentions(warnings, "crypto.key") {
		t.Errorf("no warning is due once the keys are decoupled, got %v", warnings)
	}
}

func TestInsecureCookiesWarnWhenExposed(t *testing.T) {
	warnings, err := cfg("0.0.0.0", strongA, strongB).Validate()
	if err != nil {
		t.Fatal(err)
	}
	if !mentions(warnings, "secure_cookies") {
		t.Errorf("expected a warning about cookies over a network interface, got %v", warnings)
	}
}

func TestRegistrationDefaultsToOpen(t *testing.T) {
	// There is no admin-side user-creation screen, so closing signup by default
	// would leave an operator no way to add players.
	if !(&Config{}).RegistrationOpen() {
		t.Error("registration should default to open")
	}
	for _, v := range []string{"open", "OPEN", "", "anything-else"} {
		c := &Config{}
		c.Auth.Registration = v
		if !c.RegistrationOpen() {
			t.Errorf("registration=%q should be open", v)
		}
	}
	for _, v := range []string{"closed", "CLOSED", " closed "} {
		c := &Config{}
		c.Auth.Registration = v
		if c.RegistrationOpen() {
			t.Errorf("registration=%q should be closed", v)
		}
	}
}

func mentions(warnings []string, needle string) bool {
	for _, w := range warnings {
		if strings.Contains(w, needle) {
			return true
		}
	}
	return false
}
