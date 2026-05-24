package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	db "lore/internal/db"
	"lore/internal/llm"
)

var mentionRE = regexp.MustCompile(`@\[([^\]]+)\]\(([^)]+)\)`)

func resolveMentions(content string, npcs []db.CampaignNPC) string {
	npcMap := make(map[string]db.CampaignNPC, len(npcs))
	for _, n := range npcs {
		npcMap[n.ID] = n
	}
	return mentionRE.ReplaceAllStringFunc(content, func(m string) string {
		sub := mentionRE.FindStringSubmatch(m)
		if len(sub) < 3 {
			return m
		}
		storedName, id := sub[1], sub[2]
		if npc, ok := npcMap[id]; ok {
			if npc.Role != "" {
				return npc.Name + " (" + npc.Role + ")"
			}
			return npc.Name
		}
		return storedName
	})
}

// ── local types mirroring frontend SynopsisData ──────────────────────────

type hookData struct {
	Content string `json:"content"`
	Status  string `json:"status"`
}

type npcItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
	Quote       string `json:"quote"`
	Status      string `json:"status"`
}

type sceneItem struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Outcome     string `json:"outcome"`
	Notes       string `json:"notes,omitempty"`
	Location    string `json:"location"`
}

type synopsisCtx struct {
	Hook   hookData    `json:"hook"`
	NPCs   []npcItem   `json:"npcs"`
	Scenes []sceneItem `json:"scenes"`
}

func parseSynopsisCtx(s *db.Synopsis) synopsisCtx {
	var sc synopsisCtx
	json.Unmarshal([]byte(s.Hook), &sc.Hook) //nolint:errcheck
	sc.NPCs = []npcItem{}
	sc.Scenes = []sceneItem{}
	return sc
}

// ── system prompt ─────────────────────────────────────────────────────────

func buildSystemPrompt(campaign *db.Campaign) string {
	var sb strings.Builder
	sb.WriteString("Tu es un assistant spécialisé dans l'écriture de scénarios de jeux de rôle (JdR).\n")
	sb.WriteString("Tu réponds UNIQUEMENT avec du JSON valide, sans markdown, sans explication, sans aucun texte avant ou après le JSON.\n")
	sb.WriteString("Réponds toujours en français.\n")
	sb.WriteString("Ne modifie jamais les éléments dont le statut est \"confirmed\".")

	appendCampaignContext(&sb, campaign)

	return sb.String()
}

// ── shared infra ─────────────────────────────────────────────────────────

// llmContext resolves the LLM client, synopsis, synopsis context (with real NPCs), and system prompt.
func (h *SynopsisHandler) llmContext(r *http.Request, scenarioID string) (*llm.Client, *db.Synopsis, synopsisCtx, string, error) {
	synopsis, err := db.GetSynopsisByScenario(r.Context(), h.db, scenarioID)
	if err != nil || synopsis == nil {
		return nil, nil, synopsisCtx{}, "", fmt.Errorf("synopsis introuvable")
	}
	scenario, err := db.GetScenario(r.Context(), h.db, scenarioID)
	if err != nil || scenario == nil {
		return nil, nil, synopsisCtx{}, "", fmt.Errorf("scénario introuvable")
	}
	campaign, err := db.GetCampaign(r.Context(), h.db, scenario.CampaignID)
	if err != nil || campaign == nil {
		return nil, nil, synopsisCtx{}, "", fmt.Errorf("campagne introuvable")
	}
	cfg, err := loadLLMConfig(r.Context(), h.db, h.encKey)
	if err != nil || cfg.BaseURL == "" {
		return nil, nil, synopsisCtx{}, "", fmt.Errorf("configuration LLM manquante — configurez-la dans les Paramètres")
	}

	sc := parseSynopsisCtx(synopsis)

	// Resolve @[Name](uuid) mentions in hook content using campaign NPCs
	if campaignNPCs, err2 := db.ListCampaignNPCs(r.Context(), h.db, scenario.CampaignID); err2 == nil {
		sc.Hook.Content = resolveMentions(sc.Hook.Content, campaignNPCs)
	}

	// Load real NPCs from junction table
	snpcs, err := db.ListSynopsisNPCs(r.Context(), h.db, scenarioID)
	if err == nil {
		sc.NPCs = make([]npcItem, len(snpcs))
		for i, n := range snpcs {
			sc.NPCs[i] = npcItem{
				ID: n.ID, Name: n.Name, Role: n.Role,
				Description: n.Description, Quote: n.Quote, Status: n.Status,
			}
		}
	}

	// Load scenes for LLM context
	scenes, err := db.ListScenes(r.Context(), h.db, scenarioID)
	if err == nil {
		sc.Scenes = make([]sceneItem, len(scenes))
		for i, s := range scenes {
			sc.Scenes[i] = sceneItem{
				ID: s.ID, Type: s.Type, Title: s.Title,
				Description: s.Description, Outcome: s.Outcome, Notes: s.Notes, Location: s.LocationName,
			}
		}
	}

	return llm.NewClient(cfg), synopsis, sc, buildSystemPrompt(campaign), nil
}

func (h *SynopsisHandler) snapshotBefore(ctx context.Context, synopsis *db.Synopsis, label string) {
	_ = db.CreateSnapshot(ctx, h.db, synopsis.ID, "Avant : "+label, db.SynopsisToSnapshotData(synopsis))
	_ = db.DeleteOldestSnapshotsIfNeeded(ctx, h.db, synopsis.ID, 20)
}

// commitSynopsis persists hook. NPCs live in synopsis_npcs; scenes in synopsis_scenes.
func (h *SynopsisHandler) commitSynopsis(r *http.Request, scenarioID string, sc synopsisCtx, overviewCache string) (*db.Synopsis, error) {
	hookJSON, _ := json.Marshal(sc.Hook)
	return db.UpdateSynopsis(r.Context(), h.db, db.UpdateSynopsisParams{
		ScenarioID:    scenarioID,
		Hook:          string(hookJSON),
		NPCs:          "[]",
		OverviewCache: overviewCache,
	})
}


func marshalCtx(sc synopsisCtx) string {
	b, _ := json.Marshal(sc)
	return string(b)
}

// ── LLM action handlers ───────────────────────────────────────────────────

func (h *SynopsisHandler) CompleteHook(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	_, synopsis, sc, sysPrompt, err := h.llmContext(r, scenarioID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if sc.Hook.Status == "confirmed" {
		writeError(w, http.StatusConflict, "le synopsis est verrouillé (confirmed)")
		return
	}

	h.snapshotBefore(r.Context(), synopsis, "Complétion synopsis")

	prompt := fmt.Sprintf(
		"Voici le synopsis d'un scénario JdR :\n%s\n\n"+
			"Améliore et complète le synopsis en 2-3 phrases percutantes (50 mots max). "+
			"Elle doit donner envie de jouer ce scénario.\n"+
			"Réponds avec : {\"content\":\"...\"}",
		marshalCtx(sc))

	cfg, _ := loadLLMConfig(r.Context(), h.db, h.encKey)
	cfg.MaxTokens = 200
	client := llm.NewClient(cfg)

	type hookResult struct {
		Content string `json:"content"`
	}
	result, err := llm.Decode[hookResult](r.Context(), client, sysPrompt, prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}
	if result.Content == "" {
		writeError(w, http.StatusInternalServerError, "réponse LLM vide")
		return
	}

	sc.Hook.Content = result.Content
	updated, err := h.commitSynopsis(r, scenarioID, sc, synopsis.OverviewCache)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *SynopsisHandler) SuggestNPCs(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	_, _, sc, sysPrompt, err := h.llmContext(r, scenarioID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	scenario, err := db.GetScenario(r.Context(), h.db, scenarioID)
	if err != nil || scenario == nil {
		writeError(w, http.StatusInternalServerError, "scénario introuvable")
		return
	}

	prompt := fmt.Sprintf(
		"Voici le synopsis d'un scénario JdR :\n%s\n\n"+
			"Suggère 2 à 3 nouveaux PNJs pertinents qui enrichiraient ce scénario. Ne propose pas de PNJs déjà existants.\n"+
			"Toutes les valeurs sont des chaînes simples (pas d'objets, pas de listes).\n"+
			"- name : prénom ou surnom (5 mots max)\n"+
			"- role : fonction dans l'histoire (10 mots max)\n"+
			"- description : trait physique + trait psychologique (20 mots max)\n"+
			"- quote : réplique type mémorable (15 mots max)\n"+
			"Réponds avec un tableau JSON : [{\"name\":\"...\",\"role\":\"...\",\"description\":\"...\",\"quote\":\"...\"}]",
		marshalCtx(sc))

	cfg, _ := loadLLMConfig(r.Context(), h.db, h.encKey)
	cfg.MaxTokens = 400
	client := llm.NewClient(cfg)

	type npcSuggestion struct {
		Name        string `json:"name"`
		Role        string `json:"role"`
		Description string `json:"description"`
		Quote       string `json:"quote"`
		Motivation  string `json:"motivation"`
	}
	suggestions, err := llm.Decode[[]npcSuggestion](r.Context(), client, sysPrompt, prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}

	for _, s := range suggestions {
		npc, err := db.CreateCampaignNPC(r.Context(), h.db, scenario.CampaignID, s.Name, s.Role, s.Description, s.Quote, s.Motivation)
		if err != nil {
			continue
		}
		_ = db.AddSynopsisNPC(r.Context(), h.db, scenarioID, npc.ID, "draft", 0)
	}

	npcs, err := db.ListSynopsisNPCs(r.Context(), h.db, scenarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, npcs)
}

func (h *SynopsisHandler) DevelopNPC(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	npcID := chi.URLParam(r, "npcId")

	_, _, sc, sysPrompt, err := h.llmContext(r, scenarioID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var target *npcItem
	for i := range sc.NPCs {
		if sc.NPCs[i].ID == npcID {
			target = &sc.NPCs[i]
			break
		}
	}
	if target == nil {
		writeError(w, http.StatusNotFound, "PNJ introuvable dans ce synopsis")
		return
	}
	if target.Status == "confirmed" {
		writeError(w, http.StatusConflict, "ce PNJ est verrouillé (confirmed)")
		return
	}

	npcJSON, _ := json.Marshal(target)
	prompt := fmt.Sprintf(
		"Voici le synopsis d'un scénario JdR :\n%s\n\n"+
			"Développe ce PNJ. Toutes les valeurs sont des chaînes simples (pas d'objets, pas de listes).\n"+
			"- role : fonction dans l'histoire (10 mots max)\n"+
			"- description : 2 phrases (physique marquant + psychologie) (30 mots max)\n"+
			"- motivation : une phrase courte sur ce qui le fait agir (15 mots max)\n"+
			"- quote : réplique type mémorable (15 mots max)\n"+
			"PNJ à développer :\n%s\n\n"+
			"Réponds UNIQUEMENT avec ce JSON : {\"role\":\"...\",\"description\":\"...\",\"motivation\":\"...\",\"quote\":\"...\"}",
		marshalCtx(sc), string(npcJSON))

	cfg, _ := loadLLMConfig(r.Context(), h.db, h.encKey)
	cfg.MaxTokens = 300
	client := llm.NewClient(cfg)

	type npcResult struct {
		Role        string `json:"role"`
		Description string `json:"description"`
		Quote       string `json:"quote"`
		Motivation  string `json:"motivation"`
	}
	result, err := llm.Decode[npcResult](r.Context(), client, sysPrompt, prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}

	if result.Role == "" {
		result.Role = target.Role
	}
	if result.Quote == "" {
		result.Quote = target.Quote
	}

	writeJSON(w, http.StatusOK, result)
}

func (h *SynopsisHandler) SuggestScene(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	_, _, sc, sysPrompt, err := h.llmContext(r, scenarioID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Count existing scenes to set sort_order
	scenes, _ := db.ListScenes(r.Context(), h.db, scenarioID)
	sortOrder := len(scenes)

	prompt := fmt.Sprintf(
		"Voici le synopsis d'un scénario JdR :\n%s\n\n"+
			"Suggère une scène manquante qui améliorerait le rythme ou la cohérence du scénario.\n"+
			"Toutes les valeurs sont des chaînes simples (pas d'objets, pas de listes).\n"+
			"- title : titre court de la scène (6 mots max)\n"+
			"- description : 1-2 phrases immersives (40 mots max)\n"+
			"- outcome : une phrase sur le dénouement probable (20 mots max)\n"+
			"- location : nom du lieu (5 mots max)\n"+
			"Réponds UNIQUEMENT avec ce JSON : {\"title\":\"...\",\"description\":\"...\",\"outcome\":\"...\",\"location\":\"...\"}",
		marshalCtx(sc))

	cfg, _ := loadLLMConfig(r.Context(), h.db, h.encKey)
	cfg.MaxTokens = 350
	client := llm.NewClient(cfg)

	type sceneResult struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Outcome     string `json:"outcome"`
		Location    string `json:"location"`
	}
	result, err := llm.Decode[sceneResult](r.Context(), client, sysPrompt, prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}
	if result.Title == "" {
		writeError(w, http.StatusInternalServerError, "réponse LLM vide")
		return
	}

	scene, err := db.CreateScene(r.Context(), h.db, db.CreateSceneParams{
		ScenarioID: scenarioID,
		Type:       "scene",
		SortOrder:  sortOrder,
		Title:      result.Title,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	scene, err = db.UpdateScene(r.Context(), h.db, scene.ID, db.UpdateSceneParams{
		Title:       result.Title,
		Description: result.Description,
		Outcome:     result.Outcome,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, scene)
}

func (h *SynopsisHandler) DevelopScene(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	sceneID := chi.URLParam(r, "sceneId")

	scene, err := db.GetScene(r.Context(), h.db, sceneID)
	if err != nil || scene == nil {
		writeError(w, http.StatusNotFound, "scène introuvable")
		return
	}

	_, _, sc, sysPrompt, err := h.llmContext(r, scenarioID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	sceneJSON, _ := json.Marshal(map[string]string{
		"title":       scene.Title,
		"description": scene.Description,
		"outcome":     scene.Outcome,
		"notes":       scene.Notes,
		"location":    scene.LocationName,
	})

	prompt := fmt.Sprintf(
		"Voici le synopsis complet du scénario :\n%s\n\n"+
			"Voici la scène à développer :\n%s\n\n"+
			"Enrichis cette scène en 3 champs. IMPORTANT : toutes les valeurs sont des chaînes de texte simples (pas d'objets, pas de tableaux, pas de listes à puces).\n"+
			"- description : 2 paragraphes courts et immersifs, lisibles à voix haute (100 mots max)\n"+
			"- outcome : une phrase résumant le dénouement probable (30 mots max)\n"+
			"- notes : 2-3 détails utiles pour le MJ séparés par des virgules (ambiance, météo, accessoires)\n"+
			"Réponds UNIQUEMENT avec ce JSON (valeurs = chaînes) : {\"description\":\"...\",\"outcome\":\"...\",\"notes\":\"...\"}",
		marshalCtx(sc), string(sceneJSON))

	cfg, _ := loadLLMConfig(r.Context(), h.db, h.encKey)
	cfg.MaxTokens = 500
	client := llm.NewClient(cfg)

	type developResult struct {
		Description string `json:"description"`
		Outcome     string `json:"outcome"`
		Notes       string `json:"notes"`
	}
	result, err := llm.Decode[developResult](r.Context(), client, sysPrompt, prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (h *SynopsisHandler) GenerateOverview(w http.ResponseWriter, r *http.Request) {
	scenarioID := chi.URLParam(r, "id")
	_, synopsis, sc, sysPrompt, err := h.llmContext(r, scenarioID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	h.snapshotBefore(r.Context(), synopsis, "Génération overview")

	prompt := fmt.Sprintf(
		"Voici le synopsis d'un scénario JdR :\n%s\n\n"+
			"Rédige un overview du scénario en prose narrative (150 à 250 mots). "+
			"Synthétise le synopsis, les PNJs clés et la progression des scènes. "+
			"La valeur est une chaîne de texte simple (pas d'objets, pas de listes).\n"+
			"Réponds UNIQUEMENT avec ce JSON : {\"overview\":\"...\"}",
		marshalCtx(sc))

	cfg, _ := loadLLMConfig(r.Context(), h.db, h.encKey)
	cfg.MaxTokens = 700
	client := llm.NewClient(cfg)

	type overviewResult struct {
		Overview string `json:"overview"`
	}
	result, err := llm.Decode[overviewResult](r.Context(), client, sysPrompt, prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur LLM : "+err.Error())
		return
	}

	updated, err := h.commitSynopsis(r, scenarioID, sc, result.Overview)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
