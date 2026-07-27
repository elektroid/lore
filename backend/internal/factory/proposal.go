// Package factory holds the scenario-factory proposal document: the shape the
// LLM must produce, the normalisation that makes an LLM's best effort usable,
// and the prompts that ask for it. Nothing here touches the database — a
// proposal is a draft, and only the commit step in the handlers turns it into
// scenes and entities. See docs/scenario-factory.md.
package factory

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// ── Items ─────────────────────────────────────────────────────────────────────

// Ref is the short handle the model gives an item ("n1", "loc2") so scenes can
// point at it. Commit resolves refs to real row ids; the model never sees UUIDs.

type Faction struct {
	Ref         string   `json:"ref"`
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Description string   `json:"description"`
	Motivation  string   `json:"motivation"`
	Include     flexBool `json:"include"`
}

type Location struct {
	Ref         string   `json:"ref"`
	Name        string   `json:"name"`
	City        string   `json:"city"`
	District    string   `json:"district"`
	Description string   `json:"description"`
	Atmosphere  string   `json:"atmosphere"`
	Include     flexBool `json:"include"`
}

type NPC struct {
	Ref         string   `json:"ref"`
	Name        string   `json:"name"`
	Role        string   `json:"role"`
	Description string   `json:"description"`
	Quote       string   `json:"quote"`
	Motivation  string   `json:"motivation"`
	FactionRef  string   `json:"faction_ref"`
	Include     flexBool `json:"include"`
}

type Artefact struct {
	Ref         string   `json:"ref"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Include     flexBool `json:"include"`
}

type Scene struct {
	Ref     string `json:"ref"`
	Title   string `json:"title"`
	Status  string `json:"status"`
	Summary string `json:"summary"`

	// Filled by the expand stage, empty until then.
	Description string `json:"description"`
	Outcome     string `json:"outcome"`
	Notes       string `json:"notes"`

	LocationRef  string      `json:"location_ref"`
	NPCRefs      flexStrings `json:"npc_refs"`
	ArtefactRefs flexStrings `json:"artefact_refs"`

	IsStart  flexBool `json:"is_start"`
	IsEnd    flexBool `json:"is_end"`
	Expanded flexBool `json:"expanded"`
	Include  flexBool `json:"include"`
}

// Proposal is the whole draft document, stored as JSON in scenario_drafts.proposal.
type Proposal struct {
	Title     string     `json:"title"`
	Pitch     string     `json:"pitch"`
	Factions  []Faction  `json:"factions"`
	Locations []Location `json:"locations"`
	NPCs      []NPC      `json:"npcs"`
	Artefacts []Artefact `json:"artefacts"`
	Scenes    []Scene    `json:"scenes"`
}

// ── Scene status ──────────────────────────────────────────────────────────────

// Scene status reuses the synopsis vocabulary so a committed beat sheet is
// indistinguishable from a hand-built one.
const (
	StatusIdea         = "idea"
	StatusOptionalStep = "optional_step"
	StatusKeyEvent     = "key_event"
)

// statusAliases maps what models actually write onto the three real values.
var statusAliases = map[string]string{
	"idea": StatusIdea, "idée": StatusIdea, "idee": StatusIdea,
	"optional": StatusOptionalStep, "optional_step": StatusOptionalStep,
	"optionnel": StatusOptionalStep, "optionnelle": StatusOptionalStep,
	"étape optionnelle": StatusOptionalStep, "etape optionnelle": StatusOptionalStep,
	"key": StatusKeyEvent, "key_event": StatusKeyEvent, "key event": StatusKeyEvent,
	"essential": StatusKeyEvent, "essentiel": StatusKeyEvent, "essentielle": StatusKeyEvent,
	"événement clé": StatusKeyEvent, "evenement cle": StatusKeyEvent, "clé": StatusKeyEvent,
}

func normalizeStatus(s string) string {
	if v, ok := statusAliases[strings.ToLower(strings.TrimSpace(s))]; ok {
		return v
	}
	return StatusKeyEvent
}

// ── Normalisation ─────────────────────────────────────────────────────────────

// Normalize makes a proposal safe to store, render and commit, whatever the
// model (or a hand-edited PUT) sent: every item gets a unique non-empty ref,
// text is trimmed, unnamed items are dropped, scene statuses are coerced to the
// three real values, dangling refs are cleared, and at most one scene is start.
//
// It deliberately leaves Include alone — that flag is the GM's, and after an
// LLM call the caller applies SetAllIncluded instead.
func Normalize(p *Proposal) {
	p.Title = strings.TrimSpace(p.Title)
	p.Pitch = strings.TrimSpace(p.Pitch)

	used := map[string]bool{}
	// ensureRef keeps the model's own handle when it is usable and unique,
	// because scenes point at it; only collisions and blanks get a new one.
	ensureRef := func(ref, prefix string, i int) string {
		ref = strings.TrimSpace(ref)
		if ref == "" || used[ref] {
			ref = fmt.Sprintf("%s%d", prefix, i+1)
			for used[ref] {
				ref += "x"
			}
		}
		used[ref] = true
		return ref
	}

	factions := p.Factions[:0]
	for i := range p.Factions {
		f := &p.Factions[i]
		f.Name = strings.TrimSpace(f.Name)
		if f.Name == "" {
			continue
		}
		f.Ref = ensureRef(f.Ref, "f", i)
		f.Type = strings.TrimSpace(f.Type)
		f.Description = strings.TrimSpace(f.Description)
		f.Motivation = strings.TrimSpace(f.Motivation)
		factions = append(factions, *f)
	}
	p.Factions = factions

	locations := p.Locations[:0]
	for i := range p.Locations {
		l := &p.Locations[i]
		l.Name = strings.TrimSpace(l.Name)
		if l.Name == "" {
			continue
		}
		l.Ref = ensureRef(l.Ref, "l", i)
		l.City = strings.TrimSpace(l.City)
		l.District = strings.TrimSpace(l.District)
		l.Description = strings.TrimSpace(l.Description)
		l.Atmosphere = strings.TrimSpace(l.Atmosphere)
		locations = append(locations, *l)
	}
	p.Locations = locations

	npcs := p.NPCs[:0]
	for i := range p.NPCs {
		n := &p.NPCs[i]
		n.Name = strings.TrimSpace(n.Name)
		if n.Name == "" {
			continue
		}
		n.Ref = ensureRef(n.Ref, "n", i)
		n.Role = strings.TrimSpace(n.Role)
		n.Description = strings.TrimSpace(n.Description)
		n.Quote = strings.TrimSpace(n.Quote)
		n.Motivation = strings.TrimSpace(n.Motivation)
		n.FactionRef = strings.TrimSpace(n.FactionRef)
		npcs = append(npcs, *n)
	}
	p.NPCs = npcs

	artefacts := p.Artefacts[:0]
	for i := range p.Artefacts {
		a := &p.Artefacts[i]
		a.Name = strings.TrimSpace(a.Name)
		if a.Name == "" {
			continue
		}
		a.Ref = ensureRef(a.Ref, "a", i)
		a.Description = strings.TrimSpace(a.Description)
		artefacts = append(artefacts, *a)
	}
	p.Artefacts = artefacts

	factionRefs := refSet(p.Factions, func(f Faction) string { return f.Ref })
	locationRefs := refSet(p.Locations, func(l Location) string { return l.Ref })
	npcRefs := refSet(p.NPCs, func(n NPC) string { return n.Ref })
	artefactRefs := refSet(p.Artefacts, func(a Artefact) string { return a.Ref })

	for i := range p.NPCs {
		if !factionRefs[p.NPCs[i].FactionRef] {
			p.NPCs[i].FactionRef = ""
		}
	}

	scenes := p.Scenes[:0]
	seenStart := false
	for i := range p.Scenes {
		s := &p.Scenes[i]
		s.Title = strings.TrimSpace(s.Title)
		s.Summary = strings.TrimSpace(s.Summary)
		if s.Title == "" && s.Summary == "" {
			continue
		}
		if s.Title == "" {
			s.Title = truncateWords(s.Summary, 6)
		}
		s.Ref = ensureRef(s.Ref, "s", i)
		s.Status = normalizeStatus(s.Status)
		s.Description = strings.TrimSpace(s.Description)
		s.Outcome = strings.TrimSpace(s.Outcome)
		s.Notes = strings.TrimSpace(s.Notes)

		s.LocationRef = strings.TrimSpace(s.LocationRef)
		if !locationRefs[s.LocationRef] {
			s.LocationRef = ""
		}
		s.NPCRefs = filterRefs(s.NPCRefs, npcRefs)
		s.ArtefactRefs = filterRefs(s.ArtefactRefs, artefactRefs)

		// Only one start scene, same rule the synopsis editor enforces.
		if bool(s.IsStart) {
			if seenStart {
				s.IsStart = false
			} else {
				seenStart = true
			}
		}
		scenes = append(scenes, *s)
	}
	p.Scenes = scenes

	// A beat sheet with no entry point is a list, not a story.
	if !seenStart && len(p.Scenes) > 0 {
		p.Scenes[0].IsStart = true
	}
}

// SetAllIncluded marks every item of a freshly generated proposal as included.
// The GM unticks what they don't want; they should not have to tick what they do.
func SetAllIncluded(p *Proposal) {
	for i := range p.Factions {
		p.Factions[i].Include = true
	}
	for i := range p.Locations {
		p.Locations[i].Include = true
	}
	for i := range p.NPCs {
		p.NPCs[i].Include = true
	}
	for i := range p.Artefacts {
		p.Artefacts[i].Include = true
	}
	for i := range p.Scenes {
		p.Scenes[i].Include = true
	}
}

// FindScene returns a pointer into p.Scenes, so callers can mutate in place.
func (p *Proposal) FindScene(ref string) *Scene {
	for i := range p.Scenes {
		if p.Scenes[i].Ref == ref {
			return &p.Scenes[i]
		}
	}
	return nil
}

// LocationName resolves a scene's location ref to its proposed name, for prompts.
func (p *Proposal) LocationName(ref string) string {
	for _, l := range p.Locations {
		if l.Ref == ref {
			return l.Name
		}
	}
	return ""
}

// NPCNames resolves a scene's npc refs to "Name (role)" strings, for prompts.
func (p *Proposal) NPCNames(refs []string) []string {
	var out []string
	for _, ref := range refs {
		for _, n := range p.NPCs {
			if n.Ref != ref {
				continue
			}
			if n.Role != "" {
				out = append(out, n.Name+" ("+n.Role+")")
			} else {
				out = append(out, n.Name)
			}
		}
	}
	return out
}

// ── JSON round-trip ───────────────────────────────────────────────────────────

// Parse decodes a stored proposal. A malformed or empty blob yields an empty
// proposal rather than an error: a draft the GM can still see and delete beats
// a page that refuses to load.
func Parse(raw string) Proposal {
	var p Proposal
	if strings.TrimSpace(raw) == "" {
		return p
	}
	_ = json.Unmarshal([]byte(raw), &p)
	return p
}

func (p Proposal) JSON() string {
	b, err := json.Marshal(p)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func refSet[T any](items []T, ref func(T) string) map[string]bool {
	set := make(map[string]bool, len(items))
	for _, it := range items {
		set[ref(it)] = true
	}
	return set
}

func filterRefs(refs []string, valid map[string]bool) []string {
	out := make([]string, 0, len(refs))
	seen := map[string]bool{}
	for _, r := range refs {
		r = strings.TrimSpace(r)
		if valid[r] && !seen[r] {
			seen[r] = true
			out = append(out, r)
		}
	}
	return out
}

func truncateWords(s string, n int) string {
	words := strings.Fields(s)
	if len(words) <= n {
		return s
	}
	return strings.Join(words[:n], " ") + "…"
}

// ── Lenient JSON scalars ──────────────────────────────────────────────────────
//
// The whole document is LLM-authored, and models are casual about types: a
// boolean comes back as "true" or 1, a list of refs as a single string or a
// comma-separated one. Rejecting those means throwing away an otherwise good
// eight-scene outline over a quoted boolean, so both are decoded leniently.

type flexBool bool

func (b *flexBool) UnmarshalJSON(data []byte) error {
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	switch v := raw.(type) {
	case bool:
		*b = flexBool(v)
	case float64:
		*b = v != 0
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "true", "yes", "oui", "1":
			*b = true
		default:
			*b = false
		}
	case nil:
		*b = false
	default:
		*b = false
	}
	return nil
}

func (b flexBool) MarshalJSON() ([]byte, error) {
	return []byte(strconv.FormatBool(bool(b))), nil
}

type flexStrings []string

func (s *flexStrings) UnmarshalJSON(data []byte) error {
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	switch v := raw.(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if str, ok := item.(string); ok {
				out = append(out, str)
			}
		}
		*s = out
	case string:
		out := []string{}
		for _, part := range strings.Split(v, ",") {
			if part = strings.TrimSpace(part); part != "" {
				out = append(out, part)
			}
		}
		*s = out
	default:
		*s = nil
	}
	return nil
}

func (s flexStrings) MarshalJSON() ([]byte, error) {
	if s == nil {
		return []byte("[]"), nil
	}
	return json.Marshal([]string(s))
}
