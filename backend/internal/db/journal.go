package db

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
)

// JournalEntry is one accepted mutating request — see write_journal in
// schema.sql and docs/adr/0002-write-journal-for-recovery.md.
type JournalEntry struct {
	ID string `json:"id"`
	// At is when the request finished, to the millisecond. Listings order by
	// rowid, not by this — see the schema.
	At        string `json:"at"`
	UserID    string `json:"user_id"`
	UserEmail string `json:"user_email"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Entity    string `json:"entity"`
	EntityID  string `json:"entity_id"`
	// Before is the record as it stood before this write, as JSON. Empty for a
	// create, or for an entity with no registered snapshotter.
	Before string `json:"before"`
	// Payload is the request body, with credential-shaped fields redacted.
	Payload string `json:"payload"`
	Status  int    `json:"status"`
}

// JournalFilter narrows a listing. Every field is optional.
type JournalFilter struct {
	Entity   string
	EntityID string
	UserID   string
	Since    string // ISO timestamp, inclusive
	Limit    int
	Offset   int
}

// WriteJournalEntry appends one row.
//
// Best-effort and non-fatal, like the audit log: the journal exists to explain
// writes, and it must never be the reason one fails. Callers hand it work on a
// background goroutine and ignore the error; this logs so a broken journal is
// at least visible in the service log.
func WriteJournalEntry(ctx context.Context, database *sql.DB, e JournalEntry) {
	// `at` is the moment the request finished, passed in by the caller — the
	// row itself is inserted later, off the request path, and a debug tool that
	// timestamps writes by when it got round to recording them is lying.
	at := e.At
	if at == "" {
		at = time.Now().UTC().Format("2006-01-02 15:04:05.000")
	}
	_, err := database.ExecContext(ctx,
		`INSERT INTO write_journal
		   (id, at, user_id, user_email, method, path, entity, entity_id, before, payload, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uuid.New().String(), at, e.UserID, e.UserEmail, e.Method, e.Path,
		e.Entity, e.EntityID, e.Before, e.Payload, e.Status)
	if err != nil {
		log.Printf("write journal: insert failed (%s %s): %v", e.Method, e.Path, err)
	}
}

// ListJournalEntries paginates newest-first.
func ListJournalEntries(ctx context.Context, database *sql.DB, f JournalFilter) ([]JournalEntry, int, error) {
	var where []string
	var args []any
	if f.Entity != "" {
		where = append(where, "entity = ?")
		args = append(args, f.Entity)
	}
	if f.EntityID != "" {
		where = append(where, "entity_id = ?")
		args = append(args, f.EntityID)
	}
	if f.UserID != "" {
		where = append(where, "user_id = ?")
		args = append(args, f.UserID)
	}
	if f.Since != "" {
		where = append(where, "at >= ?")
		args = append(args, f.Since)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	if err := database.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM write_journal`+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if f.Limit <= 0 {
		f.Limit = 50
	}
	rows, err := database.QueryContext(ctx,
		`SELECT id, at, user_id, user_email, method, path, entity, entity_id, before, payload, status
		 FROM write_journal`+clause+`
		 ORDER BY rowid DESC
		 LIMIT ? OFFSET ?`,
		append(append([]any{}, args...), f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	entries := []JournalEntry{}
	for rows.Next() {
		var e JournalEntry
		if err := rows.Scan(&e.ID, &e.At, &e.UserID, &e.UserEmail, &e.Method, &e.Path,
			&e.Entity, &e.EntityID, &e.Before, &e.Payload, &e.Status); err != nil {
			return nil, 0, err
		}
		entries = append(entries, e)
	}
	return entries, total, rows.Err()
}

// GetJournalEntry reads one row.
func GetJournalEntry(ctx context.Context, database *sql.DB, id string) (*JournalEntry, error) {
	var e JournalEntry
	err := database.QueryRowContext(ctx,
		`SELECT id, at, user_id, user_email, method, path, entity, entity_id, before, payload, status
		 FROM write_journal WHERE id = ?`, id,
	).Scan(&e.ID, &e.At, &e.UserID, &e.UserEmail, &e.Method, &e.Path,
		&e.Entity, &e.EntityID, &e.Before, &e.Payload, &e.Status)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &e, err
}

// JournalStats reports what the journal currently holds, so the admin screen
// can show the cost of keeping it rather than leaving it to grow unwatched.
type JournalStats struct {
	Entries int    `json:"entries"`
	Bytes   int64  `json:"bytes"`
	Oldest  string `json:"oldest"`
}

func GetJournalStats(ctx context.Context, database *sql.DB) (JournalStats, error) {
	var s JournalStats
	var oldest sql.NullString
	err := database.QueryRowContext(ctx,
		`SELECT COUNT(1),
		        COALESCE(SUM(LENGTH(before) + LENGTH(payload) + LENGTH(path)), 0),
		        MIN(at)
		 FROM write_journal`).Scan(&s.Entries, &s.Bytes, &oldest)
	s.Oldest = oldest.String
	return s, err
}

// PruneJournal enforces the retention window, then the size cap.
//
// Age first, size second: dropping by age is what the operator asked for, and
// the byte cap is only there so a runaway payload cannot fill the disk the
// live database sits on.
func PruneJournal(ctx context.Context, database *sql.DB, retainDays int, maxBytes int64) error {
	if retainDays > 0 {
		if _, err := database.ExecContext(ctx,
			fmt.Sprintf(`DELETE FROM write_journal WHERE at < datetime('now', '-%d days')`, retainDays),
		); err != nil {
			return err
		}
	}
	if maxBytes <= 0 {
		return nil
	}

	stats, err := GetJournalStats(ctx, database)
	if err != nil || stats.Bytes <= maxBytes {
		return err
	}
	// Delete oldest-first until the estimate fits. One pass over ids rather
	// than a row-by-row loop: the journal is append-only, so the ordering is
	// stable while this runs.
	rows, err := database.QueryContext(ctx,
		`SELECT id, LENGTH(before) + LENGTH(payload) + LENGTH(path) FROM write_journal ORDER BY rowid ASC`)
	if err != nil {
		return err
	}
	var doomed []any
	running := stats.Bytes
	for rows.Next() {
		var id string
		var size int64
		if err := rows.Scan(&id, &size); err != nil {
			rows.Close()
			return err
		}
		if running <= maxBytes {
			break
		}
		doomed = append(doomed, id)
		running -= size
	}
	rows.Close()
	if len(doomed) == 0 {
		return nil
	}

	_, err = database.ExecContext(ctx,
		`DELETE FROM write_journal WHERE id IN (?`+strings.Repeat(",?", len(doomed)-1)+`)`, doomed...)
	return err
}
