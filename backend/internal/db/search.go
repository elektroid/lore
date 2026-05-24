package db

import (
	"context"
	"database/sql"
)

type SearchResult struct {
	Type       string `json:"type"`
	ID         string `json:"id"`
	Name       string `json:"name"`
	Subtitle   string `json:"subtitle"`
	Snippet    string `json:"snippet"`
	ScenarioID string `json:"scenario_id,omitempty"`
}

func SearchCampaign(ctx context.Context, database *sql.DB, campaignID, q string) ([]SearchResult, error) {
	like := "%" + q + "%"
	rows, err := database.QueryContext(ctx, `
		SELECT 'npc' AS type, id, name, role AS subtitle,
		       SUBSTR(description, 1, 120) AS snippet, '' AS scenario_id
		FROM campaign_npcs
		WHERE campaign_id = ? AND (name LIKE ? OR role LIKE ? OR description LIKE ? OR motivation LIKE ?)
		UNION ALL
		SELECT 'location', id, name, atmosphere,
		       SUBSTR(description, 1, 120), ''
		FROM campaign_locations
		WHERE campaign_id = ? AND (name LIKE ? OR city LIKE ? OR description LIKE ? OR atmosphere LIKE ?)
		UNION ALL
		SELECT 'artefact', id, name, '',
		       SUBSTR(description, 1, 120), ''
		FROM campaign_artefacts
		WHERE campaign_id = ? AND (name LIKE ? OR description LIKE ?)
		UNION ALL
		SELECT 'faction', id, name, type,
		       SUBSTR(description, 1, 120), ''
		FROM campaign_factions
		WHERE campaign_id = ? AND (name LIKE ? OR type LIKE ? OR description LIKE ? OR motivation LIKE ?)
		UNION ALL
		SELECT 'scene', ss.id, ss.title, sc.name,
		       SUBSTR(ss.description, 1, 120), ss.scenario_id
		FROM synopsis_scenes ss
		JOIN scenarios sc ON sc.id = ss.scenario_id
		WHERE sc.campaign_id = ? AND (ss.title LIKE ? OR ss.description LIKE ? OR ss.outcome LIKE ?)
		ORDER BY type, name
		LIMIT 50
	`,
		campaignID, like, like, like, like,
		campaignID, like, like, like, like,
		campaignID, like, like,
		campaignID, like, like, like, like,
		campaignID, like, like, like,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []SearchResult
	for rows.Next() {
		var r SearchResult
		if err := rows.Scan(&r.Type, &r.ID, &r.Name, &r.Subtitle, &r.Snippet, &r.ScenarioID); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	if results == nil {
		results = []SearchResult{}
	}
	return results, rows.Err()
}
