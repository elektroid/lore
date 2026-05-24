.PHONY: dev dev-backend dev-frontend build generate install-tools

BINARY = lore-engine
AIR    = $(shell go env GOPATH)/bin/air

dev:
	@trap 'kill 0' EXIT; \
	(cd backend && $(AIR)) & \
	cd frontend && npm run dev

dev-backend:
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
