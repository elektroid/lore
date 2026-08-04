// index-sourcebook extracts structured lore (locations, factions, NPC
// archetypes, ...) from a game system's sourcebook PDF into
// game_lore_entities, so every campaign using that game can draw on it. See
// the comment on that table in schema.sql for what does and doesn't get
// stored, and why.
//
// It is a standalone operator tool, not an HTTP endpoint on purpose: this is
// a long batch job (tens of minutes to several hours for a full sourcebook,
// even on a fast local model — see the reasoning-effort discussion below),
// run by whoever administers the instance when they drop in a new book, not
// something triggered through the app by a gamemaster.
//
// Usage:
//
//	go run ./cmd/index-sourcebook \
//	  -config lore.toml \
//	  -game cyberpunk-red \
//	  -file "../external-material/cyberpunk-red/RTG-CPR-Night_City_2045-150dpi.pdf" \
//	  -source-title "Night City 2045" \
//	  -pages 80-180
//
// Re-running with the same -source-title is safe: UpsertGameLoreEntity
// matches on (game, source, kind, name) and updates in place rather than
// piling up duplicates, whether that's a deliberate re-index or just the same
// entity turning up twice because of the overlap between chunks.
package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"lore/internal/config"
	"lore/internal/db"
	"lore/internal/llm"
)

// allowedKinds mirrors the vocabulary the extraction prompt is told to use.
// Anything else the model returns gets logged and skipped rather than stored
// with a kind nothing in the app expects.
var allowedKinds = map[string]bool{
	"district":      true,
	"location":      true,
	"faction":       true,
	"npc_archetype": true,
	"item":          true,
}

// defaultTagHints steers tag vocabulary toward Cyberpunk Red's own role
// names and common setting vibes, so "corpo" doesn't come out as "corp" on
// one entity and "corporate" on the next. Override with -tags for a
// different game system.
const defaultTagHints = "Rockerboy, Solo, Netrunner, Tech, Medtech, Media, Exec, Lawman, Fixer, Nomad, corpo, gang, street"

func main() {
	configPath := flag.String("config", "lore.toml", "path to the instance's lore.toml")
	gameSlug := flag.String("game", "", "slug of the game this sourcebook belongs to (required)")
	file := flag.String("file", "", "path to the sourcebook PDF (required)")
	sourceTitle := flag.String("source-title", "", "human label for citations, e.g. \"Night City 2045\" (required)")
	pagesFlag := flag.String("pages", "", "page range to index, e.g. \"80-180\" (default: whole document)")
	chunkPages := flag.Int("chunk", 2, "pages per LLM call")
	overlapPages := flag.Int("overlap", 1, "page overlap between consecutive chunks")
	effort := flag.String("effort", "medium", "reasoning effort: low, medium, or high — see the comment below")
	model := flag.String("model", "", "override the model from lore.toml, e.g. \"mistral-medium-latest\" (default: whatever lore.toml's [llm] section says)")
	baseURL := flag.String("base-url", "", "override the OpenAI-compatible base URL from lore.toml, e.g. \"https://api.mistral.ai/v1\"")
	apiKey := flag.String("api-key", os.Getenv("INDEX_SOURCEBOOK_API_KEY"), "override the API key from lore.toml (or set INDEX_SOURCEBOOK_API_KEY to avoid it showing up in argv/history)")
	tagHints := flag.String("tags", defaultTagHints, "vocabulary hints for the tags field")
	maxTokens := flag.Int("max-tokens", 8000, "completion token budget — a dense chunk at medium effort can run into this")
	timeout := flag.Duration("timeout", 8*time.Minute, "per-chunk HTTP timeout — real local-model latency is uneven, pad generously")
	flag.Parse()

	if *gameSlug == "" || *file == "" || *sourceTitle == "" {
		log.Fatal("usage: index-sourcebook -game <slug> -file <path.pdf> -source-title <title> [-pages 80-180]")
	}
	if *overlapPages >= *chunkPages {
		log.Fatalf("-overlap (%d) must be smaller than -chunk (%d)", *overlapPages, *chunkPages)
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
		log.Fatalf("no game with slug %q — create it first", *gameSlug)
	}

	from, to, err := resolvePageRange(*pagesFlag, *file)
	if err != nil {
		log.Fatalf("page range: %v", err)
	}

	// gpt-oss (and reasoning models generally) will spend its whole token
	// budget "thinking" and never emit the JSON answer unless told to keep
	// it brief — confirmed empirically: unconstrained effort on a two-page
	// chunk didn't finish inside 8000 tokens / several minutes. "low" effort
	// finishes in ~30s but visibly under-extracts (skipped the district
	// itself and three named factions in testing). "medium" found everything
	// in one test but took 2-5+ minutes and occasionally ran past an 8000
	// token / 5 minute budget on a dense chunk in another — real local-model
	// latency is uneven (model reload after idle, content-dependent reasoning
	// length), hence -max-tokens and -timeout being generous and tunable
	// rather than hardcoded tight.
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
		BaseURL:         llmBaseURL,
		APIKey:          llmAPIKey,
		Model:           llmModel,
		MaxTokens:       *maxTokens,
		ReasoningEffort: *effort,
		Timeout:         *timeout,
	})

	stride := *chunkPages - *overlapPages
	totalEntities := 0
	totalRelations := 0
	totalChunks := 0

	for start := from; start <= to; start += stride {
		end := start + *chunkPages - 1
		if end > to {
			end = to
		}

		text, err := extractPages(*file, start, end)
		if err != nil {
			log.Printf("pages %d-%d: pdftotext failed: %v", start, end, err)
			continue
		}
		if len(strings.TrimSpace(text)) < 40 {
			log.Printf("pages %d-%d: skipped (blank or image-only)", start, end)
			if end >= to {
				break
			}
			continue
		}

		t0 := time.Now()
		result, err := llm.Decode[extractionResult](ctx, client,
			systemPrompt(*effort, *tagHints), userPrompt(*sourceTitle, start, end, text))
		if err != nil {
			log.Printf("pages %d-%d: extraction failed: %v", start, end, err)
			if end >= to {
				break
			}
			continue
		}

		names := make([]string, 0, len(result.Entities))
		chunkIDs := make(map[string]string, len(result.Entities)) // lower(name) -> id, this chunk only
		for _, e := range result.Entities {
			if e.Name == "" {
				continue
			}
			if !allowedKinds[e.Kind] {
				log.Printf("pages %d-%d: skipping %q — unknown kind %q", start, end, e.Name, e.Kind)
				continue
			}
			stored, err := db.UpsertGameLoreEntity(ctx, database, db.CreateGameLoreEntityParams{
				GameID:      game.ID,
				Kind:        e.Kind,
				Name:        e.Name,
				Tags:        e.Tags,
				Summary:     e.Summary,
				Excerpt:     e.Excerpt,
				SourceTitle: *sourceTitle,
				SourcePage:  start,
			})
			if err != nil {
				log.Printf("pages %d-%d: storing %q failed: %v", start, end, e.Name, err)
				continue
			}
			chunkIDs[strings.ToLower(e.Name)] = stored.ID
			names = append(names, e.Name)
			totalEntities++
		}

		chunkRelations := 0
		for _, r := range result.Relations {
			if r.From == "" || r.Relation == "" || r.To == "" {
				continue
			}
			fromID, err := resolveEntityID(ctx, database, game.ID, *sourceTitle, chunkIDs, r.From)
			if err != nil {
				log.Printf("pages %d-%d: resolving relation %q %s %q failed: %v", start, end, r.From, r.Relation, r.To, err)
				continue
			}
			toID, err := resolveEntityID(ctx, database, game.ID, *sourceTitle, chunkIDs, r.To)
			if err != nil {
				log.Printf("pages %d-%d: resolving relation %q %s %q failed: %v", start, end, r.From, r.Relation, r.To, err)
				continue
			}
			if fromID == "" || toID == "" {
				log.Printf("pages %d-%d: skipping relation %q %s %q — endpoint not found among stored entities", start, end, r.From, r.Relation, r.To)
				continue
			}
			if err := db.UpsertGameLoreEntityRelation(ctx, database, db.CreateGameLoreEntityRelationParams{
				GameID:       game.ID,
				FromEntityID: fromID,
				ToEntityID:   toID,
				Relation:     r.Relation,
				SourceTitle:  *sourceTitle,
				SourcePage:   start,
			}); err != nil {
				log.Printf("pages %d-%d: storing relation %q %s %q failed: %v", start, end, r.From, r.Relation, r.To, err)
				continue
			}
			chunkRelations++
			totalRelations++
		}

		totalChunks++
		log.Printf("pages %d-%d: %d entities, %d relations (%s) [%s]",
			start, end, len(names), chunkRelations, strings.Join(names, ", "), time.Since(t0).Round(time.Second))

		if end >= to {
			break
		}
	}

	fmt.Printf("done: %d chunks, %d entities, %d relations upserted for %q (%s)\n",
		totalChunks, totalEntities, totalRelations, *sourceTitle, game.Name)
}

// resolveEntityID turns a relation endpoint's plain name into an entity ID:
// first against entities upserted earlier in this same chunk (chunkIDs,
// keyed lower-case), then against the database for an entity a previous
// chunk already stored. Returns "" with no error if the name matches
// nothing — the caller logs and skips rather than treating that as fatal,
// since the model can name an entity in a relation that wasn't itself
// judged notable enough to extract as its own row.
func resolveEntityID(ctx context.Context, database *sql.DB, gameID, sourceTitle string, chunkIDs map[string]string, name string) (string, error) {
	if id, ok := chunkIDs[strings.ToLower(name)]; ok {
		return id, nil
	}
	return db.FindGameLoreEntityIDByName(ctx, database, gameID, sourceTitle, name)
}

type extractedEntity struct {
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Tags    string `json:"tags"`
	Summary string `json:"summary"`
	Excerpt string `json:"excerpt"`
}

// extractedRelation is a typed link between two entities named elsewhere in
// the same result (or, thanks to the DB fallback lookup in the processing
// loop, an entity stored by an earlier chunk). From/To are plain names, not
// IDs — the model only ever sees text.
type extractedRelation struct {
	From     string `json:"from"`
	Relation string `json:"relation"`
	To       string `json:"to"`
}

type extractionResult struct {
	Entities  []extractedEntity   `json:"entities"`
	Relations []extractedRelation `json:"relations"`
}

func systemPrompt(effort, tagHints string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Reasoning: %s\n", effort)
	sb.WriteString(`Tu extrais des faits structurés d'un supplément de jeu de rôle (gazetteer), à partir d'un extrait de texte donné.
Tu réponds UNIQUEMENT avec du JSON valide, sans markdown, sans explication, sans aucun texte avant ou après le JSON.

Règles strictes :
- N'extrais QUE ce qui est explicitement nommé et décrit dans le texte fourni. N'invente rien et ne complète pas avec des connaissances que tu pourrais avoir par ailleurs sur cet univers.
- Ignore les éléments de navigation (numéros de page isolés, onglets répétés comme « Facts (page 9) », noms de chapitres en marge, cartes).
- Ignore les blocs de statistiques de combat purs (HP, INIT, armure, compétences chiffrées) sauf pour noter le rôle du personnage dans les tags.
- kind doit être l'un de : district, location, faction, npc_archetype, item.
- tags : mots-clés courts en anglais, minuscules, séparés par des espaces (rôles, ambiance, affiliation).`)
	fmt.Fprintf(&sb, " Vocabulaire à privilégier si pertinent : %s.\n", tagHints)
	sb.WriteString(`- summary : une ou deux phrases en français, une paraphrase — pas une citation.
- excerpt : recopie 2 à 4 phrases du texte source qui décrivent cet élément, sans les modifier.
- Si rien de pertinent n'apparaît dans le texte, réponds avec une liste vide.

Extrais aussi les relations explicites entre deux éléments nommés (personnage, faction, lieu, district, objet) :
- from / to : les noms exacts des deux éléments, tels qu'utilisés dans "entities" (l'élément peut avoir été extrait dans un passage précédent, pas forcément dans ce texte-ci).
- relation : un court verbe ou une courte expression en anglais, en snake_case, minuscules (ex : "manages", "rival_of", "member_of", "leads", "located_in", "reports_to", "allied_with", "hostile_to"). Choisis le sens le plus naturel ; n'invente pas de relation qui ne serait pas clairement énoncée dans le texte.
- N'extrais que des relations explicitement affirmées par le texte, jamais déduites ou supposées.

Réponds avec un objet JSON de la forme :
{"entities": [{"kind": "...", "name": "...", "tags": "...", "summary": "...", "excerpt": "..."}],
 "relations": [{"from": "...", "relation": "...", "to": "..."}]}`)
	return sb.String()
}

func userPrompt(sourceTitle string, from, to int, text string) string {
	return fmt.Sprintf("Titre de la source : %s\nPages : %d-%d\n\nTexte source :\n%s\n", sourceTitle, from, to, text)
}

// extractPages runs pdftotext over [from, to]. Plain output, deliberately no
// -layout: tested against the actual Night City 2045 PDF, -layout scrambles
// reading order (sidebar callouts land mid-paragraph) while the default mode
// reads correctly.
func extractPages(file string, from, to int) (string, error) {
	out, err := exec.Command("pdftotext", "-f", strconv.Itoa(from), "-l", strconv.Itoa(to), file, "-").Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

var pdfinfoPages = regexp.MustCompile(`(?m)^Pages:\s*(\d+)`)

// resolvePageRange parses "-pages 80-180", or falls back to the whole
// document via pdfinfo when the flag is empty.
func resolvePageRange(pagesFlag, file string) (from, to int, err error) {
	if pagesFlag != "" {
		parts := strings.SplitN(pagesFlag, "-", 2)
		if len(parts) != 2 {
			return 0, 0, fmt.Errorf("expected \"start-end\", got %q", pagesFlag)
		}
		from, err = strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			return 0, 0, err
		}
		to, err = strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			return 0, 0, err
		}
		return from, to, nil
	}

	out, err := exec.Command("pdfinfo", file).Output()
	if err != nil {
		return 0, 0, fmt.Errorf("pdfinfo: %w", err)
	}
	m := pdfinfoPages.FindSubmatch(out)
	if m == nil {
		return 0, 0, fmt.Errorf("could not find page count in pdfinfo output")
	}
	to, err = strconv.Atoi(string(m[1]))
	if err != nil {
		return 0, 0, err
	}
	return 1, to, nil
}
