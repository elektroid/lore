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

// requireCampaignAccess guards routes that use {id} as the campaign ID param,
// allowing the owner *or* any delegated account (campaign_members) through.
// Access is the delegation of gamemaster rights, not just a roster: a member
// admitted here can create and run their own groups (runs/sessions) for this
// campaign, and read what running one requires. Authoring the campaign itself
// — its metadata, entities, scenario content — stays owner-only and uses
// requireCampaignOwner instead. See the four-modes design notes.
func requireCampaignAccess(database *sql.DB) func(http.Handler) http.Handler {
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
			if campaign.OwnerID == user.ID {
				next.ServeHTTP(w, r)
				return
			}
			isMember, err := db.IsCampaignMember(r.Context(), database, campaignID, user.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "vérification d'accès impossible")
				return
			}
			if !isMember {
				writeError(w, http.StatusForbidden, "campaign access required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireCampaignAccessByParam is requireCampaignAccess for routes that use a
// named param other than {id} for the campaign ID.
func requireCampaignAccessByParam(database *sql.DB, paramName string) func(http.Handler) http.Handler {
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
			if campaign.OwnerID == user.ID {
				next.ServeHTTP(w, r)
				return
			}
			isMember, err := db.IsCampaignMember(r.Context(), database, campaignID, user.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "vérification d'accès impossible")
				return
			}
			if !isMember {
				writeError(w, http.StatusForbidden, "campaign access required")
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

// requireSuperuser guards global configuration — the LLM endpoint and API key
// every campaign in the instance runs through, and the shared game catalogue.
//
// Without it any registered player could repoint base_url at a host they
// control and quietly receive every prompt the instance sends, authored
// scenario material included, while spending the owner's API key.
func requireSuperuser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := auth.GetUserFromContext(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		if user.Role != "superuser" {
			writeError(w, http.StatusForbidden, "réservé aux administrateurs")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireChild guards a nested route group: the {childParam} row must belong to
// the {parentParam} the caller was already authorised for.
//
// Without it, the parent guard is the only check, and it only ever asks "do you
// own THIS campaign/scenario?" — so a caller could pass their own parent id
// together with someone else's child id and reach across tenants, because every
// nested handler looks the child up by id alone.
//
// Deliberately no superuser bypass: this is not a permission, it is a structural
// invariant. A scene from another scenario has no business being addressed
// through this URL whoever is asking. Answers 404 rather than 403, so a probe
// cannot use it to confirm that an id exists somewhere else.
func requireChild(database *sql.DB, parentParam, childParam, table, parentCol string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			parentID := chi.URLParam(r, parentParam)
			childID := chi.URLParam(r, childParam)
			ok, err := db.ChildBelongsTo(r.Context(), database, table, parentCol, childID, parentID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "vérification d'accès impossible")
				return
			}
			if !ok {
				writeError(w, http.StatusNotFound, "ressource introuvable")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireDraftOwner guards routes that use {draftId} as the scenario-draft ID
// param. It resolves the draft to its campaign and applies the same ownership
// rule as everything else. See docs/scenario-factory.md.
func requireDraftOwner(database *sql.DB) func(http.Handler) http.Handler {
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
			draft, err := db.GetScenarioDraft(r.Context(), database, chi.URLParam(r, "draftId"))
			if err != nil || draft == nil {
				writeError(w, http.StatusNotFound, "draft not found")
				return
			}
			campaign, err := db.GetCampaign(r.Context(), database, draft.CampaignID)
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

// requireScenarioAccess is requireCampaignAccess for routes that use {id} as
// the scenario ID param: it resolves the scenario to its campaign, then
// admits the owner or a delegated member. Running a session — sessions,
// beats, the table — needs this; editing the scenario or its synopsis stays
// behind requireScenarioOwner instead, applied per-verb where that route also
// needs to reject a delegated (non-owner) member.
func requireScenarioAccess(database *sql.DB) func(http.Handler) http.Handler {
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
			if campaign.OwnerID == user.ID {
				next.ServeHTTP(w, r)
				return
			}
			isMember, err := db.IsCampaignMember(r.Context(), database, campaign.ID, user.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "vérification d'accès impossible")
				return
			}
			if !isMember {
				writeError(w, http.StatusForbidden, "campaign access required")
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
