// Package table broadcasts live session events to the table screen and to
// player seats over Server-Sent Events.
//
// One-directional server→client is the exact shape of the problem: the table
// only ever receives, and players write through ordinary POSTs. No WebSocket
// upgrade, no new dependency, and EventSource reconnects on its own.
//
// State is per-process. A multi-instance deployment would need the hub behind
// a shared bus; Lore runs as a single Go process today.
package table

import "sync"

// Event types carried on the stream.
const (
	EventState      = "state"      // full snapshot, sent on connect
	EventProjection = "projection" // the GM changed what is on screen
	EventRoll       = "roll"       // a non-secret roll happened
)

// Event is one message pushed to subscribers of a session.
type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

// bufferSize is how far a subscriber may lag before events are dropped for it.
// Dropping is the right failure: a stalled TV browser must not slow the GM down,
// and it will resync from the snapshot when EventSource reconnects.
const bufferSize = 16

// Hub fans session events out to every connected table screen and player seat.
// The zero value is not usable — call NewHub.
type Hub struct {
	mu   sync.RWMutex
	subs map[string]map[chan Event]struct{} // session ID → subscribers
}

func NewHub() *Hub {
	return &Hub{subs: make(map[string]map[chan Event]struct{})}
}

// Subscribe registers a listener for a session. The caller must Unsubscribe.
func (h *Hub) Subscribe(sessionID string) chan Event {
	ch := make(chan Event, bufferSize)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs[sessionID] == nil {
		h.subs[sessionID] = make(map[chan Event]struct{})
	}
	h.subs[sessionID][ch] = struct{}{}
	return ch
}

// Unsubscribe removes a listener and closes its channel. Safe to call twice.
func (h *Hub) Unsubscribe(sessionID string, ch chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	subs, ok := h.subs[sessionID]
	if !ok {
		return
	}
	if _, ok := subs[ch]; !ok {
		return
	}
	delete(subs, ch)
	close(ch)
	if len(subs) == 0 {
		delete(h.subs, sessionID)
	}
}

// Publish delivers an event to every subscriber of a session. It never blocks:
// a subscriber whose buffer is full simply misses this event.
func (h *Hub) Publish(sessionID string, ev Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subs[sessionID] {
		select {
		case ch <- ev:
		default:
		}
	}
}

// Listeners reports how many surfaces are currently connected to a session.
// The GM console shows this so the GM knows the TV is actually live.
func (h *Hub) Listeners(sessionID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs[sessionID])
}
