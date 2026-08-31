package db

import (
	"context"
	"database/sql"
	"log"

	"github.com/google/uuid"
)

// AuditEvent is one row of the administrator's audit log — see audit_log in
// schema.sql. ActorName/ActorEmail are resolved live via a join, not
// snapshotted, so a later profile rename is reflected in old entries too.
type AuditEvent struct {
	ID          string `json:"id"`
	CreatedAt   string `json:"created_at"`
	ActorID     string `json:"actor_id"`
	ActorName   string `json:"actor_name"`
	ActorEmail  string `json:"actor_email"`
	Action      string `json:"action"`
	TargetType  string `json:"target_type"`
	TargetID    string `json:"target_id"`
	TargetLabel string `json:"target_label"`
	IP          string `json:"ip"`
}

// LogAuditEvent records one administrator-visible event. Best-effort and
// non-fatal by design: a write failure here must never take down the action
// it is recording (a login, a role change, ...), so it logs and moves on
// rather than returning an error the caller would have to decide whether to
// act on.
func LogAuditEvent(ctx context.Context, database *sql.DB, actorID, action, targetType, targetID, targetLabel, ip string) {
	_, err := database.ExecContext(ctx,
		`INSERT INTO audit_log (id, actor_id, action, target_type, target_id, target_label, ip)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		uuid.New().String(), actorID, action, targetType, targetID, targetLabel, ip)
	if err != nil {
		log.Printf("audit log write failed (action=%s): %v", action, err)
	}
}

// ListAuditEvents paginates newest-first, optionally filtered to one action.
func ListAuditEvents(ctx context.Context, database *sql.DB, limit, offset int, action string) ([]AuditEvent, int, error) {
	where := ""
	args := []any{}
	if action != "" {
		where = "WHERE a.action = ?"
		args = append(args, action)
	}

	var total int
	if err := database.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM audit_log a `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := `
		SELECT a.id, a.created_at, a.actor_id, COALESCE(u.name, ''), COALESCE(u.email, ''),
		       a.action, a.target_type, a.target_id, a.target_label, a.ip
		FROM audit_log a
		LEFT JOIN users u ON u.id = a.actor_id
		` + where + `
		ORDER BY a.created_at DESC, a.id DESC
		LIMIT ? OFFSET ?`
	rows, err := database.QueryContext(ctx, query, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	events := []AuditEvent{}
	for rows.Next() {
		var e AuditEvent
		if err := rows.Scan(&e.ID, &e.CreatedAt, &e.ActorID, &e.ActorName, &e.ActorEmail,
			&e.Action, &e.TargetType, &e.TargetID, &e.TargetLabel, &e.IP); err != nil {
			return nil, 0, err
		}
		events = append(events, e)
	}
	return events, total, rows.Err()
}
