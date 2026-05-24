package handlers

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"

	"lore/internal/auth"
	db "lore/internal/db"
)

// requireCampaignOwner guards routes that use {id} as the campaign ID param.
func requireCampaignOwner(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := auth.GetUserFromContext(r)
			if !ok {
				writeError(w, http.StatusUnauthorized, "authentication required")
				return
			}
			if user.Role == "superuser" {
				next.ServeHTTP(w, r)
				return
			}
			campaignID := chi.URLParam(r, "id")
			campaign, err := db.GetCampaign(r.Context(), database, campaignID)
			if err != nil || campaign == nil {
				writeError(w, http.StatusNotFound, "campaign not found")
				return
			}
			if campaign.OwnerID != user.ID {
				writeError(w, http.StatusForbidden, "campaign owner access required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireCampaignOwnerByParam guards routes that use a named param other than {id} for the campaign ID.
func requireCampaignOwnerByParam(database *sql.DB, paramName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := auth.GetUserFromContext(r)
			if !ok {
				writeError(w, http.StatusUnauthorized, "authentication required")
				return
			}
			if user.Role == "superuser" {
				next.ServeHTTP(w, r)
				return
			}
			campaignID := chi.URLParam(r, paramName)
			campaign, err := db.GetCampaign(r.Context(), database, campaignID)
			if err != nil || campaign == nil {
				writeError(w, http.StatusNotFound, "campaign not found")
				return
			}
			if campaign.OwnerID != user.ID {
				writeError(w, http.StatusForbidden, "campaign owner access required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireScenarioOwner guards routes that use {id} as the scenario ID param.
// It resolves the scenario to its campaign and checks ownership.
func requireScenarioOwner(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := auth.GetUserFromContext(r)
			if !ok {
				writeError(w, http.StatusUnauthorized, "authentication required")
				return
			}
			if user.Role == "superuser" {
				next.ServeHTTP(w, r)
				return
			}
			scenarioID := chi.URLParam(r, "id")
			scenario, err := db.GetScenario(r.Context(), database, scenarioID)
			if err != nil || scenario == nil {
				writeError(w, http.StatusNotFound, "scenario not found")
				return
			}
			campaign, err := db.GetCampaign(r.Context(), database, scenario.CampaignID)
			if err != nil || campaign == nil {
				writeError(w, http.StatusNotFound, "campaign not found")
				return
			}
			if campaign.OwnerID != user.ID {
				writeError(w, http.StatusForbidden, "campaign owner access required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
