.PHONY: dev dev-backend dev-frontend build clean-embed generate install-tools check-config

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
	@echo "→ embed frontend"
	rm -rf backend/internal/web/dist
	mkdir -p backend/internal/web/dist
	cp -r frontend/dist/. backend/internal/web/dist/
	@echo "→ build backend"
	cd backend && go build -o ../$(BINARY) ./cmd/server
	@echo "✓ $(BINARY) — binaire autonome, frontend inclus"

# Restores the placeholder-only dist so `go build` in the backend keeps working
# without a frontend build. `make build` overwrites it again.
clean-embed:
	rm -rf backend/internal/web/dist
	mkdir -p backend/internal/web/dist
	printf 'The production frontend is copied here by `make build` and embedded\ninto the binary. Only this placeholder is tracked — see .gitignore.\n' \
		> backend/internal/web/dist/.gitkeep

generate:
	cd backend && sqlc generate

install-tools:
	go install github.com/air-verse/air@latest
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
	cd frontend && npm install
