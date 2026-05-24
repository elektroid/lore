package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Decode calls the LLM, extracts the JSON from its response, and decodes it
// into T. On any parse failure it retries once, feeding the error and the raw
// response back to the model so it can self-correct.
func Decode[T any](ctx context.Context, c *Client, sysPrompt, userPrompt string) (T, error) {
	var zero T

	raw, err := c.Complete(ctx, sysPrompt, userPrompt)
	if err != nil {
		return zero, err
	}

	val, parseErr := parseJSON[T](raw)
	if parseErr == nil {
		return val, nil
	}

	// Single retry with error feedback
	retryPrompt := userPrompt +
		"\n\nYour previous response could not be parsed as JSON.\nError: " + parseErr.Error() +
		"\nYour response was:\n" + raw +
		"\n\nReply with ONLY the JSON object, no explanation, no markdown, no text before or after."

	raw2, err2 := c.Complete(ctx, sysPrompt, retryPrompt)
	if err2 != nil {
		return zero, fmt.Errorf("LLM retry error: %w", err2)
	}

	val2, err3 := parseJSON[T](raw2)
	if err3 != nil {
		return zero, fmt.Errorf("invalid LLM response: %w (raw: %.300s)", err3, raw2)
	}
	return val2, nil
}

// ExtractJSON extracts the first balanced JSON object or array from s and
// escapes any literal control characters inside string values. Exported for
// callers (e.g. Chat flows) that manage the LLM turn themselves.
func ExtractJSON(s string) string {
	return extractJSON(s)
}

// parseJSON extracts and decodes the first JSON value from raw into T.
func parseJSON[T any](raw string) (T, error) {
	var val T
	if err := json.Unmarshal([]byte(extractJSON(raw)), &val); err != nil {
		return val, err
	}
	return val, nil
}

// extractJSON extracts the first complete JSON object or array from s,
// escaping literal control characters in string values so the result is valid JSON.
func extractJSON(s string) string {
	s = strings.TrimSpace(s)

	// Strip markdown code fence if present
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx != -1 {
			s = s[idx+1:]
		}
		if idx := strings.LastIndex(s, "```"); idx != -1 {
			s = s[:idx]
		}
	}

	// Find the opening brace/bracket of the first JSON value
	start := strings.IndexAny(s, "{[")
	if start == -1 {
		return escapeStringLiterals(strings.TrimSpace(s))
	}

	opener := s[start]
	closer := byte('}')
	if opener == '[' {
		closer = ']'
	}

	// Walk forward tracking depth so we stop at the first balanced close,
	// ignoring any braces/brackets inside string literals or after the object.
	depth := 0
	inStr := false
	esc := false
	for i := start; i < len(s); i++ {
		c := s[i]
		if esc {
			esc = false
			continue
		}
		if c == '\\' && inStr {
			esc = true
			continue
		}
		if c == '"' {
			inStr = !inStr
			continue
		}
		if !inStr {
			if c == opener {
				depth++
			} else if c == closer {
				depth--
				if depth == 0 {
					return escapeStringLiterals(s[start : i+1])
				}
			}
		}
	}

	// No balanced close — best effort
	return escapeStringLiterals(strings.TrimSpace(s[start:]))
}

// escapeStringLiterals escapes literal control characters (real newlines, tabs,
// etc.) inside JSON string values. LLMs routinely embed bare newlines in string
// fields, which is invalid JSON. Processes input as UTF-8 so multi-byte runes
// are never misidentified as delimiters.
func escapeStringLiterals(s string) string {
	var buf strings.Builder
	buf.Grow(len(s))
	inString := false
	escaped := false
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		i += size

		// Multi-byte rune — copy verbatim; cannot be a control char or delimiter.
		if size > 1 {
			buf.WriteRune(r)
			continue
		}

		c := byte(r)

		if escaped {
			buf.WriteByte(c)
			escaped = false
			continue
		}
		if c == '\\' {
			buf.WriteByte(c)
			if inString {
				escaped = true
			}
			continue
		}
		if c == '"' {
			inString = !inString
			buf.WriteByte(c)
			continue
		}
		if inString {
			switch {
			case c == '\n':
				buf.WriteString(`\n`)
			case c == '\r':
				buf.WriteString(`\r`)
			case c == '\t':
				buf.WriteString(`\t`)
			case c < 0x20 || c == 0x7F:
				fmt.Fprintf(&buf, `\u%04x`, c)
			default:
				buf.WriteByte(c)
			}
		} else {
			buf.WriteByte(c)
		}
	}
	return buf.String()
}
