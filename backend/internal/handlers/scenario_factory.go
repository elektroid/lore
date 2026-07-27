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

// promptContext gathers the world the model writes into: the campaign's system,
// genre and lore, plus the names it may reuse rather than duplicate.
func (h *ScenarioFactoryHandler) promptContext(ctx context.Context, campaign *db.Campaign) factory.PromptContext {
	pc := factory.PromptContext{
		GameName: campaign.GameName,
		Genre:    campaign.Genre,
		Lore:     campaign.Lore,
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
	sysPrompt := factory.SystemPrompt(h.promptContext(ctx, campaign))
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

	sysPrompt := factory.SystemPrompt(h.promptContext(r.Context(), campaign))
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
func (h *ScenarioFactoryHandler) materialise(ctx context.Context, campaignID, scenarioID string, p factory.Proposal) error {
	// Hook — the pitch becomes the synopsis.
	hook, _ := json.Marshal(map[string]string{"content": p.Pitch, "status": "draft"})
	if _, err := db.UpdateSynopsis(ctx, h.db, db.UpdateSynopsisParams{
		ScenarioID: scenarioID,
		Hook:       string(hook),
		NPCs:       "[]",
	}); err != nil {
		return err
	}

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
			created, err := db.CreateCampaignFaction(ctx, h.db, campaignID, f.Name, f.Type, f.Description, f.Motivation)
			if err != nil {
				return err
			}
			id = created.ID
			factionByName[matchKey(f.Name)] = id
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
			created, err := db.CreateCampaignLocation(ctx, h.db, campaignID, l.Name, l.City, l.District, l.Description, l.Atmosphere)
			if err != nil {
				return err
			}
			id = created.ID
			locationByName[matchKey(l.Name)] = id
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
			created, err := db.CreateCampaignNPC(ctx, h.db, campaignID, n.Name, n.Role, n.Description, n.Quote, n.Motivation)
			if err != nil {
				return err
			}
			id = created.ID
			npcByName[matchKey(n.Name)] = id
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
			created, err := db.CreateCampaignArtefact(ctx, h.db, campaignID, a.Name, a.Description)
			if err != nil {
				return err
			}
			id = created.ID
			artefactByName[matchKey(a.Name)] = id
		}
		artefactIDs[a.Ref] = id
	}

	// Scenes, in list order. A link pointing at an excluded item is dropped
	// with it — a dangling ref costs a missing link, never a failed commit.
	sortOrder := 0
	for _, s := range p.Scenes {
		if !bool(s.Include) {
			continue
		}
		scene, err := db.CreateScene(ctx, h.db, db.CreateSceneParams{
			ScenarioID:  scenarioID,
			Type:        "scene",
			Status:      s.Status,
			SortOrder:   sortOrder,
			Title:       s.Title,
			Description: s.Description,
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
			Description: s.Description,
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
