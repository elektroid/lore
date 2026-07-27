// Package ratelimit is a small in-memory sliding-window limiter.
//
// One process, one SQLite file, a group of friends — so a map behind a mutex is
// the right size of solution. It exists mainly so that an exposed instance
// cannot be brute-forced through the login form or made to spend the owner's
// LLM budget by whoever finds the URL.
package ratelimit

import (
	"sync"
	"time"
)

// Limiter allows at most Max events per Window for a given key.
type Limiter struct {
	max    int
	window time.Duration

	mu   sync.Mutex
	hits map[string][]time.Time
	last time.Time // last sweep, so cleanup is amortised rather than scheduled
}

func New(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, hits: map[string][]time.Time{}, last: time.Now()}
}

// Allow records an event for key and reports whether it is within the limit.
func (l *Limiter) Allow(key string) bool {
	now := time.Now()
	cutoff := now.Add(-l.window)

	l.mu.Lock()
	defer l.mu.Unlock()

	// Amortised sweep: without it a long-running instance keeps one slice per
	// IP that ever connected. Doing it here avoids a background goroutine.
	if now.Sub(l.last) > l.window {
		for k, times := range l.hits {
			if kept := after(times, cutoff); len(kept) == 0 {
				delete(l.hits, k)
			} else {
				l.hits[k] = kept
			}
		}
		l.last = now
	}

	times := after(l.hits[key], cutoff)
	if len(times) >= l.max {
		l.hits[key] = times // refresh the trimmed slice; the event is not recorded
		return false
	}
	l.hits[key] = append(times, now)
	return true
}

// Retry reports how long the caller should wait before key is allowed again.
func (l *Limiter) Retry(key string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()

	times := after(l.hits[key], time.Now().Add(-l.window))
	if len(times) < l.max {
		return 0
	}
	return time.Until(times[0].Add(l.window))
}

// after returns the tail of times at or after cutoff. times is sorted because
// events are only ever appended.
func after(times []time.Time, cutoff time.Time) []time.Time {
	i := 0
	for i < len(times) && times[i].Before(cutoff) {
		i++
	}
	if i == 0 {
		return times
	}
	return times[i:]
}
