package handlers

import "testing"

// The linker edits prose the model wrote, so its judgement has to be predictable.
// These pin the four rules: first occurrence only, longest name wins, whole words
// only, and nothing already linked gets touched.

func testLinker(pairs ...[2]string) *mentionLinker {
	l := &mentionLinker{}
	for _, p := range pairs {
		l.add(p[0], p[1])
	}
	l.ready()
	return l
}

func TestLinkerLinksTheFirstOccurrenceOfEachName(t *testing.T) {
	l := testLinker(
		[2]string{"Rache Bartmoss", "npc-1"},
		[2]string{"Afterlife", locationMentionPrefix + "loc-1"},
	)

	got := l.link("Rache Bartmoss attend à l'Afterlife. Rache Bartmoss ne parlera pas.")
	want := "@[Rache Bartmoss](npc-1) attend à l'@[Afterlife](location:loc-1). Rache Bartmoss ne parlera pas."
	if got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

// The elision is the whole reason word boundaries are letters-and-digits only:
// "l'Afterlife" and "d'Arasaka" are how French prose names things.
func TestLinkerSeesThroughFrenchElision(t *testing.T) {
	l := testLinker([2]string{"Arasaka", factionMentionPrefix + "f-1"})
	got := l.link("Il se méfie d'Arasaka, et (Arasaka) le sait.")
	want := "Il se méfie d'@[Arasaka](faction:f-1), et (Arasaka) le sait."
	if got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

func TestLinkerPrefersTheLongestName(t *testing.T) {
	// Both exist in the campaign; the sentence names the full one.
	l := testLinker(
		[2]string{"Bartmoss", "npc-short"},
		[2]string{"Rache Bartmoss", "npc-long"},
	)
	got := l.link("Rache Bartmoss entre.")
	want := "@[Rache Bartmoss](npc-long) entre."
	if got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

func TestLinkerRefusesPartialWords(t *testing.T) {
	l := testLinker(
		[2]string{"Mur", factionMentionPrefix + "f-1"},
		[2]string{"Clé", artefactMentionPrefix + "a-1"},
	)
	// "murmure" contains "mur"; "Clés" is not "Clé". Neither is a mention.
	got := l.link("Un murmure derrière les Clés perdues.")
	if got != "Un murmure derrière les Clés perdues." {
		t.Errorf("partial word linked: %q", got)
	}
	// The standalone word is fair game — this is the accepted false-positive
	// cost of short names.
	if got := l.link("Il touche le mur."); got != "Il touche le @[Mur](faction:f-1)." {
		t.Errorf("standalone word not linked: %q", got)
	}
}

func TestLinkerMatchesCaseAndAccentInsensitively(t *testing.T) {
	l := testLinker([2]string{"Le Kabuki Noyé", locationMentionPrefix + "loc-1"})
	// The model wrote it flat and unaccented; the label stays canonical.
	got := l.link("Rendez-vous au le kabuki noye, minuit.")
	want := "Rendez-vous au @[Le Kabuki Noyé](location:loc-1), minuit."
	if got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

func TestLinkerLeavesExistingMentionsAlone(t *testing.T) {
	l := testLinker(
		[2]string{"Rache Bartmoss", "npc-1"},
		[2]string{"Afterlife", locationMentionPrefix + "loc-1"},
	)
	// A chip is already there, and its label contains a linkable name. Nesting
	// one mention inside another's label would corrupt both.
	in := "@[Rache Bartmoss](npc-1) attend à l'Afterlife."
	want := "@[Rache Bartmoss](npc-1) attend à l'@[Afterlife](location:loc-1)."
	if got := l.link(in); got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

func TestLinkerSkipsTheEntityDescribingItself(t *testing.T) {
	l := testLinker(
		[2]string{"Rache Bartmoss", "npc-1"},
		[2]string{"Arasaka", factionMentionPrefix + "f-1"},
	)
	// Rache's own description: the chip pointing at himself is noise, the one
	// pointing at Arasaka is the point.
	got := l.linkExcept("Rache Bartmoss a fui Arasaka en 2020.", "npc-1")
	want := "Rache Bartmoss a fui @[Arasaka](faction:f-1) en 2020."
	if got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

func TestLinkerLeavesProseWithNothingToLinkUntouched(t *testing.T) {
	l := testLinker([2]string{"Rache Bartmoss", "npc-1"})
	for _, text := range []string{"", "Personne ne vient ce soir.", "  "} {
		if got := l.link(text); got != text {
			t.Errorf("link(%q) = %q, want unchanged", text, got)
		}
	}
	// An unnamed entity must never become a needle that matches everywhere.
	empty := testLinker([2]string{"", "npc-2"}, [2]string{"   ", "npc-3"})
	if got := empty.link("Une phrase ordinaire."); got != "Une phrase ordinaire." {
		t.Errorf("empty name matched: %q", got)
	}
}
