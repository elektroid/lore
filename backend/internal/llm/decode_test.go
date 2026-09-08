package llm

import "testing"

type replyEnvelope struct {
	Message         string `json:"message"`
	SceneSuggestion *struct {
		Title string `json:"title"`
	} `json:"scene_suggestion"`
}

func TestUnmarshalReply(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "plain object",
			raw:  `{"message":"hello","scene_suggestion":null}`,
			want: "hello",
		},
		{
			name: "fenced object",
			raw:  "```json\n{\n  \"message\": \"hello\",\n  \"scene_suggestion\": null\n}\n```",
			want: "hello",
		},
		{
			name: "literal newline inside a value",
			raw:  "{\"message\":\"line one\nline two\",\"scene_suggestion\":null}",
			want: "line one\nline two",
		},
		{
			// The production failure: the model quotes something inside the prose
			// without escaping it, which makes the whole reply unparseable.
			name: "unescaped quotes inside a value",
			raw:  `{"message":"un drone (modèle "Lazarus Lite") survole la zone","scene_suggestion":null}`,
			want: `un drone (modèle "Lazarus Lite") survole la zone`,
		},
		{
			name: "unescaped quote before a comma",
			raw:  `{"message":"il dit "bonjour" puis part","scene_suggestion":null}`,
			want: `il dit "bonjour" puis part`,
		},
		{
			name: "prose around the object",
			raw:  "Voici le JSON :\n{\"message\":\"hello\",\"scene_suggestion\":null}\nVoilà.",
			want: "hello",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var env replyEnvelope
			if err := UnmarshalReply(tc.raw, &env); err != nil {
				t.Fatalf("UnmarshalReply: %v", err)
			}
			if env.Message != tc.want {
				t.Errorf("message = %q, want %q", env.Message, tc.want)
			}
			if env.SceneSuggestion != nil {
				t.Errorf("scene_suggestion = %+v, want nil", env.SceneSuggestion)
			}
		})
	}
}

func TestUnmarshalReplyKeepsEscapedQuotes(t *testing.T) {
	var env replyEnvelope
	if err := UnmarshalReply(`{"message":"le \"Black Lotus\"","scene_suggestion":{"title":"Le vol"}}`, &env); err != nil {
		t.Fatalf("UnmarshalReply: %v", err)
	}
	if env.Message != `le "Black Lotus"` {
		t.Errorf("message = %q", env.Message)
	}
	if env.SceneSuggestion == nil || env.SceneSuggestion.Title != "Le vol" {
		t.Errorf("scene_suggestion = %+v", env.SceneSuggestion)
	}
}
