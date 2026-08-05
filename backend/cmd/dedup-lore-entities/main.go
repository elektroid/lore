// dedup-lore-entities finds game_lore_entities rows that are really the same
// real-world thing under different name spellings — the extractor names an
// entity however the source text happens to name it on a given page, so
// "Ortega", "Emilia Ortega" and "City Manager Ortega" fork into three rows
// instead of collapsing into one the way UpsertGameLoreEntity's exact-name
// match does for identical spellings.
//
// Two passes:
//  1. Exact match after normalizing case/punctuation/whitespace — merged
//     automatically, no LLM needed, since it's the same string modulo
//     formatting.
//  2. Word-containment candidates ("Ortega" is a whole word inside "Emilia
//     Ortega") — verified by an LLM call per cluster before merging, because
//     containment alone also catches real near-misses (a landmark named
//     after the district it sits in is NOT the district itself).
//
// Usage:
//
//	go run ./cmd/dedup-lore-entities -config lore.toml -game cyberpunk-red [-dry-run]
//
// Merging is done via db.MergeGameLoreEntities, which re-points relations at
// the surviving canonical row rather than dropping them — see the comment
// on that function for how it avoids the (from, relation, to) UNIQUE
// constraint and self-loops.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"time"

	"lore/internal/config"
	"lore/internal/db"
	"lore/internal/llm"
)

func main() {
	configPath := flag.String("config", "lore.toml", "path to the instance's lore.toml")
	gameSlug := flag.String("game", "", "slug of the game to dedup (required)")
	model := flag.String("model", "", "override the model from lore.toml, e.g. \"mistral-large-latest\"")
	baseURL := flag.String("base-url", "", "override the OpenAI-compatible base URL from lore.toml")
	apiKey := flag.String("api-key", os.Getenv("INDEX_SOURCEBOOK_API_KEY"), "override the API key from lore.toml (or set INDEX_SOURCEBOOK_API_KEY)")
	timeout := flag.Duration("timeout", 60*time.Second, "per-cluster HTTP timeout")
	maxCluster := flag.Int("max-cluster", 8, "skip (and report) a candidate cluster larger than this — likely a blocking false positive, not real duplicates")
	pace := flag.Duration("pace", 1200*time.Millisecond, "delay between LLM verification calls, to stay under the API's rate limit")
	dryRun := flag.Bool("dry-run", false, "print the merge plan without writing to the database")
	flag.Parse()

	if *gameSlug == "" {
		log.Fatal("usage: dedup-lore-entities -game <slug> [-dry-run]")
	}

	ctx := context.Background()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	database, err := db.Open(cfg.Database.Path)
	if err != nil {
		log.Fatalf("db open: %v", err)
	}
	defer database.Close()
	if err := db.Migrate(database); err != nil {
		log.Fatalf("db migrate: %v", err)
	}
	db.MigrateAlters(database)

	game, err := db.GetGameBySlug(ctx, database, *gameSlug)
	if err != nil {
		log.Fatalf("lookup game %q: %v", *gameSlug, err)
	}
	if game == nil {
		log.Fatalf("no game with slug %q", *gameSlug)
	}

	llmModel := cfg.LLM.Model
	if *model != "" {
		llmModel = *model
	}
	llmBaseURL := cfg.LLM.BaseURL
	if *baseURL != "" {
		llmBaseURL = *baseURL
	}
	llmAPIKey := cfg.LLM.APIKey
	if *apiKey != "" {
		llmAPIKey = *apiKey
	}
	client := llm.NewClient(llm.Config{
		BaseURL:   llmBaseURL,
		APIKey:    llmAPIKey,
		Model:     llmModel,
		MaxTokens: 500,
		Timeout:   *timeout,
	})

	entities, err := db.ListGameLoreEntities(ctx, database, game.ID)
	if err != nil {
		log.Fatalf("list entities: %v", err)
	}
	startCount := len(entities)
	log.Printf("loaded %d entities for %q", startCount, game.Name)

	// ── Pass 1: exact match after normalization ────────────────────────────
	byNorm := map[string][]db.GameLoreEntity{}
	for _, e := range entities {
		n := normalizeName(e.Name)
		byNorm[n] = append(byNorm[n], e)
	}
	survivors := make(map[string]db.GameLoreEntity, len(entities)) // id -> entity, post pass-1
	autoMerges := 0
	for _, group := range byNorm {
		canonical, dupes := pickCanonical(group)
		if len(dupes) > 0 {
			ids := make([]string, len(dupes))
			for i, d := range dupes {
				ids[i] = d.ID
			}
			log.Printf("exact match: keeping %q, merging %v", canonical.Name, namesOf(dupes))
			if !*dryRun {
				if err := db.MergeGameLoreEntities(ctx, database, canonical.ID, ids); err != nil {
					log.Printf("  merge failed: %v", err)
					survivors[canonical.ID] = canonical
					for _, d := range dupes {
						survivors[d.ID] = d
					}
					continue
				}
			}
			autoMerges += len(dupes)
		}
		survivors[canonical.ID] = canonical
	}
	log.Printf("pass 1 (exact match): %d automatic merges, %d entities remain", autoMerges, len(survivors))

	// ── Pass 2: word-containment candidates, LLM-verified ──────────────────
	list := make([]db.GameLoreEntity, 0, len(survivors))
	for _, e := range survivors {
		list = append(list, e)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })

	clusters := buildContainmentClusters(list)
	log.Printf("pass 2: %d candidate clusters from word-containment", len(clusters))

	llmMerges, llmSkipped, llmRejected := 0, 0, 0
	for i, cluster := range clusters {
		if i > 0 {
			time.Sleep(*pace)
		}
		if len(cluster) > *maxCluster {
			log.Printf("cluster too large (%d), skipping for manual review: %s", len(cluster), namesOf(cluster))
			llmSkipped++
			continue
		}
		verdict, err := verifyCluster(ctx, client, cluster)
		if err != nil {
			log.Printf("cluster %s: LLM verification failed: %v", namesOf(cluster), err)
			llmSkipped++
			continue
		}
		if !verdict.Same {
			log.Printf("cluster %s: LLM says NOT duplicates, leaving separate", namesOf(cluster))
			llmRejected++
			continue
		}
		excluded := map[int]bool{}
		for _, i := range verdict.Exclude {
			excluded[i] = true
		}
		var members []db.GameLoreEntity
		for i, e := range cluster {
			if !excluded[i] {
				members = append(members, e)
			}
		}
		if len(members) < 2 {
			log.Printf("cluster %s: fewer than 2 members left after exclusions, skipping", namesOf(cluster))
			continue
		}
		canonical, dupes := pickCanonical(members)
		ids := make([]string, len(dupes))
		for i, d := range dupes {
			ids[i] = d.ID
		}
		log.Printf("containment match: keeping %q, merging %v (reason: %s)", canonical.Name, namesOf(dupes), verdict.Reason)
		if !*dryRun {
			if err := db.MergeGameLoreEntities(ctx, database, canonical.ID, ids); err != nil {
				log.Printf("  merge failed: %v", err)
				continue
			}
		}
		llmMerges += len(dupes)
	}

	log.Printf("done: pass1=%d auto-merges, pass2=%d llm-merges, %d clusters rejected by LLM, %d clusters skipped (too large/error)",
		autoMerges, llmMerges, llmRejected, llmSkipped)
	fmt.Printf("summary: %d entities before, %d merges total, %d entities after%s\n",
		startCount, autoMerges+llmMerges, startCount-autoMerges-llmMerges,
		map[bool]string{true: " (dry run, nothing written)"}[*dryRun])
}

func namesOf(entities []db.GameLoreEntity) []string {
	names := make([]string, len(entities))
	for i, e := range entities {
		names[i] = e.Name
	}
	return names
}

// pickCanonical picks the longest original name (most likely to be the
// fullest, most specific form — "Emilia Ortega" over "Ortega") as the
// surviving row, tie-broken by earliest created_at (the first time the
// extractor found this entity at all). Returns it plus everything else in
// the group as "dupes" to merge away.
func pickCanonical(group []db.GameLoreEntity) (db.GameLoreEntity, []db.GameLoreEntity) {
	best := group[0]
	for _, e := range group[1:] {
		if len(e.Name) > len(best.Name) || (len(e.Name) == len(best.Name) && e.CreatedAt < best.CreatedAt) {
			best = e
		}
	}
	var dupes []db.GameLoreEntity
	for _, e := range group {
		if e.ID != best.ID {
			dupes = append(dupes, e)
		}
	}
	return best, dupes
}

// normalizeName lowercases, strips punctuation that's cosmetic rather than
// meaningful ("Chamber of Commerce" vs "Chamber of Commerce,"), and collapses
// whitespace — so pass 1 catches formatting noise, not just literal
// identical strings.
var punctuationStripper = strings.NewReplacer(
	"'", "", "’", "", "\"", "", "“", "", "”", "",
	".", "", ",", "", "!", "", "?", "", ":", "", ";", "",
	"(", "", ")", "", "#", "",
)

func normalizeName(s string) string {
	s = punctuationStripper.Replace(strings.ToLower(s))
	return strings.Join(strings.Fields(s), " ")
}

// buildContainmentClusters unions entities whose normalized name is a whole
// -word substring of another's (e.g. "ortega" inside "emilia ortega"), using
// union-find so a 3-way chain ("Ortega" ⊂ "Emilia Ortega", "Ortega" ⊂ "City
// Manager Ortega") collapses into a single 3-member cluster instead of two
// overlapping pairs. A four-character floor on the shorter name keeps
// one-and-two-letter tokens from creating noise clusters; the LLM check
// downstream is the real precision filter, not this blocking step.
func buildContainmentClusters(entities []db.GameLoreEntity) [][]db.GameLoreEntity {
	n := len(entities)
	normalized := make([]string, n)
	for i, e := range entities {
		normalized[i] = normalizeName(e.Name)
	}

	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		if parent[x] != x {
			parent[x] = find(parent[x])
		}
		return parent[x]
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra != rb {
			parent[ra] = rb
		}
	}

	for i := 0; i < n; i++ {
		if len(normalized[i]) < 4 {
			continue
		}
		for j := i + 1; j < n; j++ {
			a, b := normalized[i], normalized[j]
			if a == b {
				continue // pass 1 already handled exact matches
			}
			shorter, longer := a, b
			if len(a) > len(b) {
				shorter, longer = b, a
			}
			if len(shorter) < 4 {
				continue
			}
			if strings.Contains(" "+longer+" ", " "+shorter+" ") {
				union(i, j)
			}
		}
	}

	groups := map[int][]int{}
	for i := 0; i < n; i++ {
		r := find(i)
		groups[r] = append(groups[r], i)
	}
	var clusters [][]db.GameLoreEntity
	for _, idxs := range groups {
		if len(idxs) < 2 {
			continue
		}
		cluster := make([]db.GameLoreEntity, len(idxs))
		for k, idx := range idxs {
			cluster[k] = entities[idx]
		}
		clusters = append(clusters, cluster)
	}
	return clusters
}

type clusterVerdict struct {
	Same    bool   `json:"same"`
	Exclude []int  `json:"exclude"`
	Reason  string `json:"reason"`
}

// verifyCluster asks the LLM whether every entity in the cluster names the
// same real thing. Kept deliberately strict in the prompt: containment
// blocking also catches real near-misses, like a landmark named after the
// district it's in, which is a different entity from the district itself.
func verifyCluster(ctx context.Context, client *llm.Client, cluster []db.GameLoreEntity) (clusterVerdict, error) {
	var sb strings.Builder
	for i, e := range cluster {
		summary := e.Summary
		if summary == "" {
			summary = e.Excerpt
		}
		if len(summary) > 200 {
			summary = summary[:200]
		}
		fmt.Fprintf(&sb, "%d. [%s] %q — %s\n", i, e.Kind, e.Name, summary)
	}

	sysPrompt := `You deduplicate entities extracted from a tabletop RPG sourcebook.
You are given a numbered list of entity names that share a common word, along with their kind and a short description.
Decide whether they all refer to the EXACT SAME real named entity in the setting, just referred to inconsistently — e.g. "Ortega", "Emilia Ortega" and "City Manager Ortega" are the same NPC.

Answer false for entities that are merely RELATED rather than IDENTICAL. In particular:
- A person is NEVER the same entity as a building, ship, vehicle, or organization named after or owned by them. "Howard Wong" (a person) and "Howard Wong Building" (a building) are two different entities, even though the text says the building is named after him — same for "Nostradamus" and "Nostradamus' Warehouse".
- A district/region is NEVER the same entity as one specific landmark, shop, or event inside it, even if it borrows the district's name.
- Two different characters, gangs, or vehicles can coincidentally share a word (e.g. a surname, or a faction name reused as a title) without being the same entity.
- If the entries have different "kind" values, treat that as a strong signal they are NOT the same entity, UNLESS their descriptions make clear they are literally the same object just classified inconsistently (not two related objects of different kinds).
When in doubt, answer false — a missed merge is a minor inconvenience, a wrong merge silently deletes a distinct entity's data.

Respond with ONLY valid JSON, no markdown, no explanation:
{"same": true or false, "exclude": [indices that do NOT belong if mostly true, else []], "reason": "one short sentence"}`

	var result clusterVerdict
	var err error
	for attempt := 0; attempt < 4; attempt++ {
		result, err = llm.Decode[clusterVerdict](ctx, client, sysPrompt, sb.String())
		if err == nil || !strings.Contains(err.Error(), "429") {
			break
		}
		time.Sleep(time.Duration(attempt+1) * 3 * time.Second)
	}
	return result, err
}
