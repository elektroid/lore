package llm

// Provider is a known OpenAI-compatible endpoint the settings UI can offer as
// a one-click preset. The generic Client works against any of them (and any
// unlisted one) purely via Config.BaseURL — this registry only exists to
// pre-fill the UI, it has no effect on how requests are made.
type Provider struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	BaseURL string `json:"base_url"`
}

// Providers lists the presets offered in the settings UI, in display order.
// "custom" has no BaseURL — selecting it leaves the field for the user to fill.
var Providers = []Provider{
	{ID: "mistral", Label: "Mistral", BaseURL: "https://api.mistral.ai/v1"},
	{ID: "ollama", Label: "Ollama (local)", BaseURL: "http://localhost:11434/v1"},
	{ID: "openrouter", Label: "OpenRouter", BaseURL: "https://openrouter.ai/api/v1"},
	{ID: "custom", Label: "Personnalisé", BaseURL: ""},
}
