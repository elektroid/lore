package ratelimit

import (
	"testing"
	"time"
)

func TestAllowsUpToTheLimitThenRefuses(t *testing.T) {
	l := New(3, time.Minute)
	for i := 1; i <= 3; i++ {
		if !l.Allow("ip") {
			t.Fatalf("event %d should be allowed", i)
		}
	}
	if l.Allow("ip") {
		t.Error("the fourth event should be refused")
	}
}

func TestKeysAreIndependent(t *testing.T) {
	// One person failing to log in must not lock everyone else out.
	l := New(1, time.Minute)
	if !l.Allow("alice") || !l.Allow("bob") {
		t.Fatal("separate keys must have separate budgets")
	}
	if l.Allow("alice") {
		t.Error("alice's second event should be refused")
	}
}

func TestWindowSlides(t *testing.T) {
	l := New(2, 50*time.Millisecond)
	l.Allow("ip")
	l.Allow("ip")
	if l.Allow("ip") {
		t.Fatal("should be at the limit")
	}
	time.Sleep(60 * time.Millisecond)
	if !l.Allow("ip") {
		t.Error("the window should have slid, freeing the budget")
	}
}

func TestRefusedEventsDoNotExtendTheBlock(t *testing.T) {
	// A caller hammering the endpoint must not push their own unlock further
	// away — otherwise a bot locks a legitimate user out indefinitely.
	l := New(1, 60*time.Millisecond)
	l.Allow("ip")
	for i := 0; i < 20; i++ {
		l.Allow("ip")
	}
	time.Sleep(70 * time.Millisecond)
	if !l.Allow("ip") {
		t.Error("refused attempts must not extend the window")
	}
}

func TestRetryReportsAWaitOnlyWhenBlocked(t *testing.T) {
	l := New(1, time.Minute)
	if d := l.Retry("ip"); d != 0 {
		t.Errorf("unused key should need no wait, got %v", d)
	}
	l.Allow("ip")
	l.Allow("ip")
	if d := l.Retry("ip"); d <= 0 || d > time.Minute {
		t.Errorf("blocked key should report a wait inside the window, got %v", d)
	}
}

func TestSweepDropsIdleKeys(t *testing.T) {
	// Without the sweep, a long-running instance keeps one slice per IP that
	// ever connected.
	l := New(5, 20*time.Millisecond)
	for i := 0; i < 50; i++ {
		l.Allow(string(rune('a' + i%50)))
	}
	time.Sleep(30 * time.Millisecond)
	l.Allow("trigger-the-sweep")

	l.mu.Lock()
	n := len(l.hits)
	l.mu.Unlock()
	if n > 2 {
		t.Errorf("idle keys should have been swept, %d remain", n)
	}
}
