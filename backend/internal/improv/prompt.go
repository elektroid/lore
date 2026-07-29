package improv

import (
	"fmt"
	"strings"
)

// Context is the world the improvisation happened in.
type Context struct {
	GameName      string
	Genre         string
	ScenarioPitch string
}

// SystemPrompt frames the develop call: JSON only, French, and the world.
func SystemPrompt(ctx Context) string {
	var sb strings.Builder
	sb.WriteString("Tu es un assistant spécialisé dans l'écriture de scénarios de jeux de rôle (JdR).\n")
	sb.WriteString("Tu réponds UNIQUEMENT avec du JSON valide, sans markdown, sans explication, sans aucun texte avant ou après le JSON.\n")
	sb.WriteString("Réponds toujours en français.\n")
	sb.WriteString("Le meneur de jeu a improvisé pendant la partie. Ton rôle est de mettre cette improvisation au propre " +
		"et de signaler ce qu'elle change dans le scénario — pas de la corriger ni de la censurer. " +
		"Ce que les joueurs ont fait est acquis.")

	if ctx.GameName != "" {
		fmt.Fprintf(&sb, "\n\nGame system: %s.", ctx.GameName)
	}
	if ctx.Genre != "" {
		fmt.Fprintf(&sb, "\nGenre: %s.", ctx.Genre)
	}
	if ctx.ScenarioPitch != "" {
		fmt.Fprintf(&sb, "\n\nSynopsis du scénario :\n%s", ctx.ScenarioPitch)
	}
	return sb.String()
}

// DevelopPrompt asks for the write-up and the coherency report in one call.
// Scenes are numbered so the model can point at them without inventing UUIDs.
func DevelopPrompt(note string, scenes []SceneLine, instruction string, fields []string) string {
	var sb strings.Builder

	sb.WriteString("Déroulé prévu du scénario :\n")
	if len(scenes) == 0 {
		sb.WriteString("(aucune scène écrite pour l'instant)\n")
	}
	for _, s := range scenes {
		marks := []string{}
		if s.Played {
			marks = append(marks, "déjà jouée")
		}
		if s.Voided {
			marks = append(marks, "annulée")
		}
		if s.IsAnchor {
			marks = append(marks, "SCÈNE EN COURS")
		}
		suffix := ""
		if len(marks) > 0 {
			suffix = " [" + strings.Join(marks, ", ") + "]"
		}
		fmt.Fprintf(&sb, "- %s : %s%s", s.Ref, s.Title, suffix)
		if s.Summary != "" {
			fmt.Fprintf(&sb, " — %s", s.Summary)
		}
		sb.WriteString("\n")
	}

	sb.WriteString("\nCe que les joueurs ont fait, noté par le meneur de jeu pendant la partie :\n")
	sb.WriteString(strings.TrimSpace(note))

	sb.WriteString("\n\nDeux tâches.\n\n")

	sb.WriteString("1. Mets cette improvisation au propre, sous la forme d'une scène. " +
		"Toutes les valeurs sont des chaînes de texte simples (pas d'objets, pas de listes à puces).\n")
	sb.WriteString("- title : titre court de la scène (6 mots max)\n")
	sb.WriteString("- description : 2 paragraphes courts et immersifs, lisibles à voix haute (100 mots max)\n")
	sb.WriteString("- outcome : une phrase sur ce que cette scène laisse derrière elle (30 mots max)\n")
	sb.WriteString("- notes : 2-3 détails utiles pour la suite, séparés par des virgules\n")
	sb.WriteString("Reste fidèle à la note du meneur : n'invente pas un autre événement, " +
		"développe celui-là.\n\n")

	sb.WriteString("2. Vérifie la cohérence avec le déroulé prévu.\n")
	sb.WriteString("- verdict : \"ok\" si tout tient, \"tension\" si une scène prévue devient plus difficile " +
		"ou si une motivation change, \"conflict\" si quelque chose est contredit ou rendu impossible\n")
	sb.WriteString("- summary : une phrase, la conséquence la plus importante (25 mots max)\n")
	sb.WriteString("- impacts : la liste des scènes prévues touchées. Pour chacune, " +
		"\"scene_ref\" est l'identifiant ci-dessus (s1, s2…) et \"note\" dit en une phrase ce qui change. " +
		"Liste uniquement les scènes réellement affectées — une liste vide est une bonne réponse.\n")
	sb.WriteString("Ne propose pas de corriger l'improvisation : signale, c'est tout.\n")

	if len(fields) > 0 {
		fmt.Fprintf(&sb, "\nNe régénère que ces champs : %s. "+
			"Pour tous les autres champs du JSON à renvoyer, recopie exactement leur valeur actuelle sans la modifier.\n",
			strings.Join(fields, ", "))
	}
	if instr := strings.TrimSpace(instruction); instr != "" {
		fmt.Fprintf(&sb, "\nConsigne du meneur de jeu à respecter en priorité : %s\n", instr)
	}

	sb.WriteString("\nRéponds UNIQUEMENT avec ce JSON :\n")
	sb.WriteString(`{"title":"…","description":"…","outcome":"…","notes":"…",` +
		`"coherency":{"verdict":"ok","summary":"…","impacts":[{"scene_ref":"s1","note":"…"}]}}`)

	return sb.String()
}
