package dice

import "testing"

// seq returns a roll function yielding the given face values (1-based) in order,
// converted back to the [0, n) contract of RollWith.
func seq(faces ...int) func(int) int {
	i := 0
	return func(n int) int {
		if i >= len(faces) {
			panic("dice: test source exhausted")
		}
		v := faces[i]
		i++
		return v - 1
	}
}

func TestRollWith(t *testing.T) {
	tests := []struct {
		name     string
		notation string
		faces    []int
		total    int
		detail   string
	}{
		{"single die", "1d20", []int{14}, 14, "1d20[14]"},
		{"implicit count", "d20", []int{7}, 7, "d20[7]"},
		{"multiple dice and modifier", "2d6+3", []int{4, 6}, 13, "2d6[4, 6] + 3"},
		{"negative modifier", "1d20-2", []int{12}, 10, "1d20[12] - 2"},
		{"mixed dice", "1d8+1d6+2", []int{5, 3}, 10, "1d8[5] + 1d6[3] + 2"},
		{"keep highest", "4d6kh3", []int{5, 2, 4, 3}, 12, "4d6kh3[5, (2), 4, 3]"},
		{"keep lowest", "2d20kl1", []int{18, 4}, 4, "2d20kl1[(18), 4]"},
		{"keep highest default 1", "2d20kh", []int{9, 17}, 17, "2d20kh[(9), 17]"},
		{"percentile", "d%", []int{73}, 73, "d%[73]"},
		{"subtracted dice", "2d6-1d4", []int{3, 5, 2}, 6, "2d6[3, 5] - 1d4[2]"},
		{"leading minus", "-1d6+10", []int{4}, 6, "-1d6[4] + 10"},
		{"whitespace and case", " 2D6 + 1 ", []int{2, 2}, 5, "2d6[2, 2] + 1"},
		{"constant only", "7", nil, 7, "7"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := RollWith(tc.notation, seq(tc.faces...))
			if err != nil {
				t.Fatalf("RollWith(%q) error: %v", tc.notation, err)
			}
			if got.Total != tc.total {
				t.Errorf("total = %d, want %d", got.Total, tc.total)
			}
			if got.Detail != tc.detail {
				t.Errorf("detail = %q, want %q", got.Detail, tc.detail)
			}
		})
	}
}

func TestRollWithKeepSplitsValuesAndDropped(t *testing.T) {
	got, err := RollWith("4d6kh3", seq(5, 2, 4, 3))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	g := got.Groups[0]
	if want := []int{5, 4, 3}; !equal(g.Values, want) {
		t.Errorf("values = %v, want %v", g.Values, want)
	}
	if want := []int{2}; !equal(g.Dropped, want) {
		t.Errorf("dropped = %v, want %v", g.Dropped, want)
	}
}

func TestRollWithTiesKeepFirst(t *testing.T) {
	// Two 6s and a 6 tie: the stable sort must keep the earliest dice.
	got, err := RollWith("3d6kh2", seq(6, 6, 6))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Total != 12 {
		t.Errorf("total = %d, want 12", got.Total)
	}
	if got.Detail != "3d6kh2[6, 6, (6)]" {
		t.Errorf("detail = %q", got.Detail)
	}
}

func TestRollWithErrors(t *testing.T) {
	bad := []string{
		"",
		"   ",
		"d",
		"2d",
		"abc",
		"1d6+",
		"+",
		"1d6++2",
		"1d0",
		"1d1001",
		"0d6",
		"101d6",
		"2d6kh3",  // keep more than rolled
		"2d6kh0",  // keep nothing
		"1d20*2",  // unsupported operator
		"1d20/2",  // unsupported operator
		"1d6 1d6", // whitespace is stripped, leaves an invalid term
	}
	for _, n := range bad {
		t.Run(n, func(t *testing.T) {
			if _, err := RollWith(n, seq(1, 1, 1, 1)); err == nil {
				t.Errorf("RollWith(%q) = nil error, want error", n)
			}
		})
	}
}

func TestRollWithLongNotationRejected(t *testing.T) {
	long := "1d6"
	for len(long) <= MaxNotationLen {
		long += "+1d6"
	}
	if _, err := RollWith(long, seq(1)); err == nil {
		t.Error("expected an error for over-long notation")
	}
}

func TestRollWithTooManyTerms(t *testing.T) {
	n := "1"
	for i := 0; i < MaxTerms; i++ {
		n += "+1"
	}
	if len(n) > MaxNotationLen {
		t.Skipf("notation length cap (%d) hits before the term cap", MaxNotationLen)
	}
	if _, err := RollWith(n, seq()); err == nil {
		t.Error("expected an error for too many terms")
	}
}

func TestRollStaysInRange(t *testing.T) {
	for i := 0; i < 500; i++ {
		got, err := Roll("3d6+2")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Total < 5 || got.Total > 20 {
			t.Fatalf("total %d out of range [5, 20]", got.Total)
		}
	}
}

func equal(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
