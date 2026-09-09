package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"lore/internal/auth"
	"lore/internal/config"
	db "lore/internal/db"
)

// The write journal — see docs/adr/0002-write-journal-for-recovery.md.
//
// One middleware over the whole API rather than a call in each handler: an
// audit trail with per-handler opt-in is an audit trail with holes in it, and
// the holes are always in the handler nobody thought was interesting.

// A body larger than this is journalled with its payload elided. Prose fields
// are kilobytes; anything at this size is a base64 image or an import blob,
// and keeping it would trade the whole retention budget for one row.
const maxJournalledBody = 256 * 1024

// Fields never written to the journal, matched case-insensitively against the
// whole key. The journal is superuser-readable and long-lived; a credential
// that lands in it outlives every rotation.
var redactedFields = []string{"password", "new_password", "old_password", "api_key", "secret", "token", "key"}

// Paths whose bodies are all credential and no content. Prefix-matched against
// the path after /api.
var unjournalledPaths = []string{
	"/auth/", "/settings/llm", "/settings/image", "/settings/password-reset", "/me/password",
}

// snapshotter reads the current state of one entity as JSON, for the `before`
// column. Registered per entity type; an entity without one is still
// journalled, just without a before-image — a partial record beats none.
type snapshotter func(ctx context.Context, database *sql.DB, id string) (string, error)

func marshalOr(v any, err error) (string, error) {
	if err != nil || v == nil {
		return "", err
	}
	b, err := json.Marshal(v)
	return string(b), err
}

// journalTargets maps a request path to the record it writes to.
//
// Matched on path *shape* rather than on chi's route pattern: a middleware
// registered with r.Use() runs before chi has routed, so RoutePattern() is
// still empty there. Segment matching needs no cooperation from the router and
// no cooperation from the handlers.
//
// Only entities whose loss would actually hurt are listed — authored prose and
// the records that hold it. Anything not listed is still journalled (method,
// path, payload, author), just without a before-image: a partial record beats
// no record, and a missing entry here is a gap nobody would notice.
type journalTarget struct {
	// segments is the path split on "/", with "*" matching any single segment.
	segments []string
	entity   string
	// idIndex is the segment holding the id of the record being written.
	idIndex  int
	snapshot snapshotter
}

func snap[T any](get func(context.Context, *sql.DB, string) (*T, error)) snapshotter {
	return func(ctx context.Context, d *sql.DB, id string) (string, error) {
		return marshalOr(get(ctx, d, id))
	}
}

var journalTargets = []journalTarget{
	{[]string{"api", "scenarios", "*", "synopsis", "scenes", "*"}, "scene", 5, snap(db.GetScene)},
	{[]string{"api", "scenarios", "*", "synopsis"}, "synopsis", 2, snap(db.GetSynopsisByScenario)},
	{[]string{"api", "scenarios", "*"}, "scenario", 2, snap(db.GetScenario)},
	{[]string{"api", "campaigns", "*", "npcs", "*"}, "npc", 4, snap(db.GetCampaignNPC)},
	{[]string{"api", "campaigns", "*", "locations", "*"}, "location", 4, snap(db.GetCampaignLocation)},
	{[]string{"api", "campaigns", "*", "artefacts", "*"}, "artefact", 4, snap(db.GetCampaignArtefact)},
	{[]string{"api", "campaigns", "*", "factions", "*"}, "faction", 4, snap(db.GetCampaignFaction)},
	{[]string{"api", "campaigns", "*"}, "campaign", 2, snap(db.GetCampaign)},
}

// matchJournalTarget returns the entity a path writes to, if it is one we keep
// a before-image for.
func matchJournalTarget(path string) (journalTarget, string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for _, t := range journalTargets {
		if len(parts) != len(t.segments) {
			continue
		}
		ok := true
		for i, seg := range t.segments {
			if seg != "*" && seg != parts[i] {
				ok = false
				break
			}
		}
		if ok {
			return t, parts[t.idIndex], true
		}
	}
	return journalTarget{}, "", false
}

// journalledResponse captures the status code without buffering the body.
type journalledResponse struct {
	http.ResponseWriter
	status int
}

func (w *journalledResponse) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *journalledResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// JournalMiddleware records every mutating request that the API accepts.
func JournalMiddleware(database *sql.DB, cfg config.JournalConfig) func(http.Handler) http.Handler {
	// A buffered channel drained by one goroutine: the author must never wait
	// on the journal, and a full buffer drops journal rows, never requests.
	queue := make(chan db.JournalEntry, 256)
	go func() {
		// The author's email is denormalised onto the row so the record
		// survives the account being deleted — resolved here, off the request
		// path, and cached because one author writes many rows.
		emails := map[string]string{}
		for e := range queue {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if e.UserID != "" {
				email, known := emails[e.UserID]
				if !known {
					_ = database.QueryRowContext(ctx, `SELECT email FROM users WHERE id = ?`, e.UserID).Scan(&email)
					emails[e.UserID] = email
				}
				e.UserEmail = email
			}
			db.WriteJournalEntry(ctx, database, e)
			cancel()
		}
	}()
	go pruneLoop(database, cfg)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !cfg.On() || !journalledRequest(r) {
				next.ServeHTTP(w, r)
				return
			}

			// Read the body so it can be journalled, then put it back — the
			// handler must see exactly what the client sent, byte for byte.
			//
			// Only JSON bodies. A multipart upload is a 400 MB image whose
			// bytes mean nothing in a diff, and buffering it here would put the
			// journal in the middle of every file upload for no benefit; those
			// requests are still journalled, just without a payload.
			var payload string
			if r.Body != nil && isJSONRequest(r) {
				body, err := io.ReadAll(io.LimitReader(r.Body, maxJournalledBody+1))
				original := r.Body
				if err != nil {
					// Put back what was read plus whatever is left, and journal
					// nothing. A journal that mangles a request body would be
					// worse than no journal at all.
					r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), original))
				} else if len(body) > maxJournalledBody {
					payload = `{"_elided":"corps de plus de ` + strconv.Itoa(maxJournalledBody) + ` octets"}`
					// The handler still needs the whole thing; it is only the
					// journal that declines to keep it.
					r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), original))
				} else {
					_ = original.Close()
					payload = redactJSON(body)
					r.Body = io.NopCloser(bytes.NewReader(body))
				}
			}

			// The before-image has to be read now — once the handler runs, the
			// old value is gone. This is the column that makes a lost edit
			// recoverable instead of merely explicable.
			target, entityID, matched := matchJournalTarget(r.URL.Path)
			before := ""
			if matched && entityID != "" && target.snapshot != nil {
				// A snapshot that fails costs a before-image, never the write.
				if b, err := target.snapshot(r.Context(), database, entityID); err == nil {
					before = b
				}
			}

			rec := &journalledResponse{ResponseWriter: w}
			next.ServeHTTP(rec, r)

			if rec.status >= 400 {
				// A rejected write changed nothing; keeping it would bury the
				// writes that did in noise.
				return
			}

			entry := db.JournalEntry{
				At:     time.Now().UTC().Format("2006-01-02 15:04:05.000"),
				Method: r.Method, Path: r.URL.Path, Payload: payload, Status: rec.status,
				Entity: target.entity, EntityID: entityID, Before: before,
			}
			if u, ok := auth.GetUserFromContext(r); ok {
				entry.UserID = u.ID
			}

			select {
			case queue <- entry:
			default:
				// Dropping a journal row is the correct failure: the alternative
				// is blocking the author behind a saturated disk.
			}
		})
	}
}

// isJSONRequest reports whether the body is worth keeping — see the note at
// the read site. A missing Content-Type is treated as JSON, which is what every
// client in this app sends.
func isJSONRequest(r *http.Request) bool {
	ct := r.Header.Get("Content-Type")
	return ct == "" || strings.HasPrefix(strings.ToLower(ct), "application/json")
}

func journalledRequest(r *http.Request) bool {
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		return false
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		return false
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api")
	for _, p := range unjournalledPaths {
		if strings.HasPrefix(rest, p) {
			return false
		}
	}
	return true
}

// redactJSON blanks credential-shaped fields anywhere in the body, at any
// depth. A body that is not JSON is dropped rather than stored raw — it is
// either a form upload or something unparsed, and neither is worth the risk.
func redactJSON(body []byte) string {
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		return ""
	}
	out, err := json.Marshal(redactValue(v))
	if err != nil {
		return ""
	}
	return string(out)
}

func redactValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for k, inner := range t {
			if isRedacted(k) {
				t[k] = "•redacted•"
				continue
			}
			t[k] = redactValue(inner)
		}
		return t
	case []any:
		for i, inner := range t {
			t[i] = redactValue(inner)
		}
		return t
	}
	return v
}

func isRedacted(key string) bool {
	k := strings.ToLower(key)
	for _, f := range redactedFields {
		if k == f {
			return true
		}
	}
	return false
}

func pruneLoop(database *sql.DB, cfg config.JournalConfig) {
	prune := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := db.PruneJournal(ctx, database, cfg.RetainDays(), cfg.MaxBytesValue()); err != nil {
			return
		}
	}
	if cfg.On() {
		prune()
	}
	for range time.Tick(time.Hour) {
		if cfg.On() {
			prune()
		}
	}
}

// ── Read API (superuser only) ────────────────────────────────────────────────

type JournalHandler struct {
	db *sql.DB
}

func (h *JournalHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	entries, total, err := db.ListJournalEntries(r.Context(), h.db, db.JournalFilter{
		Entity:   q.Get("entity"),
		EntityID: q.Get("entity_id"),
		UserID:   q.Get("user_id"),
		Since:    q.Get("since"),
		Limit:    limit,
		Offset:   offset,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	stats, _ := db.GetJournalStats(r.Context(), h.db)
	writeJSON(w, http.StatusOK, map[string]any{
		"entries": entries, "total": total, "stats": stats,
	})
}

// Restore writes a journal row's before-image back, through the same update
// path a normal edit takes.
//
// It is a write like any other, so it is journalled like any other: restoring
// the wrong version is undone by restoring the right one. There is deliberately
// no inverse-operation machinery here and no redo stack — this is "put that
// value back", and nothing cleverer. See the ADR's "What this is not".
func (h *JournalHandler) Restore(w http.ResponseWriter, r *http.Request) {
	entry, err := db.GetJournalEntry(r.Context(), h.db, chi.URLParam(r, "entryId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entry == nil {
		writeError(w, http.StatusNotFound, "entrée de journal introuvable")
		return
	}
	if entry.Before == "" {
		writeError(w, http.StatusBadRequest,
			"cette entrée n'a pas d'état antérieur — rien à restaurer")
		return
	}

	restored, err := restoreEntity(r.Context(), h.db, entry.Entity, entry.EntityID, entry.Before)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if restored == nil {
		writeError(w, http.StatusBadRequest,
			"restauration non prise en charge pour : "+entry.Entity)
		return
	}
	writeJSON(w, http.StatusOK, restored)
}

func restoreEntity(ctx context.Context, database *sql.DB, entity, id, before string) (any, error) {
	switch entity {
	case "scene":
		var v db.Scene
		if err := json.Unmarshal([]byte(before), &v); err != nil {
			return nil, err
		}
		return db.UpdateScene(ctx, database, id, db.UpdateSceneParams{
			Title: v.Title, Status: v.Status, Description: v.Description,
			Outcome: v.Outcome, Notes: v.Notes, LocationID: v.LocationID,
			IsStart: v.IsStart, IsEnd: v.IsEnd,
			PlaylistType: v.PlaylistType, PlaylistValue: v.PlaylistValue,
		})

	case "synopsis":
		var v db.Synopsis
		if err := json.Unmarshal([]byte(before), &v); err != nil {
			return nil, err
		}
		// id here is the scenario id — see journalTargets.
		return db.UpdateSynopsisHook(ctx, database, id, v.Hook)

	case "npc":
		var v db.CampaignNPC
		if err := json.Unmarshal([]byte(before), &v); err != nil {
			return nil, err
		}
		return db.UpdateCampaignNPC(ctx, database, id, v.Name, v.Role, v.Description, v.Quote, v.Motivation, v.Sheet)

	case "location":
		var v db.CampaignLocation
		if err := json.Unmarshal([]byte(before), &v); err != nil {
			return nil, err
		}
		return db.UpdateCampaignLocation(ctx, database, id, v.Name, v.City, v.District, v.Description, v.Atmosphere, v.Images)

	case "artefact":
		var v db.CampaignArtefact
		if err := json.Unmarshal([]byte(before), &v); err != nil {
			return nil, err
		}
		return db.UpdateCampaignArtefact(ctx, database, id, v.Name, v.Description, v.Images)

	case "faction":
		var v db.CampaignFaction
		if err := json.Unmarshal([]byte(before), &v); err != nil {
			return nil, err
		}
		return db.UpdateCampaignFaction(ctx, database, id, v.Name, v.Type, v.Description, v.Motivation, v.Images)
	}
	return nil, nil
}
