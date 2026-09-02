package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type Campaign struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Genre      string `json:"genre"`
	GameID     string `json:"game_id"`
	GameName   string `json:"game_name"`
	Pitch      string `json:"pitch"`
	LLMConfig  string `json:"llm_config"`
	OwnerID    string `json:"owner_id"`
	OwnerName  string `json:"owner_name"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

type CreateCampaignParams struct {
	Name      string
	Genre     string
	GameID    string
	Pitch     string
	LLMConfig string
	OwnerID   string
}

type UpdateCampaignParams struct {
	ID        string
	Name      string
	Genre     string
	GameID    string
	Pitch     string
	LLMConfig string
}

const campaignSelect = `
	SELECT c.id, c.name, c.genre, c.game_id, COALESCE(g.name, ''), c.pitch, c.llm_config, c.owner_id, COALESCE(u.name, ''), c.created_at, c.updated_at
	FROM campaigns c
	LEFT JOIN games g ON g.id = c.game_id
	LEFT JOIN users u ON u.id = c.owner_id`

func scanCampaign(row interface{ Scan(...any) error }) (*Campaign, error) {
	var c Campaign
	err := row.Scan(&c.ID, &c.Name, &c.Genre, &c.GameID, &c.GameName, &c.Pitch, &c.LLMConfig, &c.OwnerID, &c.OwnerName, &c.CreatedAt, &c.UpdatedAt)
	return &c, err
}

func ListCampaigns(ctx context.Context, database *sql.DB) ([]Campaign, error) {
	rows, err := database.QueryContext(ctx, campaignSelect+` ORDER BY c.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Campaign
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *c)
	}
	if list == nil {
		list = []Campaign{}
	}
	return list, rows.Err()
}

// CampaignListItem is a campaign with an access level annotation for the requesting user.
type CampaignListItem struct {
	Campaign
	Access string `json:"access"` // "owner" or "member"
}

// ListCampaignsForUser returns campaigns the user owns or is a member of,
// annotated with their access level. Superusers receive all campaigns as "owner".
func ListCampaignsForUser(ctx context.Context, database *sql.DB, userID string, isSuperuser bool) ([]CampaignListItem, error) {
	var query string
	var args []any

	if isSuperuser {
		query = campaignSelect + ` ORDER BY c.updated_at DESC`
	} else {
		query = campaignSelect + `
			WHERE c.owner_id = ? OR c.id IN (SELECT campaign_id FROM campaign_members WHERE user_id = ?)
			ORDER BY c.updated_at DESC`
		args = []any{userID, userID}
	}

	rows, err := database.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []CampaignListItem
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		access := "member"
		if isSuperuser || c.OwnerID == userID {
			access = "owner"
		}
		list = append(list, CampaignListItem{Campaign: *c, Access: access})
	}
	if list == nil {
		list = []CampaignListItem{}
	}
	return list, rows.Err()
}

func GetCampaign(ctx context.Context, database *sql.DB, id string) (*Campaign, error) {
	row := database.QueryRowContext(ctx, campaignSelect+` WHERE c.id = ?`, id)
	c, err := scanCampaign(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return c, err
}

func CreateCampaign(ctx context.Context, database *sql.DB, p CreateCampaignParams) (*Campaign, error) {
	id := uuid.New().String()
	llmConfig := p.LLMConfig
	if llmConfig == "" {
		llmConfig = "{}"
	}
	ownerID := p.OwnerID
	if ownerID == "" {
		ownerID = ""
	}
	_, err := database.ExecContext(ctx,
		`INSERT INTO campaigns (id, name, genre, game_id, pitch, llm_config, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, p.Name, p.Genre, p.GameID, p.Pitch, llmConfig, ownerID)
	if err != nil {
		return nil, err
	}
	return GetCampaign(ctx, database, id)
}

func UpdateCampaign(ctx context.Context, database *sql.DB, p UpdateCampaignParams) (*Campaign, error) {
	llmConfig := p.LLMConfig
	if llmConfig == "" {
		llmConfig = "{}"
	}
	_, err := database.ExecContext(ctx,
		`UPDATE campaigns SET name=?, genre=?, game_id=?, pitch=?, llm_config=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		p.Name, p.Genre, p.GameID, p.Pitch, llmConfig, p.ID)
	if err != nil {
		return nil, err
	}
	return GetCampaign(ctx, database, p.ID)
}
