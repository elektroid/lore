package table

import (
	"sync"
	"testing"
)

func TestPublishReachesEverySubscriber(t *testing.T) {
	h := NewHub()
	a := h.Subscribe("s1")
	b := h.Subscribe("s1")
	other := h.Subscribe("s2")
	defer h.Unsubscribe("s1", a)
	defer h.Unsubscribe("s1", b)
	defer h.Unsubscribe("s2", other)

	h.Publish("s1", Event{Type: EventRoll, Data: 42})

	for name, ch := range map[string]chan Event{"a": a, "b": b} {
		select {
		case ev := <-ch:
			if ev.Type != EventRoll || ev.Data != 42 {
				t.Errorf("%s got %+v", name, ev)
			}
		default:
			t.Errorf("%s received nothing", name)
		}
	}

	if len(other) != 0 {
		t.Error("an event leaked into another session")
	}
}

func TestPublishNeverBlocksOnAStalledSubscriber(t *testing.T) {
	h := NewHub()
	ch := h.Subscribe("s1")
	defer h.Unsubscribe("s1", ch)

	// Nobody is draining: everything past the buffer must be dropped, not block.
	for i := 0; i < bufferSize*4; i++ {
		h.Publish("s1", Event{Type: EventRoll, Data: i})
	}

	if got := len(ch); got != bufferSize {
		t.Errorf("buffered %d events, want %d", got, bufferSize)
	}
}

func TestUnsubscribeIsIdempotent(t *testing.T) {
	h := NewHub()
	ch := h.Subscribe("s1")

	h.Unsubscribe("s1", ch)
	h.Unsubscribe("s1", ch) // must not panic on a double close
	h.Unsubscribe("s1", make(chan Event))

	if h.Listeners("s1") != 0 {
		t.Error("session should have no listeners left")
	}
	// Publishing to an empty session is a no-op, not a panic.
	h.Publish("s1", Event{Type: EventRoll})
}

func TestConcurrentSubscribeAndPublish(t *testing.T) {
	h := NewHub()
	var wg sync.WaitGroup

	for i := 0; i < 40; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			ch := h.Subscribe("s1")
			h.Unsubscribe("s1", ch)
		}()
		go func() {
			defer wg.Done()
			h.Publish("s1", Event{Type: EventProjection})
		}()
	}
	wg.Wait()

	if got := h.Listeners("s1"); got != 0 {
		t.Errorf("listeners = %d, want 0", got)
	}
}
