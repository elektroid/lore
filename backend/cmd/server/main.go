package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"lore/internal/auth"
	"lore/internal/config"
	"lore/internal/db"
	"lore/internal/handlers"
)

func mustMkdir(path string) {
	if err := os.MkdirAll(path, 0755); err != nil {
		log.Fatalf("mkdir %s: %v", path, err)
	}
}

func main() {
	cfgPath := "lore.toml"
	if len(os.Args) > 1 {
		cfgPath = os.Args[1]
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	database, err := db.Open(cfg.Database.Path)
	if err != nil {
		log.Fatalf("db open: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("db migrate: %v", err)
	}
	db.MigrateAlters(database)

	mustMkdir(cfg.Uploads.Dir)

	if err := db.MigrateGameText(context.Background(), database); err != nil {
		log.Printf("game text migration: %v", err)
	}

	// Seed LLM config from file if the DB setting is absent or empty
	if cfg.LLM.BaseURL != "" {
		existing, _ := db.GetSetting(context.Background(), database, "llm_config")
		if existing == "" || existing == "{}" {
			if b, err := json.Marshal(cfg.LLM); err == nil {
				db.SetSetting(context.Background(), database, "llm_config", string(b)) //nolint:errcheck
			}
		}
	}

	// Seed Mistral config from file if the DB setting is absent or empty
	if cfg.Mistral.APIKey != "" {
		existing, _ := db.GetSetting(context.Background(), database, "mistral_config")
		if existing == "" {
			if b, err := json.Marshal(cfg.Mistral); err == nil {
				db.SetSetting(context.Background(), database, "mistral_config", string(b)) //nolint:errcheck
			}
		}
	}

	// Create token service for JWT
	tokenService, err := auth.ConfigToTokenService(cfg)
	if err != nil {
		log.Fatalf("jwt config: %v", err)
	}

	// Handle bootstrap user creation
	if cfg.Bootstrap.User != "" {
		// Check if any users exist
		users, err := db.ListUsers(context.Background(), database)
		if err != nil {
			log.Printf("bootstrap check: %v", err)
		} else if len(users) == 0 {
			// Parse bootstrap config: "email:password:role"
			parts := strings.Split(cfg.Bootstrap.User, ":")
			if len(parts) >= 3 {
				email, password, role := parts[0], parts[1], parts[2]
				_, err := db.CreateUser(context.Background(), database, db.CreateUserParams{
					Email:    email,
					Password: password,
					Name:     "Admin",
					Role:     role,
				})
				if err != nil {
					log.Printf("bootstrap user creation: %v", err)
				} else {
					log.Printf("bootstrap: created user %s with role %s", email, role)
				}
			}
		}
	}

	router := handlers.NewRouter(database, cfg.Uploads.Dir, cfg.ExternalMaterial.Dir, tokenService, cfg)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	fmt.Printf("Lore Engine → http://%s\n", addr)
	log.Fatal(http.ListenAndServe(addr, router))
}
