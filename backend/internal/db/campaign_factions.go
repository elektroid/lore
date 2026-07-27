package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

// ── Campaign Factions ─────────────────────────────────────────────────────────

type CampaignFaction struct {
	ID          string `json:"id"`
	CampaignID  string `json:"campaign_id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Motivation  string `json:"motivation"`
	Images      string `json:"images"` // JSON array
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

const factionCols = `id, campaign_id, name, type, description, motivation, images, created_at, updated_at`

func scanFaction(row interface{ Scan(...any) error }) (*CampaignFaction, error) {
	var f CampaignFaction
	return &f, row.Scan(&f.ID, &f.CampaignID, &f.Name, &f.Type, &f.Description, &f.Motivation, &f.Images, &f.CreatedAt, &f.UpdatedAt)
}

func ListCampaignFactions(ctx context.Context, database *sql.DB, campaignID string) ([]CampaignFaction, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+factionCols+` FROM campaign_factions WHERE campaign_id=? ORDER BY name`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []CampaignFaction
	for rows.Next() {
		f, err := scanFaction(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *f)
	}
	if list == nil {
		list = []CampaignFaction{}
	}
	return list, rows.Err()
}

func GetCampaignFaction(ctx context.Context, database *sql.DB, id string) (*CampaignFaction, error) {
	f, err := scanFaction(database.QueryRowContext(ctx, `SELECT `+factionCols+` FROM campaign_factions WHERE id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return f, err
}

func CreateCampaignFaction(ctx context.Context, database *sql.DB, campaignID, name, ftype, description, motivation string) (*CampaignFaction, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO campaign_factions(id,campaign_id,name,type,description,motivation) VALUES(?,?,?,?,?,?)`,
		id, campaignID, name, ftype, description, motivation)
	if err != nil {
		return nil, err
	}
	return GetCampaignFaction(ctx, database, id)
}

func UpdateCampaignFaction(ctx context.Context, database *sql.DB, id, name, ftype, description, motivation, images string) (*CampaignFaction, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE campaign_factions SET name=?,type=?,description=?,motivation=?,images=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		name, ftype, description, motivation, images, id)
	if err != nil {
		return nil, err
	}
	return GetCampaignFaction(ctx, database, id)
}

func UpdateFactionImages(ctx context.Context, database *sql.DB, id, images string) (*CampaignFaction, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE campaign_factions SET images=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		images, id)
	if err != nil {
		return nil, err
	}
	return GetCampaignFaction(ctx, database, id)
}

func DeleteCampaignFaction(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM campaign_factions WHERE id=?`, id)
	return err
}

// AddNPCFactionLink records that an NPC belongs to a faction. Written by the
// scenario factory's commit step, which knows the membership because the model
// proposed it; no UI surfaces the link yet.
func AddNPCFactionLink(ctx context.Context, database *sql.DB, npcID, factionID, role string) error {
	_, err := database.ExecContext(ctx,
		`INSERT INTO npc_faction_links(id,npc_id,faction_id,role) VALUES(?,?,?,?)
		 ON CONFLICT(npc_id,faction_id) DO NOTHING`,
		uuid.New().String(), npcID, factionID, role)
	return err
}

