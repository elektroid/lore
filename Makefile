.PHONY: dev dev-backend dev-frontend build clean-embed generate install-tools check-config check install-hooks

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

# ── Checks ────────────────────────────────────────────────────────────────────
#
# Everything a CI service would run, run locally instead. `make install-hooks`
# wires this to a pre-push hook so it happens without having to be remembered.
#
# The LLM end-to-end suites are deliberately NOT here: they need a real API key
# and cost money per run. This is the free, fast, always-safe subset.
check:
	@echo "→ backend : build, vet, test"
	@cd backend && go build ./... && go vet ./... && go test ./...
	@echo "→ frontend : typecheck + build"
	@test -d frontend/node_modules || { echo "✗ frontend/node_modules absent — lancez : cd frontend && npm install"; exit 1; }
	@cd frontend && log=$$(mktemp); \
		if ! npm run build >"$$log" 2>&1; then \
			echo "✗ build frontend échoué :"; cat "$$log"; rm -f "$$log"; exit 1; \
		fi; \
		rm -f "$$log"
	@echo "→ frontend : lint (informatif, ne bloque pas)"
	@cd frontend && log=$$(mktemp); \
		npm run lint >"$$log" 2>&1 || true; \
		grep -E "problems?" "$$log" | tail -1 || echo "  aucun problème"; \
		rm -f "$$log"
	@echo "✓ check OK"

# Installs the tracked hooks in .githooks/. Reversible with:
#   git config --unset core.hooksPath
install-hooks:
	git config core.hooksPath .githooks
	@echo "✓ hooks actifs — 'make check' tournera avant chaque push"
	@echo "  (échappatoire ponctuelle : git push --no-verify)"

generate:
	cd backend && sqlc generate

install-tools:
	go install github.com/air-verse/air@latest
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
	cd frontend && npm install
