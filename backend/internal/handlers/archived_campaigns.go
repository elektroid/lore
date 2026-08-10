package handlers

import (
	"database/sql"
	"fmt"
	"net/http"

	"lore/internal/auth"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
)

type ArchivedCampaignHandler struct {
	db *sql.DB
}

// List returns archives owned by the requester, or every archive for a
// superuser — same access shape as CampaignHandler.List.
func (h *ArchivedCampaignHandler) List(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	list, err := db.ListArchivedCampaigns(r.Context(), h.db, user.ID, user.Role == "superuser")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// Export streams the stored snapshot JSON as a download, gated to the
// archive's owner or a superuser.
func (h *ArchivedCampaignHandler) Export(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, ok := auth.GetUserFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	archived, data, err := db.GetArchivedCampaign(r.Context(), h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if archived == nil {
		writeError(w, http.StatusNotFound, "archived campaign not found")
		return
	}
	if user.Role != "superuser" && archived.OwnerID != user.ID {
		writeError(w, http.StatusForbidden, "campaign owner access required")
		return
	}

	filename := fmt.Sprintf("lore-%s-archive.json", safeFilename(archived.Name))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	// data is already-valid JSON text from the database (built by
	// json.Marshal in SnapshotCampaign), so it's written as-is rather than
	// decoded and re-encoded through json.NewEncoder.
	w.Write([]byte(data))
}
