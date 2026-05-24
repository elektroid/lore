package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type SynopsisFaction struct {
	ID         string `json:"id"` // faction_id
	ScenarioID string `json:"scenario_id"`
	CampaignID string `json:"campaign_id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
}

func ListSynopsisFactions(ctx context.Context, database *sql.DB, scenarioID string) ([]SynopsisFaction, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT sf.faction_id, sf.scenario_id, cf.campaign_id, cf.name, cf.type
		FROM synopsis_factions sf
		JOIN campaign_factions cf ON cf.id = sf.faction_id
		WHERE sf.scenario_id = ?
		ORDER BY cf.name`, scenarioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []SynopsisFaction
	for rows.Next() {
		var f SynopsisFaction
		if err := rows.Scan(&f.ID, &f.ScenarioID, &f.CampaignID, &f.Name, &f.Type); err != nil {
			return nil, err
		}
		list = append(list, f)
	}
	if list == nil {
		list = []SynopsisFaction{}
	}
	return list, rows.Err()
}

func AddSynopsisFaction(ctx context.Context, database *sql.DB, scenarioID, factionID string) error {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx, `
		INSERT INTO synopsis_factions(id, scenario_id, faction_id)
		VALUES(?, ?, ?)
		ON CONFLICT(scenario_id, faction_id) DO NOTHING`,
		id, scenarioID, factionID)
	return err
}

func RemoveSynopsisFaction(ctx context.Context, database *sql.DB, scenarioID, factionID string) error {
	_, err := database.ExecContext(ctx,
		`DELETE FROM synopsis_factions WHERE scenario_id=? AND faction_id=?`, scenarioID, factionID)
	return err
}
