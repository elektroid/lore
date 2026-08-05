package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
	"lore/internal/dice"
	"lore/internal/table"
)

// TableHandler serves both halves of the table surface: the GM console's
// projection and dice endpoints (authenticated, campaign owner), and the public
// token-authenticated endpoints used by the projection screen and player seats.
//
// See docs/play-table.md.
type TableHandler struct {
	db     *sql.DB
	hub    *table.Hub
	limits *rateLimiter
}

func NewTableHandler(database *sql.DB, hub *table.Hub) *TableHandler {
	return &TableHandler{db: database, hub: hub, limits: newRateLimiter()}
}

// Field caps. Everything here can be written from a public endpoint or shown
// full-screen, so nothing is unbounded.
const (
	maxActorLen    = 60
	maxLabelLen    = 60
	maxTitleLen    = 200
	maxSubtitleLen = 200
	maxURLLen      = 500
	maxSceneLen    = 2_000_000 // an Excalidraw scene, JSON-serialized
	rollFeedLimit  = 50
	playerRollGap  = 500 * time.Millisecond
)

// ── Snapshot ──────────────────────────────────────────────────────────────────

// tableSnapshot is everything a table screen or player seat is allowed to know.
// It carries no scene, note, or entity data — only what the GM has projected.
type tableSnapshot struct {
	SessionName  string        `json:"session_name"`
	ScenarioName string        `json:"scenario_name"`
	CampaignName string        `json:"campaign_name"`
	Projection   db.Projection `json:"projection"`
	Rolls        []db.Roll     `json:"rolls"`
	Seats        []db.Seat     `json:"seats"`
}

func (h *TableHandler) snapshot(r *http.Request, ts *db.TableSession) (tableSnapshot, error) {
	rolls, err := db.ListRolls(r.Context(), h.db, ts.SessionID, false, rollFeedLimit)
	if err != nil {
		return tableSnapshot{}, err
	}
	seats, err := db.ListSeats(r.Context(), h.db, ts.SessionID)
	if err != nil {
		return tableSnapshot{}, err
	}
	return tableSnapshot{
		SessionName:  ts.SessionName,
		ScenarioName: ts.ScenarioName,
		CampaignName: ts.CampaignName,
		Projection:   db.ParseProjection(ts.Projection),
		Rolls:        rolls,
		Seats:        seats,
	}, nil
}

// resolve maps a share token to its session, or writes a 404. Unknown and
// revoked tokens are indistinguishable by design.
func (h *TableHandler) resolve(w http.ResponseWriter, r *http.Request) *db.TableSession {
	token := chi.URLParam(r, "token")
	ts, err := db.GetSessionByTableToken(r.Context(), h.db, token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if ts == nil {
		writeError(w, http.StatusNotFound, "lien de table invalide ou expiré")
		return nil
	}
	return ts
}

// ── Public endpoints (the token is the credential) ────────────────────────────

// Snapshot serves the initial state of a table screen or player seat.
func (h *TableHandler) Snapshot(w http.ResponseWriter, r *http.Request) {
	ts := h.resolve(w, r)
	if ts == nil {
		return
	}
	snap, err := h.snapshot(r, ts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// Stream is the SSE endpoint every table surface listens on.
func (h *TableHandler) Stream(w http.ResponseWriter, r *http.Request) {
	ts := h.resolve(w, r)
	if ts == nil {
		return
	}

	// Read the snapshot before subscribing so the first frame is never empty.
	// Both DB reads finish here — the connection then holds no db handle, which
	// matters because the pool is capped at one connection.
	snap, err := h.snapshot(r, ts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // don't let a reverse proxy buffer us
	w.WriteHeader(http.StatusOK)

	rc := http.NewResponseController(w)
	send := func(ev table.Event) bool {
		payload, err := json.Marshal(ev.Data)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, payload); err != nil {
			return false
		}
		return rc.Flush() == nil
	}

	if !send(table.Event{Type: table.EventState, Data: snap}) {
		return
	}

	ch := h.hub.Subscribe(ts.SessionID)
	defer h.hub.Unsubscribe(ts.SessionID, ch)

	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case ev, ok := <-ch:
			if !ok || !send(ev) {
				return
			}
		case <-ping.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			if rc.Flush() != nil {
				return
			}
		}
	}
}

// PlayerRoll accepts a roll from a player seat. Player rolls are always public —
// that is the point of rolling here rather than on the table.
func (h *TableHandler) PlayerRoll(w http.ResponseWriter, r *http.Request) {
	ts := h.resolve(w, r)
	if ts == nil {
		return
	}
	if !h.limits.allow(ts.SessionID, playerRollGap) {
		writeError(w, http.StatusTooManyRequests, "trop de jets — attendez un instant")
		return
	}

	var body struct {
		Actor    string `json:"actor"`
		Notation string `json:"notation"`
		Label    string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}

	actor := trimTo(body.Actor, maxActorLen)
	if actor == "" {
		writeError(w, http.StatusBadRequest, "nom de joueur requis")
		return
	}

	h.roll(w, r, ts.SessionID, actor, "player", body.Notation, body.Label, false)
}

// ── Console endpoints (authenticated, campaign owner) ─────────────────────────

// EnsureToken mints the session's share token, or returns the existing one.
// Pass {"regenerate": true} to revoke every link already handed out.
func (h *TableHandler) EnsureToken(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")

	var body struct {
		Regenerate bool `json:"regenerate"`
	}
	json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck — an empty body means "don't regenerate"

	token, err := db.EnsureTableToken(r.Context(), h.db, sessionID, body.Regenerate)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"table_token": token})
}

// SetProjection replaces what the table screen shows and broadcasts it.
func (h *TableHandler) SetProjection(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")

	var body db.Projection
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}

	p, err := sanitizeProjection(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.applyProjection(w, r, sessionID, p)
}

// ClearProjection returns the table screen to its idle card.
func (h *TableHandler) ClearProjection(w http.ResponseWriter, r *http.Request) {
	h.applyProjection(w, r, chi.URLParam(r, "sessionId"), db.Projection{})
}

func (h *TableHandler) applyProjection(w http.ResponseWriter, r *http.Request, sessionID string, p db.Projection) {
	if err := db.SetProjection(r.Context(), h.db, sessionID, p); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.hub.Publish(sessionID, table.Event{Type: table.EventProjection, Data: p})
	writeJSON(w, http.StatusOK, p)
}

// ListRolls returns the session's roll log, secret GM rolls included. Only the
// console reaches this route.
func (h *TableHandler) ListRolls(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	rolls, err := db.ListRolls(r.Context(), h.db, sessionID, true, rollFeedLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rolls)
}

// GMRoll rolls for the GM. A secret roll is never published to the hub — it is
// withheld at the source, not filtered client-side.
func (h *TableHandler) GMRoll(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")

	var body struct {
		Notation string `json:"notation"`
		Label    string `json:"label"`
		Secret   bool   `json:"secret"`
		Actor    string `json:"actor"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps invalide")
		return
	}

	actor := trimTo(body.Actor, maxActorLen)
	if actor == "" {
		actor = "MJ"
	}
	h.roll(w, r, sessionID, actor, "gm", body.Notation, body.Label, body.Secret)
}

// ── Shared roll path ──────────────────────────────────────────────────────────

func (h *TableHandler) roll(w http.ResponseWriter, r *http.Request,
	sessionID, actor, actorKind, notation, label string, secret bool) {

	res, err := dice.Roll(notation)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	saved, err := db.CreateRoll(r.Context(), h.db, db.Roll{
		SessionID: sessionID,
		Actor:     actor,
		ActorKind: actorKind,
		Notation:  res.Notation,
		Label:     trimTo(label, maxLabelLen),
		Detail:    res.Detail,
		Total:     res.Total,
		Secret:    secret,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if !secret {
		h.hub.Publish(sessionID, table.Event{Type: table.EventRoll, Data: saved})
	}
	writeJSON(w, http.StatusCreated, saved)
}

// ── Validation ────────────────────────────────────────────────────────────────

func sanitizeProjection(p db.Projection) (db.Projection, error) {
	out := db.Projection{
		Kind:     p.Kind,
		URL:      strings.TrimSpace(p.URL),
		Title:    trimTo(p.Title, maxTitleLen),
		Subtitle: trimTo(p.Subtitle, maxSubtitleLen),
	}

	switch out.Kind {
	case "":
		return db.Projection{}, nil
	case "text":
		out.URL = ""
		if out.Title == "" && out.Subtitle == "" {
			return db.Projection{}, fmt.Errorf("un carton texte a besoin d'un titre")
		}
	case "image":
		if len(out.URL) > maxURLLen {
			return db.Projection{}, fmt.Errorf("URL trop longue")
		}
		// Only same-origin paths and plain http(s) — never javascript: or data:.
		if !strings.HasPrefix(out.URL, "/") &&
			!strings.HasPrefix(out.URL, "http://") &&
			!strings.HasPrefix(out.URL, "https://") {
			return db.Projection{}, fmt.Errorf("URL d'image invalide")
		}
	case "draw":
		out.URL = ""
		if len(p.Scene) > maxSceneLen {
			return db.Projection{}, fmt.Errorf("tableau trop volumineux")
		}
		if p.Scene == "" || !json.Valid([]byte(p.Scene)) {
			return db.Projection{}, fmt.Errorf("tableau invalide")
		}
		out.Scene = p.Scene
	default:
		return db.Projection{}, fmt.Errorf("type de projection invalide")
	}
	return out, nil
}

func trimTo(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) > max {
		return strings.TrimSpace(s[:max])
	}
	return s
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

// rateLimiter throttles the public roll endpoint per session. The table link is
// a shared capability, so the session — not the caller — is the right bucket.
type rateLimiter struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{last: make(map[string]time.Time)}
}

func (l *rateLimiter) allow(key string, gap time.Duration) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.last) > 1000 {
		for k, t := range l.last {
			if now.Sub(t) > time.Minute {
				delete(l.last, k)
			}
		}
	}
	if t, ok := l.last[key]; ok && now.Sub(t) < gap {
		return false
	}
	l.last[key] = now
	return true
}
