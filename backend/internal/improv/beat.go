// Package improv holds what the LLM does with an improvised beat: the coherency
// report it produces, the handle-resolution that turns its scene references
// back into real scenes, and the prompt that asks for both. Nothing here
// touches the database, and nothing here runs during capture — at the table the
// GM types a note and gets back to the game. See docs/play-improv.md.
package improv

import (
	"encoding/json"
	"strings"
)

// ── Coherency ─────────────────────────────────────────────────────────────────

// Verdicts. Never a gate: a conflict beat is still one click from adoption,
// because sometimes it is the scenario that is wrong now, not the players.
const (
	VerdictOK       = "ok"
	VerdictTension  = "tension"
	VerdictConflict = "conflict"
)

var verdictAliases = map[string]string{
	"ok": VerdictOK, "fine": VerdictOK, "coherent": VerdictOK, "cohérent": VerdictOK,
	"compatible": VerdictOK, "aucun": VerdictOK, "none": VerdictOK,

	"tension": VerdictTension, "warning": VerdictTension, "risque": VerdictTension,
	"friction": VerdictTension, "mineur": VerdictTension, "minor": VerdictTension,

	"conflict": VerdictConflict, "conflit": VerdictConflict,
	"contradiction": VerdictConflict, "incohérent": VerdictConflict,
	"incoherent": VerdictConflict, "majeur": VerdictConflict, "major": VerdictConflict,
}

func normalizeVerdict(v string) string {
	if got, ok := verdictAliases[strings.ToLower(strings.TrimSpace(v))]; ok {
		return got
	}
	// An unreadable verdict is not a clean bill of health — say "look at this"
	// rather than quietly claiming everything is fine.
	return VerdictTension
}

// Impact is one existing scene the improvisation lands on. SceneRef is the
// short handle the model was given; SceneID and Title are filled in by
// ResolveImpacts, because the model cannot produce UUIDs.
type Impact struct {
	SceneRef string `json:"scene_ref"`
	SceneID  string `json:"scene_id"`
	Title    string `json:"title"`
	Note     string `json:"note"`
}

type Coherency struct {
	Verdict string   `json:"verdict"`
	Summary string   `json:"summary"`
	Impacts []Impact `json:"impacts"`
}

// DevelopResult is what one develop call returns.
type DevelopResult struct {
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Outcome     string    `json:"outcome"`
	Notes       string    `json:"notes"`
	Coherency   Coherency `json:"coherency"`
}

// ── Scenes as the model sees them ─────────────────────────────────────────────

// SceneLine is one scene of the beat sheet, as handed to the model: a short
// handle it can reference, plus just enough to judge coherency.
type SceneLine struct {
	Ref      string
	ID       string
	Title    string
	Summary  string
	Status   string
	Played   bool
	Voided   bool
	IsAnchor bool
}

// ResolveImpacts turns the model's handles back into real scenes and drops the
// ones that resolve to nothing. A hallucinated reference costs a missing line
// in the report, never a failed develop.
func ResolveImpacts(c *Coherency, scenes []SceneLine) {
	c.Verdict = normalizeVerdict(c.Verdict)
	c.Summary = strings.TrimSpace(c.Summary)

	byRef := make(map[string]SceneLine, len(scenes))
	for _, s := range scenes {
		byRef[strings.ToLower(s.Ref)] = s
	}

	resolved := make([]Impact, 0, len(c.Impacts))
	seen := map[string]bool{}
	for _, im := range c.Impacts {
		ref := strings.ToLower(strings.TrimSpace(im.SceneRef))
		scene, ok := byRef[ref]
		if !ok || seen[ref] {
			continue
		}
		seen[ref] = true
		resolved = append(resolved, Impact{
			SceneRef: scene.Ref,
			SceneID:  scene.ID,
			Title:    scene.Title,
			Note:     strings.TrimSpace(im.Note),
		})
	}
	c.Impacts = resolved
}

// Clean trims the prose fields. The GM's own note is not touched here — it is
// never passed through development in the first place.
func (r *DevelopResult) Clean(scenes []SceneLine) {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.Outcome = strings.TrimSpace(r.Outcome)
	r.Notes = strings.TrimSpace(r.Notes)
	ResolveImpacts(&r.Coherency, scenes)
}

// ParseCoherency reads a stored coherency blob. Garbage yields an empty report
// rather than an error — a beat the GM can still read and adopt beats a play
// console that refuses to load mid-session.
func ParseCoherency(raw string) Coherency {
	var c Coherency
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &c)
	}
	// Never nil, on every path: the panel maps over this, and a `null` would
	// take the play console down mid-session.
	if c.Impacts == nil {
		c.Impacts = []Impact{}
	}
	return c
}

func (c Coherency) JSON() string {
	if c.Impacts == nil {
		c.Impacts = []Impact{}
	}
	b, err := json.Marshal(c)
	if err != nil {
		return "{}"
	}
	return string(b)
}
