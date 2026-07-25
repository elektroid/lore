.PHONY: dev dev-backend dev-frontend build generate install-tools check-config

BINARY = lore-engine
AIR    = $(shell go env GOPATH)/bin/air

check-config:
	@test -f lore.toml || { \
		echo "✗ lore.toml introuvable — copiez l'exemple : cp lore.toml.example lore.toml"; \
		exit 1; \
	}

dev: check-config
	@trap 'kill 0' EXIT; \
	(cd backend && $(AIR)) & \
	cd frontend && npm run dev

dev-backend: check-config
	cd backend && $(AIR)

dev-frontend:
	cd frontend && npm run dev

build:
	@echo "→ build frontend"
	cd frontend && npm run build
	@echo "→ build backend"
	cd backend && go build -o ../$(BINARY) ./cmd/server

generate:
	cd backend && sqlc generate

install-tools:
	go install github.com/air-verse/air@latest
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
	cd frontend && npm install
