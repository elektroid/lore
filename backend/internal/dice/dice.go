// Package dice parses and evaluates tabletop dice notation.
//
// Grammar:
//
//	expr  := term (('+' | '-') term)*
//	term  := dice | integer
//	dice  := [count] 'd' (sides | '%') [('kh' | 'kl') [keep]]
//
// Examples: 1d20, 2d6+3, 4d6kh3, 2d20kl1, 1d8+1d6+2, d%.
//
// Rolling happens server-side so every participant of a session sees the same
// number at the same moment, and no client can nudge a result.
package dice

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Limits. The player-facing roll endpoint is public (token-authenticated) and
// writes to a single-connection SQLite, so notation is bounded on every axis.
const (
	MaxNotationLen = 64
	MaxTerms       = 20
	MaxDicePerTerm = 100
	MaxSides       = 1000
)

// Group is one dice term of an expression, after rolling.
type Group struct {
	Notation string `json:"notation"` // "4d6kh3"
	Sides    int    `json:"sides"`
	Sign     int    `json:"sign"` // +1 or -1
	Values   []int  `json:"values"`
	Dropped  []int  `json:"dropped,omitempty"` // discarded by kh/kl
}

// Result is a fully evaluated expression.
type Result struct {
	Notation string  `json:"notation"` // normalised input
	Total    int     `json:"total"`
	Detail   string  `json:"detail"` // "4d6kh3[5, 4, 3, (2)] + 1"
	Groups   []Group `json:"groups"`
}

// termRe matches a single term: either a dice term or a bare integer.
var termRe = regexp.MustCompile(`^(?:(\d*)d(\d+|%)(?:(kh|kl)(\d*))?|(\d+))$`)

// Roll evaluates notation using the default random source.
func Roll(notation string) (Result, error) {
	return RollWith(notation, rand.IntN)
}

// RollWith evaluates notation using next, which must return a value in [0, n).
// Tests use it to get deterministic results.
func RollWith(notation string, next func(n int) int) (Result, error) {
	clean := strings.ToLower(strings.Join(strings.Fields(notation), ""))
	if clean == "" {
		return Result{}, errors.New("notation vide")
	}
	if len(clean) > MaxNotationLen {
		return Result{}, fmt.Errorf("notation trop longue (max %d caractères)", MaxNotationLen)
	}

	terms, err := splitTerms(clean)
	if err != nil {
		return Result{}, err
	}
	if len(terms) > MaxTerms {
		return Result{}, fmt.Errorf("trop de termes (max %d)", MaxTerms)
	}

	res := Result{Notation: clean}
	var details []string

	for i, t := range terms {
		g, detail, err := rollTerm(t, next)
		if err != nil {
			return Result{}, err
		}
		res.Groups = append(res.Groups, g)
		res.Total += g.Sign * sum(g.Values)

		switch {
		case i == 0 && t.sign < 0:
			details = append(details, "-"+detail)
		case i == 0:
			details = append(details, detail)
		case t.sign < 0:
			details = append(details, "-", detail)
		default:
			details = append(details, "+", detail)
		}
	}

	res.Detail = strings.Join(details, " ")
	return res, nil
}

type signedTerm struct {
	sign int
	text string
}

func splitTerms(s string) ([]signedTerm, error) {
	var terms []signedTerm
	sign := 1
	var cur strings.Builder

	flush := func() error {
		if cur.Len() == 0 {
			return fmt.Errorf("notation invalide : %q", s)
		}
		terms = append(terms, signedTerm{sign: sign, text: cur.String()})
		cur.Reset()
		return nil
	}

	for i := 0; i < len(s); i++ {
		c := s[i]
		if c != '+' && c != '-' {
			cur.WriteByte(c)
			continue
		}
		if i > 0 {
			if err := flush(); err != nil {
				return nil, err
			}
		}
		if c == '-' {
			sign = -1
		} else {
			sign = 1
		}
	}
	if err := flush(); err != nil {
		return nil, err
	}
	return terms, nil
}

func rollTerm(t signedTerm, next func(n int) int) (Group, string, error) {
	m := termRe.FindStringSubmatch(t.text)
	if m == nil {
		return Group{}, "", fmt.Errorf("terme invalide : %q", t.text)
	}

	// Bare integer — a constant modifier.
	if m[5] != "" {
		n, err := strconv.Atoi(m[5])
		if err != nil {
			return Group{}, "", fmt.Errorf("terme invalide : %q", t.text)
		}
		g := Group{Notation: m[5], Sign: t.sign, Values: []int{n}}
		return g, m[5], nil
	}

	count := 1
	if m[1] != "" {
		var err error
		if count, err = strconv.Atoi(m[1]); err != nil {
			return Group{}, "", fmt.Errorf("terme invalide : %q", t.text)
		}
	}
	if count < 1 || count > MaxDicePerTerm {
		return Group{}, "", fmt.Errorf("nombre de dés invalide (1 à %d)", MaxDicePerTerm)
	}

	sides := 100
	if m[2] != "%" {
		var err error
		if sides, err = strconv.Atoi(m[2]); err != nil {
			return Group{}, "", fmt.Errorf("terme invalide : %q", t.text)
		}
	}
	if sides < 1 || sides > MaxSides {
		return Group{}, "", fmt.Errorf("nombre de faces invalide (1 à %d)", MaxSides)
	}

	keepMode, keep := m[3], count
	if keepMode != "" {
		keep = 1
		if m[4] != "" {
			var err error
			if keep, err = strconv.Atoi(m[4]); err != nil {
				return Group{}, "", fmt.Errorf("terme invalide : %q", t.text)
			}
		}
		if keep < 1 || keep > count {
			return Group{}, "", fmt.Errorf("%s%d : impossible de garder %d dés sur %d", keepMode, keep, keep, count)
		}
	}

	rolled := make([]int, count)
	for i := range rolled {
		rolled[i] = next(sides) + 1
	}

	kept := keptMask(rolled, keepMode, keep)

	g := Group{Notation: t.text, Sides: sides, Sign: t.sign}
	parts := make([]string, 0, count)
	for i, v := range rolled {
		if kept[i] {
			g.Values = append(g.Values, v)
			parts = append(parts, strconv.Itoa(v))
		} else {
			g.Dropped = append(g.Dropped, v)
			parts = append(parts, "("+strconv.Itoa(v)+")")
		}
	}

	return g, fmt.Sprintf("%s[%s]", t.text, strings.Join(parts, ", ")), nil
}

// keptMask marks which rolled dice survive a kh/kl selector, in original order.
func keptMask(values []int, mode string, keep int) []bool {
	mask := make([]bool, len(values))
	if mode == "" {
		for i := range mask {
			mask[i] = true
		}
		return mask
	}

	order := make([]int, len(values))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		if mode == "kh" {
			return values[order[a]] > values[order[b]]
		}
		return values[order[a]] < values[order[b]]
	})
	for i := 0; i < keep && i < len(order); i++ {
		mask[order[i]] = true
	}
	return mask
}

func sum(xs []int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	return t
}
