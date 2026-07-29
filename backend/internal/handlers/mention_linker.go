package handlers

import (
	"sort"
	"unicode"
)

// The inverse of mentions.go: refs → names on the way to a model, names → refs
// on the way out of one.
//
// The scenario factory is the only place this is worth doing automatically. When
// materialise writes a scene it already holds the uuid of every PNJ, artefact,
// location and faction the proposal names — the link the GM would otherwise type
// by hand is already in scope. Everywhere else, a mention is a deliberate act and
// guessing at one would be presumptuous.
//
// Two rules, both chosen to keep the result readable rather than exhaustive:
//
//   - First occurrence per entity per field. A scene that says "Bartmoss" four
//     times gets one chip, the way a GM would have written it.
//   - Whole words, longest name first, so "Rache Bartmoss" wins over a separate
//     PNJ called "Bartmoss" and neither matches inside another word.
//
// Matching is case- and accent-insensitive, same as matchKey — the model that
// wrote "l'afterlife" meant the Afterlife.

type mentionTarget struct {
	name string // the entity's name, written into the mention as its label
	ref  string // see mentions.go
	key  []rune // name, folded for comparison
}

type mentionLinker struct {
	targets []mentionTarget
}

// add registers an entity. Unnamed entities are skipped: an empty needle would
// match everywhere.
func (l *mentionLinker) add(name, ref string) {
	key := foldForMatch(name).runes
	if len(key) == 0 {
		return
	}
	l.targets = append(l.targets, mentionTarget{name: name, ref: ref, key: key})
}

// ready sorts targets longest-name-first. Ties break on name so a commit is
// reproducible rather than dependent on map iteration order upstream.
func (l *mentionLinker) ready() {
	sort.SliceStable(l.targets, func(i, j int) bool {
		if len(l.targets[i].key) != len(l.targets[j].key) {
			return len(l.targets[i].key) > len(l.targets[j].key)
		}
		return l.targets[i].name < l.targets[j].name
	})
}

type linkHit struct {
	start, end int
	name, ref  string // empty ref: a span to leave exactly as it is
}

// link rewrites the first mention-worthy occurrence of each known entity name.
func (l *mentionLinker) link(text string) string {
	return l.linkExcept(text, "")
}

// linkExcept is link, skipping one entity — the one whose own description this
// is. "Rache Bartmoss est un netrunner" in Rache's own description should not
// become a chip pointing at the record you are already reading.
func (l *mentionLinker) linkExcept(text, skipRef string) string {
	if text == "" || len(l.targets) == 0 {
		return text
	}
	ft := foldForMatch(text)
	hits := make([]linkHit, 0, len(l.targets))

	// Anything already written as a mention is claimed up front, so a name
	// inside an existing chip's label can never be linked a second time.
	for _, m := range mentionRE.FindAllStringIndex(text, -1) {
		hits = append(hits, linkHit{start: m[0], end: m[1]})
	}

	overlaps := func(start, end int) bool {
		for _, h := range hits {
			if start < h.end && h.start < end {
				return true
			}
		}
		return false
	}

	for _, t := range l.targets {
		if skipRef != "" && t.ref == skipRef {
			continue
		}
		for i := 0; i+len(t.key) <= len(ft.runes); i++ {
			if !matchesAt(ft.runes, i, t.key) {
				continue
			}
			if isWordRune(ft.at(i-1)) || isWordRune(ft.at(i+len(t.key))) {
				continue // inside a longer word
			}
			start, end := ft.offsets[i], ft.ends[i+len(t.key)-1]
			if overlaps(start, end) {
				continue
			}
			hits = append(hits, linkHit{start: start, end: end, name: t.name, ref: t.ref})
			break // first occurrence only
		}
	}

	sort.Slice(hits, func(i, j int) bool { return hits[i].start < hits[j].start })

	var out []byte
	last := 0
	for _, h := range hits {
		out = append(out, text[last:h.start]...)
		if h.ref == "" {
			out = append(out, text[h.start:h.end]...) // pre-existing mention
		} else {
			out = append(out, "@["...)
			out = append(out, h.name...)
			out = append(out, "]("...)
			out = append(out, h.ref...)
			out = append(out, ')')
		}
		last = h.end
	}
	return string(append(out, text[last:]...))
}

func matchesAt(text []rune, at int, needle []rune) bool {
	for k, r := range needle {
		if text[at+k] != r {
			return false
		}
	}
	return true
}

// isWordRune decides what "whole word" means. Letters and digits only, so the
// apostrophe in "l'Afterlife" and "d'Arasaka" reads as a boundary — French
// elision would otherwise hide half the names in a scene.
func isWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

// folded is text lowercased, accent-folded and whitespace-collapsed, with the
// byte range in the original that every folded rune came from. The offsets are
// what let a match found in folded space be spliced into the original.
type folded struct {
	runes   []rune
	offsets []int // byte offset where runes[i] starts in the original
	ends    []int // byte offset just past runes[i] in the original
}

// at returns the rune at i, or 0 outside the text — which is not a word rune, so
// the start and end of a field both count as boundaries.
func (f folded) at(i int) rune {
	if i < 0 || i >= len(f.runes) {
		return 0
	}
	return f.runes[i]
}

// foldForMatch folds the same way matchKey does — lowercase, accents stripped,
// runs of whitespace collapsed to one space — but keeps the mapping back to the
// original text that matchKey has no need for.
func foldForMatch(s string) folded {
	f := folded{}
	prevSpace := false
	for i, r := range s {
		lowered := unicode.ToLower(r)
		if folding, ok := accentFolding[lowered]; ok {
			lowered = folding
		}
		if unicode.IsSpace(lowered) {
			if prevSpace {
				// Extend the space already recorded rather than adding another,
				// so "Le  Kabuki" still matches "le kabuki".
				f.ends[len(f.ends)-1] = i + len(string(r))
				continue
			}
			lowered = ' '
			prevSpace = true
		} else {
			prevSpace = false
		}
		f.runes = append(f.runes, lowered)
		f.offsets = append(f.offsets, i)
		f.ends = append(f.ends, i+len(string(r)))
	}
	return f
}
