package handlers

import "testing"

func TestMatchKeyCatchesTheSameNameWrittenDifferently(t *testing.T) {
	// Two names that should bind to one campaign row rather than duplicate it.
	same := [][2]string{
		{"Le Kabuki noyé", "le kabuki noye"},
		{"Vanya Kovár", "VANYA KOVAR"},
		{"  Arasaka  ", "Arasaka"},
		{"Le  Kabuki   noyé", "Le Kabuki noyé"},
		{"Cœur de Néon", "cœur de neon"},
	}
	for _, pair := range same {
		if matchKey(pair[0]) != matchKey(pair[1]) {
			t.Errorf("%q and %q should match (%q vs %q)",
				pair[0], pair[1], matchKey(pair[0]), matchKey(pair[1]))
		}
	}

	different := [][2]string{
		{"Vanya Kovár", "Vanya Kovács"},
		{"Arasaka", "Militech"},
		{"Le Kabuki noyé", "Le Kabuki"},
	}
	for _, pair := range different {
		if matchKey(pair[0]) == matchKey(pair[1]) {
			t.Errorf("%q and %q should not match, both fold to %q",
				pair[0], pair[1], matchKey(pair[0]))
		}
	}
}

func TestClampScenes(t *testing.T) {
	cases := map[int]int{
		0:  defaultScenes, // unset — the GM did not choose
		1:  minScenes,
		3:  3,
		7:  7,
		12: 12,
		50: maxScenes,
		-4: minScenes,
	}
	for in, want := range cases {
		if got := clampScenes(in); got != want {
			t.Errorf("clampScenes(%d) = %d, want %d", in, got, want)
		}
	}
}

func TestFirstNonEmpty(t *testing.T) {
	if got := firstNonEmpty("", "  ", "titre"); got != "  " {
		t.Errorf("firstNonEmpty returns the first non-empty value verbatim, got %q", got)
	}
	if got := firstNonEmpty("", "", ""); got != "" {
		t.Errorf("firstNonEmpty with nothing to offer = %q, want empty", got)
	}
}
