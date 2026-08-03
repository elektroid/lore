package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	BaseURL   string `json:"base_url"`
	APIKey    string `json:"api_key"`
	Model     string `json:"model"`
	MaxTokens int    `json:"max_tokens"`
	// ReasoningEffort is passed straight through to reasoning models that
	// accept it (gpt-oss via Ollama does). Left empty, the field is omitted
	// and the model's own default applies — which for a chunky extraction
	// prompt can mean spending its whole token budget thinking and never
	// emitting the answer. Unset by every existing caller; the sourcebook
	// indexer is what actually needs it, see cmd/index-sourcebook.
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
	// Timeout overrides the client's default 120s HTTP timeout. Zero keeps
	// the default. Batch callers making a handful of slow calls (the
	// indexer, again) need more room than an interactive request does.
	Timeout time.Duration `json:"-"`
}

type Client struct {
	config Config
	http   *http.Client
}

func NewClient(config Config) *Client {
	timeout := config.Timeout
	if timeout == 0 {
		timeout = 120 * time.Second
	}
	return &Client{
		config: config,
		http:   &http.Client{Timeout: timeout},
	}
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Message is the exported type for multi-turn chat history.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type completionRequest struct {
	Model           string    `json:"model"`
	Messages        []message `json:"messages"`
	MaxTokens       int       `json:"max_tokens"`
	ReasoningEffort string    `json:"reasoning_effort,omitempty"`
}

type completionResponse struct {
	Choices []struct {
		Message struct {
			Role      string `json:"role"`
			Content   string `json:"content"`
			Reasoning string `json:"reasoning"` // reasoning models (e.g. deepseek-r1, qwq)
		} `json:"message"`
	} `json:"choices"`
}

func (c *Client) Complete(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	maxTokens := c.config.MaxTokens
	if maxTokens == 0 {
		maxTokens = 2000
	}

	reqBody := completionRequest{
		Model: c.config.Model,
		Messages: []message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		MaxTokens:       maxTokens,
		ReasoningEffort: c.config.ReasoningEffort,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.config.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("requête LLM: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("LLM a retourné %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var result completionResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("décodage réponse LLM: %w", err)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("LLM n'a retourné aucun choix")
	}
	m := result.Choices[0].Message
	if m.Content != "" {
		return m.Content, nil
	}
	return m.Reasoning, nil
}

// Chat sends a full message history and returns the assistant reply.
func (c *Client) Chat(ctx context.Context, systemPrompt string, history []Message) (string, error) {
	maxTokens := c.config.MaxTokens
	if maxTokens == 0 {
		maxTokens = 2000
	}
	msgs := make([]message, 0, len(history)+1)
	msgs = append(msgs, message{Role: "system", Content: systemPrompt})
	for _, m := range history {
		msgs = append(msgs, message{Role: m.Role, Content: m.Content})
	}
	body, err := json.Marshal(completionRequest{
		Model: c.config.Model, Messages: msgs, MaxTokens: maxTokens, ReasoningEffort: c.config.ReasoningEffort,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.config.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("requête LLM: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("LLM a retourné %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var result completionResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("décodage réponse LLM: %w", err)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("LLM n'a retourné aucun choix")
	}
	m2 := result.Choices[0].Message
	if m2.Content != "" {
		return m2.Content, nil
	}
	return m2.Reasoning, nil
}
