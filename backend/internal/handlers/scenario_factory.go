package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
	"lore/internal/factory"
	"lore/internal/llm"
)

// ScenarioFactoryHandler turns a GM's brief into a full scenario draft, and a
// reviewed draft into a real scenario. See docs/scenario-factory.md.
type ScenarioFactoryHandler struct {
	db     *sql.DB
	encKey string
}

// Token budgets: the outline carries the whole cast plus the beat sheet in one
// response, an expansion carries three fields.
const (
	outlineMaxTokens = 4000
	expandMaxTokens  = 600

	minScenes     = 3
	maxScenes     = 12
	defaultScenes = 6
)

// ── LLM plumbing ──────────────────────────────────────────────────────────────

// promptContext gathers the world the model writes into: the campaign's system
// and genre, the names it may reuse rather than duplicate, and — when
// queryText matches anything — indexed sourcebook facts to ground the
// generation in (see db.SearchGameLoreEntities). queryText is the GM's brief
// for a fresh outline, or a scene's title+summary when expanding one; pass
// "" to skip lore grounding (e.g. nothing relevant on hand yet).
//
// Names only, never descriptions — which is also why no mention ref can leak
// into a factory prompt the way it could into a synopsis one.
func (h *ScenarioFactoryHandler) promptContext(ctx context.Context, campaign *db.Campaign, queryText string) factory.PromptContext {
	pc := factory.PromptContext{
		GameName: campaign.GameName,
		Genre:    campaign.Genre,
	}
	if npcs, err := db.ListCampaignNPCs(ctx, h.db, campaign.ID); err == nil {
		for _, n := range npcs {
			if n.Name != "" {
				pc.ExistingNPCs = append(pc.ExistingNPCs, n.Name)
			}
		}
	}
	if locs, err := db.ListCampaignLocations(ctx, h.db, campaign.ID); err == nil {
		for _, l := range locs {
			if l.Name != "" {
				pc.ExistingLocations = append(pc.ExistingLocations, l.Name)
			}
		}
	}
	if facs, err := db.ListCampaignFactions(ctx, h.db, campaign.ID); err == nil {
		for _, f := range facs {
			if f.Name != "" {
				pc.ExistingFactions = append(pc.ExistingFactions, f.Name)
			}
		}
	}
	if campaign.GameID != "" && queryText != "" {
		// The keyword search is a cheap heuristic (see SearchGameLoreEntities),
		// not precise ranking — the entity that should actually be #1 for a
		// given brief sometimes lands 4th. Casting a wider net for the
		// name-reuse lists below costs nothing (they're just names), so pull
		// more than the loreFactsLimit actually rendered as full facts.
		const loreFactsLimit = 6
		const reuseNamesLimit = 15
		entities, err := db.SearchGameLoreEntities(ctx, h.db, campaign.GameID, queryText, reuseNamesLimit)
		if err == nil {
			existingNames := map[string]bool{}
			for _, n := range pc.ExistingNPCs {
				existingNames[n] = true
			}
			for _, n := range pc.ExistingLocations {
				existingNames[n] = true
			}
			for _, n := range pc.ExistingFactions {
				existingNames[n] = true
			}
			for i, e := range entities {
				if i < loreFactsLimit {
					summary := e.Summary
					if summary == "" {
						summary = e.Excerpt
					}
					fact := fmt.Sprintf("[%s] %s : %s", e.Kind, e.Name, summary)
					if outgoing, _, err := db.ListGameLoreEntityRelationsFor(ctx, h.db, e.ID); err == nil && len(outgoing) > 0 {
						n := len(outgoing)
						if n > 3 {
							n = 3
						}
						rels := make([]string, n)
						for i, r := range outgoing[:n] {
							rels[i] = fmt.Sprintf("%s %s", r.Relation, r.Name)
						}
						fact += fmt.Sprintf(" (%s)", strings.Join(rels, ", "))
					}
					pc.LoreFacts = append(pc.LoreFacts, fact)
				}

				// Beyond the narrative-facts block, a matched district/
				// location/faction/npc also earns a spot in the SAME
				// "reuse this exact name" list as the campaign's own
				// entities — that instruction is what stopped the model
				// from inventing "Université de Night City" instead of
				// using the sourcebook's own "University District" once
				// it actually got surfaced. LoreFacts alone, phrased as
				// background to "stay consistent with", wasn't a strong
				// enough signal to prevent that.
				if existingNames[e.Name] {
					continue
				}
				switch e.Kind {
				case "district", "location":
					pc.ExistingLocations = append(pc.ExistingLocations, e.Name)
					existingNames[e.Name] = true
				case "faction":
					pc.ExistingFactions = append(pc.ExistingFactions, e.Name)
					existingNames[e.Name] = true
				case "npc_archetype":
					pc.ExistingNPCs = append(pc.ExistingNPCs, e.Name)
					existingNames[e.Name] = true
				}
			}
		}
	}
	return pc
}

func (h *ScenarioFactoryHandler) client(ctx context.Context, maxTokens int) (*llm.Client, error) {
	cfg, err := loadLLMConfig(ctx, h.db, h.encKey)
	if err != nil || cfg.BaseURL == "" {
		return nil, fmt.Errorf("configuration LLM manquante — configurez-la dans les Paramètres")
	}
	cfg.MaxTokens = maxTokens
	return llm.NewClient(cfg), nil
}

// draftCampaign resolves a draft and its campaign in one step.
func (h *ScenarioFactoryHandler) draftCampaign(r *http.Request) (*db.ScenarioDraft, *db.Campaign, error) {
	draft, err := db.GetScenarioDraft(r.Context(), h.db, chi.URLParam(r, "draftId"))
	if err != nil || draft == nil {
		return nil, nil, fmt.Errorf("brouillon introuvable")
	}
	campaign, err := db.GetCampaign(r.Context(), h.db, draft.CampaignID)
	if err != nil || campaign == nil {
		return nil, nil, fmt.Errorf("campagne introuvable")
	}
	return draft, campaign, nil
}

// outline runs the single call that invents the whole story, and returns a
// normalised proposal with everything included.
func (h *ScenarioFactoryHandler) outline(ctx context.Context, campaign *db.Campaign, brief string, sceneCount int, instruction string) (factory.Proposal, error) {
	client, err := h.client(ctx, outlineMaxTokens)
	if err != nil {
		return factory.Proposal{}, err
	}
	sysPrompt := factory.SystemPrompt(h.promptContext(ctx, campaign, brief))
	userPrompt := factory.OutlinePrompt(brief, sceneCount, instruction)

	proposal, err := llm.Decode[factory.Proposal](ctx, client, sysPrompt, userPrompt)
	if err != nil {
		return factory.Proposal{}, fmt.Errorf("erreur LLM : %w", err)
	}
	factory.Normalize(&proposal)
	factory.SetAllIncluded(&proposal)
	if len(proposal.Scenes) == 0 {
		return factory.Proposal{}, fmt.Errorf("le LLM n'a proposé aucune scène — reformulez l'idée de départ")
	}
	return proposal, nil
}

// ── Draft CRUD ────────────────────────────────────────────────────────────────

func (h *ScenarioFactoryHandler) List(w http.ResponseWriter, r *http.Request) {
	drafts, err := db.ListScenarioDrafts(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, drafts)
}

func (h *ScenarioFactoryHandler) Get(w http.ResponseWriter, r *http.Request) {
	draft, err := db.GetScenarioDraft(r.Context(), h.db, chi.URLParam(r, "draftId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if draft == nil {
		writeError(w, http.StatusNotFound, "brouillon introuvable")
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

func (h *ScenarioFactoryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if err := db.DeleteScenarioDraft(r.Context(), h.db, chi.URLParam(r, "draftId")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Update saves the GM's edits: the title and the proposal, including which
// items they ticked off. Include flags come from the client as-is.
func (h *ScenarioFactoryHandler) Update(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title    string           `json:"title"`
		Proposal factory.Proposal `json:"proposal"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}
	factory.Normalize(&body.Proposal)

	draft, err := db.UpdateScenarioDraft(r.Context(), h.db, chi.URLParam(r, "draftId"),
		strings.TrimSpace(body.Title), body.Proposal.JSON())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if draft == nil {
		writeError(w, http.StatusNotFound, "brouillon introuvable")
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

// ── Stage 1 — outline ─────────────────────────────────────────────────────────

// Create is the factory's entry point: brief in, whole draft out.
func (h *ScenarioFactoryHandler) Create(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")

	var body struct {
		Brief      string `json:"brief"`
		SceneCount int    `json:"scene_count"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corps de requête invalide")
		return
	}
	body.Brief = strings.TrimSpace(body.Brief)
	if body.Brief == "" {
		writeError(w, http.StatusBadRequest, "décrivez l'idée de départ du scénario")
		return
	}

	campaign, err := db.GetCampaign(r.Context(), h.db, campaignID)
	if err != nil || campaign == nil {
		writeError(w, http.StatusNotFound, "campagne introuvable")
		return
	}

	proposal, err := h.outline(r.Context(), campaign, body.Brief, clampScenes(body.SceneCount), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	draft, err := db.CreateScenarioDraft(r.Context(), h.db, campaignID, proposal.Title, body.Brief, proposal.JSON())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, draft)
}

// Regenerate re-runs the outline on the same brief, optionally steered. The
// previous proposal is replaced wholesale — that is the point of asking again.
func (h *ScenarioFactoryHandler) Regenerate(w http.ResponseWriter, r *http.Request) {
	draft, campaign, err := h.draftCampaign(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	var body struct {
		Instruction string `json:"instruction"`
		SceneCount  int    `json:"scene_count"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	sceneCount := body.SceneCount
	if sceneCount == 0 {
		sceneCount = len(factory.Parse(draft.Proposal).Scenes)
	}

	proposal, err := h.outline(r.Context(), campaign, draft.Brief, clampScenes(sceneCount), body.Instruction)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	updated, err := db.UpdateScenarioDraft(r.Context(), h.db, draft.ID, proposal.Title, proposal.JSON())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── Stage 2 — expand one beat ─────────────────────────────────────────────────

type expandResult struct {
	Description string `json:"description"`
	Outcome     string `json:"outcome"`
	Notes       string `json:"notes"`
}

// ExpandScene fleshes out a single beat.
//
// Two modes, because the two callers want different things. The bulk pass over
// a fresh outline wants the text written straight into the draft, so it can
// loop one call per beat and show progress. Re-expanding a beat that already
// has text wants the suggestion handed back unsaved, for the field-by-field
// review — that is the LLMSuggestionReview contract, and it is the same
// question the rest of the app asks before overwriting the GM's words.
func (h *ScenarioFactoryHandler) ExpandScene(w http.ResponseWriter, r *http.Request) {
	draft, campaign, err := h.draftCampaign(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	var body struct {
		Review      bool              `json:"review"`
		Fields      []string          `json:"fields"`
		Instruction string            `json:"instruction"`
		Current     map[string]string `json:"current"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	proposal := factory.Parse(draft.Proposal)
	scene := proposal.FindScene(chi.URLParam(r, "sceneRef"))
	if scene == nil {
		writeError(w, http.StatusNotFound, "scène introuvable dans ce brouillon")
		return
	}

	// Let the live editor content win over what the autosave has persisted.
	if v, ok := body.Current["description"]; ok {
		scene.Description = v
	}
	if v, ok := body.Current["outcome"]; ok {
		scene.Outcome = v
	}
	if v, ok := body.Current["notes"]; ok {
		scene.Notes = v
	}

	client, err := h.client(r.Context(), expandMaxTokens)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	sysPrompt := factory.SystemPrompt(h.promptContext(r.Context(), campaign, scene.Title+" "+scene.Summary))
	userPrompt := factory.ExpandPrompt(&proposal, scene, body.Instruction, body.Fields)

	result, err := llm.Decode[expandResult](r.Context(), client, sysPrompt, userPrompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}

	if body.Review {
		writeJSON(w, http.StatusOK, result)
		return
	}

	scene.Description = strings.TrimSpace(result.Description)
	scene.Outcome = strings.TrimSpace(result.Outcome)
	scene.Notes = strings.TrimSpace(result.Notes)
	scene.Expanded = true

	updated, err := db.UpdateScenarioDraft(r.Context(), h.db, draft.ID, draft.Title, proposal.JSON())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── Commit ────────────────────────────────────────────────────────────────────

// Commit materialises the draft: a scenario, its synopsis hook, every included
// entity, every scene, and the links between them. No LLM call — what the GM
// read is exactly what lands.
func (h *ScenarioFactoryHandler) Commit(w http.ResponseWriter, r *http.Request) {
	draft, campaign, err := h.draftCampaign(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if draft.Status == "committed" {
		writeError(w, http.StatusConflict, "ce brouillon a déjà été transformé en scénario")
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	proposal := factory.Parse(draft.Proposal)
	name := firstNonEmpty(strings.TrimSpace(body.Name), draft.Title, proposal.Title, "Scénario sans titre")

	scenario, err := db.CreateScenario(r.Context(), h.db, db.CreateScenarioParams{
		CampaignID: campaign.ID,
		Name:       name,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := h.materialise(r.Context(), campaign.ID, scenario.ID, proposal); err != nil {
		// The scenario is already half-built; deleting it would throw away
		// whatever did land, so keep it and tell the GM where to look. The
		// draft stays uncommitted, so nothing here is lost.
		writeError(w, http.StatusInternalServerError, fmt.Sprintf(
			"le scénario « %s » a été créé mais n'a pas pu être rempli entièrement : %v", name, err))
		return
	}

	if _, err := db.MarkScenarioDraftCommitted(r.Context(), h.db, draft.ID, scenario.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, scenario)
}

// materialise writes the proposal into the campaign, in dependency order so
// every link target exists before the link is written.
//
// The prose is written last, after every entity has an id, because that is what
// lets the names in it become real mentions — see mention_linker.go. The pitch
// used to be written first; it now waits with the scenes for the same reason, so
// a commit that fails half way leaves an empty synopsis rather than an unlinked
// one. Acceptable: the draft stays uncommitted and still holds the pitch.
func (h *ScenarioFactoryHandler) materialise(ctx context.Context, campaignID, scenarioID string, p factory.Proposal) error {
	var created createdEntities

	// Factions — reuse an existing row when the name already exists.
	existingFactions, err := db.ListCampaignFactions(ctx, h.db, campaignID)
	if err != nil {
		return err
	}
	factionByName := map[string]string{}
	for _, f := range existingFactions {
		factionByName[matchKey(f.Name)] = f.ID
	}
	factionIDs := map[string]string{}
	for _, f := range p.Factions {
		if !bool(f.Include) {
			continue
		}
		id, ok := factionByName[matchKey(f.Name)]
		if !ok {
			row, err := db.CreateCampaignFaction(ctx, h.db, campaignID, f.Name, f.Type, f.Description, f.Motivation)
			if err != nil {
				return err
			}
			id = row.ID
			factionByName[matchKey(f.Name)] = id
			created.factions = append(created.factions, id)
		}
		factionIDs[f.Ref] = id
		if err := db.AddSynopsisFaction(ctx, h.db, scenarioID, id); err != nil {
			return err
		}
	}

	// Locations.
	existingLocations, err := db.ListCampaignLocations(ctx, h.db, campaignID)
	if err != nil {
		return err
	}
	locationByName := map[string]string{}
	for _, l := range existingLocations {
		locationByName[matchKey(l.Name)] = l.ID
	}
	locationIDs := map[string]string{}
	for _, l := range p.Locations {
		if !bool(l.Include) {
			continue
		}
		id, ok := locationByName[matchKey(l.Name)]
		if !ok {
			row, err := db.CreateCampaignLocation(ctx, h.db, campaignID, l.Name, l.City, l.District, l.Description, l.Atmosphere)
			if err != nil {
				return err
			}
			id = row.ID
			locationByName[matchKey(l.Name)] = id
			created.locations = append(created.locations, id)
		}
		locationIDs[l.Ref] = id
	}

	// NPCs, plus their faction membership.
	existingNPCs, err := db.ListCampaignNPCs(ctx, h.db, campaignID)
	if err != nil {
		return err
	}
	npcByName := map[string]string{}
	for _, n := range existingNPCs {
		npcByName[matchKey(n.Name)] = n.ID
	}
	npcIDs := map[string]string{}
	for i, n := range p.NPCs {
		if !bool(n.Include) {
			continue
		}
		id, ok := npcByName[matchKey(n.Name)]
		if !ok {
			row, err := db.CreateCampaignNPC(ctx, h.db, campaignID, n.Name, n.Role, n.Description, n.Quote, n.Motivation)
			if err != nil {
				return err
			}
			id = row.ID
			npcByName[matchKey(n.Name)] = id
			created.npcs = append(created.npcs, id)
		}
		npcIDs[n.Ref] = id
		if err := db.AddSynopsisNPC(ctx, h.db, scenarioID, id, "draft", i); err != nil {
			return err
		}
		if factionID, ok := factionIDs[n.FactionRef]; ok {
			if err := db.AddNPCFactionLink(ctx, h.db, id, factionID, n.Role); err != nil {
				return err
			}
		}
	}

	// Artefacts.
	existingArtefacts, err := db.ListCampaignArtefacts(ctx, h.db, campaignID)
	if err != nil {
		return err
	}
	artefactByName := map[string]string{}
	for _, a := range existingArtefacts {
		artefactByName[matchKey(a.Name)] = a.ID
	}
	artefactIDs := map[string]string{}
	for _, a := range p.Artefacts {
		if !bool(a.Include) {
			continue
		}
		id, ok := artefactByName[matchKey(a.Name)]
		if !ok {
			row, err := db.CreateCampaignArtefact(ctx, h.db, campaignID, a.Name, a.Description)
			if err != nil {
				return err
			}
			id = row.ID
			artefactByName[matchKey(a.Name)] = id
			created.artefacts = append(created.artefacts, id)
		}
		artefactIDs[a.Ref] = id
	}

	// Every entity now has an id, so the names the model wrote into its prose can
	// become mentions. Built from the campaign as it stands, not from the
	// proposal: a scene that names a PNJ the GM wrote last month links to it too.
	linker, err := h.mentionLinker(ctx, campaignID)
	if err != nil {
		return err
	}
	if err := h.linkCreatedEntityProse(ctx, linker, created); err != nil {
		return err
	}

	// Hook — the pitch becomes the synopsis. Written here rather than first
	// because it is prose, and prose waits for the linker.
	hook, _ := json.Marshal(map[string]string{"content": linker.link(p.Pitch), "status": "draft"})
	if _, err := db.UpdateSynopsis(ctx, h.db, db.UpdateSynopsisParams{
		ScenarioID: scenarioID,
		Hook:       string(hook),
		NPCs:       "[]",
	}); err != nil {
		return err
	}

	// Scenes, in list order. A link pointing at an excluded item is dropped
	// with it — a dangling ref costs a missing link, never a failed commit.
	//
	// Only the description is linked. Outcome and notes are the GM's crib sheet
	// rather than prose to be read out, and chips there earn nothing.
	sortOrder := 0
	for _, s := range p.Scenes {
		if !bool(s.Include) {
			continue
		}
		description := linker.link(s.Description)
		scene, err := db.CreateScene(ctx, h.db, db.CreateSceneParams{
			ScenarioID:  scenarioID,
			Type:        "scene",
			Status:      s.Status,
			SortOrder:   sortOrder,
			Title:       s.Title,
			Description: description,
			Outcome:     s.Outcome,
		})
		if err != nil {
			return err
		}
		sortOrder++

		notes := s.Notes
		if notes == "" {
			notes = s.Summary
		}
		if _, err := db.UpdateScene(ctx, h.db, scene.ID, db.UpdateSceneParams{
			Title:       s.Title,
			Status:      s.Status,
			Description: description,
			Outcome:     s.Outcome,
			Notes:       notes,
			LocationID:  locationIDs[s.LocationRef],
			IsStart:     bool(s.IsStart),
			IsEnd:       bool(s.IsEnd),
		}); err != nil {
			return err
		}

		for _, ref := range s.NPCRefs {
			if id, ok := npcIDs[ref]; ok {
				if err := db.AddSceneNPC(ctx, h.db, scene.ID, id); err != nil {
					return err
				}
			}
		}
		for _, ref := range s.ArtefactRefs {
			if id, ok := artefactIDs[ref]; ok {
				if err := db.AddSceneArtefact(ctx, h.db, scene.ID, id); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// ── turning the proposal's names into mentions ────────────────────────────────

// createdEntities are the rows this commit brought into being, as opposed to the
// ones it matched against what the campaign already held. Only these have their
// prose rewritten: a reused entity's description is the GM's own writing, and a
// commit has no business editing it.
type createdEntities struct {
	npcs, locations, artefacts, factions []string
}

// mentionLinker collects every mentionable entity in the campaign, newly created
// ones included, as name → ref.
func (h *ScenarioFactoryHandler) mentionLinker(ctx context.Context, campaignID string) (*mentionLinker, error) {
	l := &mentionLinker{}

	npcs, err := db.ListCampaignNPCs(ctx, h.db, campaignID)
	if err != nil {
		return nil, err
	}
	for _, n := range npcs {
		l.add(n.Name, npcMentionRef(n.ID))
	}
	artefacts, err := db.ListCampaignArtefacts(ctx, h.db, campaignID)
	if err != nil {
		return nil, err
	}
	for _, a := range artefacts {
		l.add(a.Name, artefactMentionRef(a.ID))
	}
	locations, err := db.ListCampaignLocations(ctx, h.db, campaignID)
	if err != nil {
		return nil, err
	}
	for _, loc := range locations {
		l.add(loc.Name, locationMentionRef(loc.ID))
	}
	factions, err := db.ListCampaignFactions(ctx, h.db, campaignID)
	if err != nil {
		return nil, err
	}
	for _, f := range factions {
		l.add(f.Name, factionMentionRef(f.ID))
	}

	l.ready()
	return l, nil
}

// linkCreatedEntityProse rewrites the descriptions of the entities this commit
// created, so an artefact the model said belongs to a PNJ says so with a chip.
//
// Each write is skipped when linking changed nothing, which is the common case
// for a short description naming nobody.
func (h *ScenarioFactoryHandler) linkCreatedEntityProse(ctx context.Context, l *mentionLinker, created createdEntities) error {
	for _, id := range created.npcs {
		n, err := db.GetCampaignNPC(ctx, h.db, id)
		if err != nil || n == nil {
			continue
		}
		linked := l.linkExcept(n.Description, npcMentionRef(id))
		if linked == n.Description {
			continue
		}
		if _, err := db.UpdateCampaignNPC(ctx, h.db, id, n.Name, n.Role, linked, n.Quote, n.Motivation); err != nil {
			return err
		}
	}
	for _, id := range created.locations {
		loc, err := db.GetCampaignLocation(ctx, h.db, id)
		if err != nil || loc == nil {
			continue
		}
		linked := l.linkExcept(loc.Description, locationMentionRef(id))
		if linked == loc.Description {
			continue
		}
		if _, err := db.UpdateCampaignLocation(ctx, h.db, id, loc.Name, loc.City, loc.District, linked, loc.Atmosphere, loc.Images); err != nil {
			return err
		}
	}
	for _, id := range created.artefacts {
		a, err := db.GetCampaignArtefact(ctx, h.db, id)
		if err != nil || a == nil {
			continue
		}
		linked := l.linkExcept(a.Description, artefactMentionRef(id))
		if linked == a.Description {
			continue
		}
		if _, err := db.UpdateCampaignArtefact(ctx, h.db, id, a.Name, linked, a.Images); err != nil {
			return err
		}
	}
	for _, id := range created.factions {
		f, err := db.GetCampaignFaction(ctx, h.db, id)
		if err != nil || f == nil {
			continue
		}
		linked := l.linkExcept(f.Description, factionMentionRef(id))
		if linked == f.Description {
			continue
		}
		if _, err := db.UpdateCampaignFaction(ctx, h.db, id, f.Name, f.Type, linked, f.Motivation, f.Images); err != nil {
			return err
		}
	}
	return nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func clampScenes(n int) int {
	if n == 0 {
		return defaultScenes
	}
	if n < minScenes {
		return minScenes
	}
	if n > maxScenes {
		return maxScenes
	}
	return n
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// matchKey is the identity used to decide "the campaign already has this one":
// case-, accent- and whitespace-insensitive. A model that writes "Kabuki noyé"
// where the campaign holds "Le Kabuki Noye" still gets caught more often than
// not, and a false match is cheaper than a duplicate the GM must merge by hand.
func matchKey(name string) string {
	var sb strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		if folded, ok := accentFolding[r]; ok {
			sb.WriteRune(folded)
			continue
		}
		sb.WriteRune(r)
	}
	return strings.Join(strings.Fields(sb.String()), " ")
}

var accentFolding = map[rune]rune{
	'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a',
	'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
	'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
	'ò': 'o', 'ó': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o',
	'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
	'ç': 'c', 'ñ': 'n', 'ý': 'y', 'ÿ': 'y',
}
