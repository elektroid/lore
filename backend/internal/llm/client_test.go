package llm

import (
	"encoding/json"
	"testing"
)

// Providers disagree on the spelling of the context window; both must reach
// the settings UI as one field.
func TestModelInfoContextLengthSpellings(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want int
	}{
		{"openrouter", `{"data":[{"id":"m","context_length":200000}]}`, 200000},
		{"mistral", `{"data":[{"id":"m","max_context_length":262144}]}`, 262144},
		{"ollama declares nothing", `{"data":[{"id":"m"}]}`, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var resp modelsResponse
			if err := json.Unmarshal([]byte(tc.raw), &resp); err != nil {
				t.Fatal(err)
			}
			// What the handler writes back out is what the UI reads.
			out, err := json.Marshal(resp.Data[0])
			if err != nil {
				t.Fatal(err)
			}
			var got struct {
				ContextLength int `json:"context_length"`
			}
			if err := json.Unmarshal(out, &got); err != nil {
				t.Fatal(err)
			}
			if got.ContextLength != tc.want {
				t.Errorf("context_length = %d, want %d (raw: %s)", got.ContextLength, tc.want, out)
			}
		})
	}
}
