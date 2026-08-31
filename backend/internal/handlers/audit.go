package handlers

import (
	"database/sql"
	"net/http"
	"strconv"

	db "lore/internal/db"
)

// AuditHandler serves the administrator's audit log — see audit_log in
// schema.sql and docs/users-admin.md.
type AuditHandler struct {
	db *sql.DB
}

type auditPage struct {
	Events   []db.AuditEvent `json:"events"`
	Total    int             `json:"total"`
	Page     int             `json:"page"`
	PageSize int             `json:"page_size"`
}

func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	action := r.URL.Query().Get("action")

	page := 1
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	pageSize := 50
	if v := r.URL.Query().Get("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			pageSize = n
		}
	}

	events, total, err := db.ListAuditEvents(r.Context(), h.db, pageSize, (page-1)*pageSize, action)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, auditPage{Events: events, Total: total, Page: page, PageSize: pageSize})
}
