package factory

import (
	"fmt"
	"strings"
)

// PromptContext is everything the model should know about the world before it
// invents anything in it. ExistingNPCs / ExistingLocations / ExistingFactions
// are what the campaign already holds — offered by name so the model can reuse
// a recurring fixer instead of inventing a second one. See "Reuse over
// duplication" in docs/scenario-factory.md.
type PromptContext struct {
	GameName          string
	Genre             string
	Lore              string
	ExistingNPCs      []string
	ExistingLocations []string
	ExistingFactions  []string
}

// SystemPrompt frames every factory call: JSON only, French, and the world.
func SystemPrompt(ctx PromptContext) string {
	var sb strings.Builder
	sb.WriteString("Tu es un assistant spécialisé dans l'écriture de scénarios de jeux de rôle (JdR).\n")
	sb.WriteString("Tu réponds UNIQUEMENT avec du JSON valide, sans markdown, sans explication, sans aucun texte avant ou après le JSON.\n")
	sb.WriteString("Réponds toujours en français.")

	if ctx.GameName != "" {
		fmt.Fprintf(&sb, "\n\nGame system: %s.", ctx.GameName)
	}
	if ctx.Genre != "" {
		fmt.Fprintf(&sb, "\nGenre: %s.", ctx.Genre)
	}
	if ctx.Lore != "" {
		fmt.Fprintf(&sb, "\n\nLore de la campagne :\n%s", ctx.Lore)
	}

	appendExisting(&sb, "PNJs", ctx.ExistingNPCs)
	appendExisting(&sb, "lieux", ctx.ExistingLocations)
	appendExisting(&sb, "factions", ctx.ExistingFactions)
	if len(ctx.ExistingNPCs)+len(ctx.ExistingLocations)+len(ctx.ExistingFactions) > 0 {
		sb.WriteString("\n\nTu peux réutiliser ces éléments existants : reprends alors leur nom EXACTEMENT " +
			"tel qu'il est écrit ci-dessus, et n'invente pas de variante orthographique.")
	}
	return sb.String()
}

func appendExisting(sb *strings.Builder, label string, names []string) {
	if len(names) == 0 {
		return
	}
	if len(names) > 40 {
		names = names[:40]
	}
	fmt.Fprintf(sb, "\n\n%s déjà présents dans la campagne : %s.", label, strings.Join(names, ", "))
}

// OutlinePrompt asks for the whole story in one call — pitch, cast and beats
// together — because that is what makes the fixer in beat 1 the corpse in beat 6.
func OutlinePrompt(brief string, sceneCount int, instruction string) string {
	var sb strings.Builder

	sb.WriteString("Le meneur de jeu te donne l'idée de départ d'un scénario :\n")
	sb.WriteString(strings.TrimSpace(brief))
	sb.WriteString("\n\nConstruis un scénario complet et jouable à partir de cette idée.\n\n")

	fmt.Fprintf(&sb, "Produis exactement %d scènes, dans l'ordre où elles se jouent.\n", sceneCount)
	sb.WriteString("Les scènes forment une histoire : chaque scène doit découler des précédentes.\n")
	sb.WriteString("- la première scène porte \"is_start\": true — c'est l'accroche qui lance les PJs\n")
	sb.WriteString("- la dernière porte \"is_end\": true — c'est le dénouement\n")
	sb.WriteString("- \"status\" vaut \"key_event\" pour une scène indispensable à l'intrigue, " +
		"\"optional_step\" pour une scène facultative (piste secondaire, respiration, complication)\n")
	sb.WriteString("- prévois au moins une scène \"optional_step\"\n\n")

	sb.WriteString("Chaque élément (faction, lieu, PNJ, artefact, scène) porte un identifiant court " +
		"que tu choisis toi-même dans \"ref\" (par exemple \"f1\", \"l1\", \"n1\", \"a1\", \"s1\").\n")
	sb.WriteString("Les scènes désignent leur lieu et leurs personnages UNIQUEMENT par ces refs " +
		"(\"location_ref\", \"npc_refs\", \"artefact_refs\"). N'invente pas de ref qui n'existe pas dans tes listes.\n")
	sb.WriteString("Chaque PNJ peut appartenir à une faction via \"faction_ref\".\n\n")

	sb.WriteString("Toutes les valeurs sont des chaînes de texte simples (pas d'objets, pas de listes à puces), " +
		"sauf \"npc_refs\" et \"artefact_refs\" qui sont des tableaux de chaînes, " +
		"et \"is_start\"/\"is_end\" qui sont des booléens.\n\n")

	sb.WriteString("Longueurs à respecter :\n")
	sb.WriteString("- title (scénario) : 8 mots max\n")
	sb.WriteString("- pitch : 2-3 phrases percutantes qui donnent envie de jouer (60 mots max)\n")
	sb.WriteString("- name : 5 mots max — role : 10 mots max — type (faction) : 4 mots max\n")
	sb.WriteString("- description (PNJ) : trait physique + trait psychologique (30 mots max)\n")
	sb.WriteString("- quote : réplique type mémorable (15 mots max)\n")
	sb.WriteString("- motivation : ce qui le fait agir (15 mots max)\n")
	sb.WriteString("- description (lieu) : 1-2 phrases (30 mots max) — atmosphere : 10 mots max\n")
	sb.WriteString("- title (scène) : 6 mots max — summary : ce qui se passe, 1 phrase (25 mots max)\n\n")

	fmt.Fprintf(&sb, "Dimensionne le casting pour ces %d scènes : "+
		"3 à 6 PNJs, 2 à %d lieux, 1 à 3 factions, 0 à 3 artefacts. "+
		"Chaque PNJ et chaque lieu doit apparaître dans au moins une scène.\n\n", sceneCount, sceneCount)

	if instr := strings.TrimSpace(instruction); instr != "" {
		fmt.Fprintf(&sb, "Consigne du meneur de jeu à respecter en priorité : %s\n\n", instr)
	}

	sb.WriteString("Réponds UNIQUEMENT avec ce JSON :\n")
	sb.WriteString(`{"title":"…","pitch":"…",` +
		`"factions":[{"ref":"f1","name":"…","type":"…","description":"…","motivation":"…"}],` +
		`"locations":[{"ref":"l1","name":"…","city":"…","district":"…","description":"…","atmosphere":"…"}],` +
		`"npcs":[{"ref":"n1","name":"…","role":"…","description":"…","quote":"…","motivation":"…","faction_ref":"f1"}],` +
		`"artefacts":[{"ref":"a1","name":"…","description":"…"}],` +
		`"scenes":[{"ref":"s1","title":"…","status":"key_event","summary":"…",` +
		`"location_ref":"l1","npc_refs":["n1"],"artefact_refs":["a1"],"is_start":true,"is_end":false}]}`)

	return sb.String()
}

// ExpandPrompt fleshes out one beat. It carries the whole outline as context so
// the scene lands in the story rather than beside it.
func ExpandPrompt(p *Proposal, s *Scene, instruction string, fields []string) string {
	var sb strings.Builder

	fmt.Fprintf(&sb, "Voici le scénario en cours d'écriture :\n\nTitre : %s\nPitch : %s\n\nDéroulé des scènes :\n", p.Title, p.Pitch)
	for i, sc := range p.Scenes {
		marker := " "
		if sc.Ref == s.Ref {
			marker = ">"
		}
		fmt.Fprintf(&sb, "%s %d. %s — %s\n", marker, i+1, sc.Title, sc.Summary)
	}

	sb.WriteString("\nScène à développer (marquée d'un « > ») :\n")
	fmt.Fprintf(&sb, "- titre : %s\n", s.Title)
	fmt.Fprintf(&sb, "- résumé : %s\n", s.Summary)
	if loc := p.LocationName(s.LocationRef); loc != "" {
		fmt.Fprintf(&sb, "- lieu : %s\n", loc)
	}
	if names := p.NPCNames(s.NPCRefs); len(names) > 0 {
		fmt.Fprintf(&sb, "- personnages présents : %s\n", strings.Join(names, ", "))
	}
	if s.Description != "" {
		fmt.Fprintf(&sb, "- description actuelle : %s\n", s.Description)
	}
	if s.Outcome != "" {
		fmt.Fprintf(&sb, "- dénouement actuel : %s\n", s.Outcome)
	}
	if s.Notes != "" {
		fmt.Fprintf(&sb, "- notes actuelles : %s\n", s.Notes)
	}

	sb.WriteString("\nEnrichis cette scène en 3 champs. IMPORTANT : toutes les valeurs sont des chaînes de texte simples " +
		"(pas d'objets, pas de tableaux, pas de listes à puces).\n")
	sb.WriteString("- description : 2 paragraphes courts et immersifs, lisibles à voix haute (100 mots max)\n")
	sb.WriteString("- outcome : une phrase résumant le dénouement probable (30 mots max)\n")
	sb.WriteString("- notes : 2-3 détails utiles pour le MJ séparés par des virgules (ambiance, météo, accessoires)\n")
	sb.WriteString("Si un champ a déjà une valeur, prolonge et affine l'idée plutôt que de la remplacer par une idée sans rapport.\n")

	if len(fields) > 0 {
		fmt.Fprintf(&sb, "\nNe régénère que ces champs : %s. "+
			"Pour tous les autres champs du JSON à renvoyer, recopie exactement leur valeur actuelle sans la modifier.\n",
			strings.Join(fields, ", "))
	}
	if instr := strings.TrimSpace(instruction); instr != "" {
		fmt.Fprintf(&sb, "\nConsigne du meneur de jeu à respecter en priorité : %s\n", instr)
	}

	sb.WriteString("\nRéponds UNIQUEMENT avec ce JSON : {\"description\":\"…\",\"outcome\":\"…\",\"notes\":\"…\"}")
	return sb.String()
}
