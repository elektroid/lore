package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	db "lore/internal/db"
)

// appendCampaignContext appends game system and genre to sb when set.
func appendCampaignContext(sb *strings.Builder, campaign *db.Campaign) {
	if campaign.GameName != "" {
		sb.WriteString(fmt.Sprintf("\n\nGame system: %s.", campaign.GameName))
	}
	if campaign.Genre != "" {
		sb.WriteString(fmt.Sprintf("\nGenre: %s.", campaign.Genre))
	}
}

// developRequest is the optional steering payload a client sends when asking
// for an LLM suggestion on one or more fields of an entity. Every field is
// optional so a bare `{}` still means "regenerate everything, no steering" —
// the only behaviour the review flow had before GMs could target one field.
type developRequest struct {
	// Instruction is a short free-form note from the GM ("plus sombre",
	// "garde le prénom") folded into the system prompt with priority.
	Instruction string `json:"instruction,omitempty"`
	// Fields restricts regeneration to these keys; the model is told to
	// copy every other field through unchanged. Empty means "all fields".
	Fields []string `json:"fields,omitempty"`
	// Current carries the live, possibly-unsaved values from the editor so
	// a suggestion builds on what the GM is actively typing rather than the
	// last value that made it through the autosave debounce.
	Current map[string]string `json:"current,omitempty"`
}

// decodeDevelopRequest reads the optional steering body. A missing, empty,
// or malformed body is not an error — it just yields the zero value.
func decodeDevelopRequest(r *http.Request) developRequest {
	var req developRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	return req
}

// applyCurrentOverrides overwrites current[k] with the client-supplied
// in-progress value for each allowed key present in override. Keys outside
// allowedKeys are ignored so a client can't smuggle arbitrary content into
// the prompt through unrelated field names.
func applyCurrentOverrides(current, override map[string]string, allowedKeys ...string) {
	for _, k := range allowedKeys {
		if v, ok := override[k]; ok {
			current[k] = v
		}
	}
}

// steeringSuffix renders the optional field-scope restriction and free-form
// GM instruction as extra system-prompt text. Empty when neither is set.
func steeringSuffix(req developRequest) string {
	var sb strings.Builder
	if len(req.Fields) > 0 {
		sb.WriteString(fmt.Sprintf(
			"\n\nNe régénère que ces champs : %s. Pour tous les autres champs du JSON à renvoyer, recopie exactement leur valeur actuelle sans la modifier.",
			strings.Join(req.Fields, ", ")))
	}
	if instr := strings.TrimSpace(req.Instruction); instr != "" {
		sb.WriteString(fmt.Sprintf("\n\nConsigne du meneur de jeu à respecter en priorité : %s", instr))
	}
	return sb.String()
}

// appendSteering appends steeringSuffix to a system-prompt builder.
func appendSteering(sb *strings.Builder, req developRequest) {
	sb.WriteString(steeringSuffix(req))
}
