package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type SynopsisNPC struct {
	ID          string `json:"id"`
	ScenarioID  string `json:"scenario_id"`
	CampaignID  string `json:"campaign_id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
	Quote       string `json:"quote"`
	Motivation  string `json:"motivation"`
	Images      string `json:"images"`
	Status      string `json:"status"`
	SortOrder   int    `json:"sort_order"`
}

func ListSynopsisNPCs(ctx context.Context, database *sql.DB, scenarioID string) ([]SynopsisNPC, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT sn.npc_id, sn.scenario_id, cn.campaign_id,
		       cn.name, cn.role, cn.description, cn.quote, cn.motivation, cn.images,
		       sn.status, sn.sort_order
		FROM synopsis_npcs sn
		JOIN campaign_npcs cn ON cn.id = sn.npc_id
		WHERE sn.scenario_id = ?
		ORDER BY sn.sort_order, sn.created_at`, scenarioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []SynopsisNPC
	for rows.Next() {
		var n SynopsisNPC
		if err := rows.Scan(&n.ID, &n.ScenarioID, &n.CampaignID,
			&n.Name, &n.Role, &n.Description, &n.Quote, &n.Motivation, &n.Images,
			&n.Status, &n.SortOrder); err != nil {
			return nil, err
		}
		list = append(list, n)
	}
	if list == nil {
		list = []SynopsisNPC{}
	}
	return list, rows.Err()
}

func AddSynopsisNPC(ctx context.Context, database *sql.DB, scenarioID, npcID, status string, sortOrder int) error {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx, `
		INSERT INTO synopsis_npcs(id, scenario_id, npc_id, status, sort_order)
		VALUES(?, ?, ?, ?, ?)
		ON CONFLICT(scenario_id, npc_id) DO NOTHING`,
		id, scenarioID, npcID, status, sortOrder)
	return err
}

func RemoveSynopsisNPC(ctx context.Context, database *sql.DB, scenarioID, npcID string) error {
	_, err := database.ExecContext(ctx,
		`DELETE FROM synopsis_npcs WHERE scenario_id=? AND npc_id=?`, scenarioID, npcID)
	return err
}

func UpdateSynopsisNPCStatus(ctx context.Context, database *sql.DB, scenarioID, npcID, status string) error {
	_, err := database.ExecContext(ctx,
		`UPDATE synopsis_npcs SET status=? WHERE scenario_id=? AND npc_id=?`,
		status, scenarioID, npcID)
	return err
}
