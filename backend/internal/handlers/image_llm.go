package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/uuid"

	db "lore/internal/db"
)

// ErrRateLimit is returned when Mistral rejects a request with HTTP 429.
var ErrRateLimit = errors.New("image generation rate limit reached, please try again later")

type ImageLLMHandler struct {
	db         *sql.DB
	uploadsDir string
	encKey     string
	agentMu    sync.Mutex
}

type PendingImage struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

func (h *ImageLLMHandler) readImageConfig(ctx context.Context) (ImageConfig, error) {
	return loadImageConfig(ctx, h.db, h.encKey)
}

// appendVisualStyle folds the game's visual style into the prompt text for
// providers with no other channel for it. Mistral gets it baked into the
// per-game agent's instructions instead (see ensureGameAgent), so it's a
// no-op there — adding it twice wouldn't be wrong, just redundant.
func appendVisualStyle(prompt string, cfg ImageConfig, game *db.Game) string {
	if cfg.Provider == "openrouter" && game != nil && game.VisualStyle != "" {
		return prompt + "\n\nVisual style: " + game.VisualStyle
	}
	return prompt
}

// requireImageProviderConfigured checks that whichever provider is selected
// actually has the credentials it needs before spending a request on it.
func requireImageProviderConfigured(cfg ImageConfig) error {
	if cfg.Provider == "openrouter" {
		if cfg.OpenRouterAPIKey == "" || cfg.OpenRouterModel == "" {
			return errors.New("OpenRouter API key/model not configured — configure it in Settings")
		}
		return nil
	}
	if cfg.MistralAPIKey == "" {
		return errors.New("Mistral API key not configured — configure it in Settings")
	}
	return nil
}

// getGameForCampaign returns the Game for a campaign, or nil if no game is set.
func (h *ImageLLMHandler) getGameForCampaign(ctx context.Context, campaignID string) (*db.Game, error) {
	campaign, err := db.GetCampaign(ctx, h.db, campaignID)
	if err != nil || campaign == nil {
		return nil, err
	}
	if campaign.GameID == "" {
		return nil, nil
	}
	return db.GetGame(ctx, h.db, campaign.GameID)
}

// ensureGameAgent returns the Mistral agent ID for the given game, creating it if needed.
// If game is nil (no game set on campaign), creates a generic agent without visual style.
func (h *ImageLLMHandler) ensureGameAgent(ctx context.Context, game *db.Game, apiKey string) (string, error) {
	h.agentMu.Lock()
	defer h.agentMu.Unlock()

	if game != nil && game.MistralAgentID != "" {
		return game.MistralAgentID, nil
	}

	instructions := "Use the image generation tool to create every image the user requests. " +
		"Always produce a single high-quality illustration."

	agentName := "Lore Image Generator"
	if game != nil {
		agentName = "Lore Image Generator — " + game.Name
		if game.VisualStyle != "" {
			instructions += "\n\nVisual style for this game universe: " + game.VisualStyle
		}
	}

	body, _ := json.Marshal(map[string]any{
		"model":           "mistral-medium-latest",
		"name":            agentName,
		"instructions":    instructions,
		"tools":           []map[string]string{{"type": "image_generation"}},
		"completion_args": map[string]any{"temperature": 0.7, "top_p": 0.95},
	})

	data, err := h.mistralDo(ctx, "POST", "/agents", body, apiKey)
	if err != nil {
		return "", fmt.Errorf("create agent: %w", err)
	}

	var resp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &resp); err != nil || resp.ID == "" {
		return "", fmt.Errorf("parse agent response (body: %s): %w", data, err)
	}

	if game != nil {
		if err := db.UpdateGameMistralAgent(ctx, h.db, game.ID, resp.ID); err != nil {
			log.Printf("warn: failed to persist mistral agent ID: %v", err)
		}
	}
	log.Printf("mistral: agent created: %s (%s)", agentName, resp.ID)
	return resp.ID, nil
}

// spawnImages fans out cfg.ImageCount concurrent generations, dispatching to
// the configured provider. agentID is only meaningful for the Mistral
// provider (see ensureGameAgent) and ignored otherwise.
func (h *ImageLLMHandler) spawnImages(ctx context.Context, cfg ImageConfig, agentID, entityType, entityID, pendingDir, prompt string) ([]PendingImage, error) {
	type genResult struct {
		img *PendingImage
		err error
	}
	count := cfg.ImageCount
	ch := make(chan genResult, count)

	for i := 0; i < count; i++ {
		go func() {
			var img *PendingImage
			var err error
			if cfg.Provider == "openrouter" {
				img, err = h.generateOneOpenRouter(ctx, entityType, entityID, pendingDir, prompt, cfg.OpenRouterAPIKey, cfg.OpenRouterModel)
			} else {
				img, err = h.generateOneMistral(ctx, agentID, entityType, entityID, pendingDir, prompt, cfg.MistralAPIKey)
			}
			ch <- genResult{img: img, err: err}
		}()
	}

	var candidates []PendingImage
	var rateLimited int
	for i := 0; i < count; i++ {
		res := <-ch
		if res.err != nil {
			log.Printf("%s image gen error: %v", entityType, res.err)
			if errors.Is(res.err, ErrRateLimit) {
				rateLimited++
			}
			continue
		}
		if res.img != nil {
			candidates = append(candidates, *res.img)
		}
	}
	if len(candidates) == 0 && rateLimited > 0 {
		return nil, ErrRateLimit
	}
	return candidates, nil
}

func (h *ImageLLMHandler) generateOneMistral(ctx context.Context, agentID, entityType, entityID, pendingDir, prompt, apiKey string) (*PendingImage, error) {
	convBody, _ := json.Marshal(map[string]any{
		"agent_id": agentID,
		"inputs":   prompt,
	})
	respBytes, err := h.mistralDo(ctx, "POST", "/conversations", convBody, apiKey)
	if err != nil {
		return nil, fmt.Errorf("conversation: %w", err)
	}

	fileID := extractMistralFileID(respBytes)
	if fileID == "" {
		return nil, fmt.Errorf("no tool_file in response: %.200s", respBytes)
	}

	imgBytes, err := h.mistralDownloadFile(ctx, fileID, apiKey)
	if err != nil {
		return nil, fmt.Errorf("download file %s: %w", fileID, err)
	}

	id := uuid.New().String()
	dest := filepath.Join(pendingDir, id+".png")
	if err := os.WriteFile(dest, imgBytes, 0644); err != nil {
		return nil, fmt.Errorf("write file: %w", err)
	}

	return &PendingImage{
		ID:  id,
		URL: fmt.Sprintf("/uploads/%s/%s/pending/%s.png", entityType, entityID, id),
	}, nil
}

// generateOneOpenRouter calls OpenRouter's dedicated Images API
// (POST /images — distinct from /chat/completions), which is stateless and
// returns the PNG inline as base64, unlike Mistral's agent/conversation/
// tool-file dance.
func (h *ImageLLMHandler) generateOneOpenRouter(ctx context.Context, entityType, entityID, pendingDir, prompt, apiKey, model string) (*PendingImage, error) {
	reqBody, _ := json.Marshal(map[string]any{
		"model":      model,
		"prompt":     prompt,
		"n":          1,
		"resolution": "1K",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://openrouter.ai/api/v1/images", bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrRateLimit
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, data)
	}

	var envelope struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil || len(envelope.Data) == 0 {
		return nil, fmt.Errorf("no image in response: %.200s", data)
	}
	imgBytes, err := base64.StdEncoding.DecodeString(envelope.Data[0].B64JSON)
	if err != nil {
		return nil, fmt.Errorf("decode base64 image: %w", err)
	}

	id := uuid.New().String()
	dest := filepath.Join(pendingDir, id+".png")
	if err := os.WriteFile(dest, imgBytes, 0644); err != nil {
		return nil, fmt.Errorf("write file: %w", err)
	}

	return &PendingImage{
		ID:  id,
		URL: fmt.Sprintf("/uploads/%s/%s/pending/%s.png", entityType, entityID, id),
	}, nil
}

func (h *ImageLLMHandler) mistralDo(ctx context.Context, method, path string, body []byte, apiKey string) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, "https://api.mistral.ai/v1"+path, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("%w", ErrRateLimit)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, data)
	}
	return data, nil
}

func (h *ImageLLMHandler) mistralDownloadFile(ctx context.Context, fileID, apiKey string) ([]byte, error) {
	return h.mistralDo(ctx, "GET", "/files/"+fileID+"/content", nil, apiKey)
}

func extractMistralFileID(respBytes []byte) string {
	var envelope struct {
		Outputs []struct {
			Content []json.RawMessage `json:"content"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal(respBytes, &envelope); err != nil {
		return ""
	}
	for _, out := range envelope.Outputs {
		for _, raw := range out.Content {
			var chunk struct {
				Type   string `json:"type"`
				FileID string `json:"file_id"`
			}
			if json.Unmarshal(raw, &chunk) == nil && chunk.Type == "tool_file" && chunk.FileID != "" {
				return chunk.FileID
			}
		}
	}
	return ""
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
