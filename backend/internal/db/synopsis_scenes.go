package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type Scene struct {
	ID           string     `json:"id"`
	ScenarioID   string     `json:"scenario_id"`
	Type         string     `json:"type"` // "scene" | "divider"
	Status       string     `json:"status"` // "idea" | "optional_step" | "key_event"
	SortOrder    int        `json:"sort_order"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Outcome      string     `json:"outcome"`
	Notes        string     `json:"notes"`
	LocationID    string `json:"location_id"`
	LocationName  string `json:"location_name"`
	IsStart       bool   `json:"is_start"`
	IsEnd         bool   `json:"is_end"`
	PlaylistType  string `json:"playlist_type"`
	PlaylistValue string `json:"playlist_value"`
	NPCs         []SceneNPC      `json:"npcs"`
	Artefacts    []SceneArtefact `json:"artefacts"`
	CreatedAt    string          `json:"created_at"`
	UpdatedAt    string          `json:"updated_at"`
}

type SceneNPC struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
	Quote       string `json:"quote"`
	Motivation  string `json:"motivation"`
	Images      string `json:"images"`
}

const sceneCols = `
	s.id, s.scenario_id, s.type, s.status, s.sort_order, s.title, s.description, s.outcome, s.notes,
	COALESCE(s.location_id,''), COALESCE(cl.name,''), s.is_start, s.is_end,
	COALESCE(s.playlist_type,''), COALESCE(s.playlist_value,''), s.created_at, s.updated_at`

const sceneJoin = `
	FROM synopsis_scenes s
	LEFT JOIN campaign_locations cl ON cl.id = s.location_id`

func scanScene(row interface{ Scan(...any) error }) (*Scene, error) {
	var s Scene
	var isStart, isEnd int
	err := row.Scan(&s.ID, &s.ScenarioID, &s.Type, &s.Status, &s.SortOrder, &s.Title, &s.Description, &s.Outcome, &s.Notes,
		&s.LocationID, &s.LocationName, &isStart, &isEnd,
		&s.PlaylistType, &s.PlaylistValue, &s.CreatedAt, &s.UpdatedAt)
	s.IsStart = isStart == 1
	s.IsEnd = isEnd == 1
	s.NPCs = []SceneNPC{}
	s.Artefacts = []SceneArtefact{}
	return &s, err
}

func ListScenes(ctx context.Context, database *sql.DB, scenarioID string) ([]Scene, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT`+sceneCols+sceneJoin+`
		 WHERE s.scenario_id=? ORDER BY s.sort_order, s.created_at`, scenarioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Scene
	for rows.Next() {
		s, err := scanScene(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *s)
	}
	if list == nil {
		list = []Scene{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range list {
		npcs, err := ListSceneNPCs(ctx, database, list[i].ID)
		if err != nil {
			return nil, err
		}
		list[i].NPCs = npcs
		artefacts, err := ListSceneArtefacts(ctx, database, list[i].ID)
		if err != nil {
			return nil, err
		}
		list[i].Artefacts = artefacts
	}
	return list, nil
}

func GetScene(ctx context.Context, database *sql.DB, id string) (*Scene, error) {
	s, err := scanScene(database.QueryRowContext(ctx,
		`SELECT`+sceneCols+sceneJoin+` WHERE s.id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	npcs, err := ListSceneNPCs(ctx, database, s.ID)
	if err != nil {
		return nil, err
	}
	s.NPCs = npcs
	artefacts, err := ListSceneArtefacts(ctx, database, s.ID)
	if err != nil {
		return nil, err
	}
	s.Artefacts = artefacts
	return s, nil
}

type CreateSceneParams struct {
	ScenarioID string
	Type       string
	Status     string
	SortOrder  int
	Title      string
	Description string
	Outcome     string
}

func CreateScene(ctx context.Context, database *sql.DB, p CreateSceneParams) (*Scene, error) {
	id := uuid.New().String()
	if p.Type == "" {
		p.Type = "scene"
	}
	if p.Status == "" {
		p.Status = "idea"
	}
	_, err := database.ExecContext(ctx,
		`INSERT INTO synopsis_scenes(id,scenario_id,type,status,sort_order,title,description,outcome) VALUES(?,?,?,?,?,?,?,?)`,
		id, p.ScenarioID, p.Type, p.Status, p.SortOrder, p.Title, p.Description, p.Outcome)
	if err != nil {
		return nil, err
	}
	return GetScene(ctx, database, id)
}

type UpdateSceneParams struct {
	Title         string
	Status        string
	Description   string
	Outcome       string
	Notes         string
	LocationID    string
	IsStart       bool
	IsEnd         bool
	PlaylistType  string
	PlaylistValue string
}

func UpdateScene(ctx context.Context, database *sql.DB, id string, p UpdateSceneParams) (*Scene, error) {
	var locID interface{}
	if p.LocationID != "" {
		locID = p.LocationID
	}
	isStart, isEnd := 0, 0
	if p.IsStart { isStart = 1 }
	if p.IsEnd { isEnd = 1 }
	if p.Status == "" {
		p.Status = "idea"
	}
	_, err := database.ExecContext(ctx,
		`UPDATE synopsis_scenes
		 SET title=?,status=?,description=?,outcome=?,notes=?,location_id=?,is_start=?,is_end=?,
		     playlist_type=?,playlist_value=?,updated_at=CURRENT_TIMESTAMP
		 WHERE id=?`,
		p.Title, p.Status, p.Description, p.Outcome, p.Notes, locID, isStart, isEnd,
		p.PlaylistType, p.PlaylistValue, id)
	if err != nil {
		return nil, err
	}
	return GetScene(ctx, database, id)
}

// ClearSceneStart unsets is_start on all scenes in a scenario before setting a new one.
func ClearSceneStart(ctx context.Context, database *sql.DB, scenarioID string) error {
	_, err := database.ExecContext(ctx,
		`UPDATE synopsis_scenes SET is_start=0 WHERE scenario_id=?`, scenarioID)
	return err
}

func DeleteScene(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM synopsis_scenes WHERE id=?`, id)
	return err
}

func ReorderScenes(ctx context.Context, database *sql.DB, ids []string) error {
	for i, id := range ids {
		if _, err := database.ExecContext(ctx,
			`UPDATE synopsis_scenes SET sort_order=? WHERE id=?`, i, id); err != nil {
			return err
		}
	}
	return nil
}

// ── Scene NPCs ────────────────────────────────────────────────────────────────

func ListSceneNPCs(ctx context.Context, database *sql.DB, sceneID string) ([]SceneNPC, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT cn.id, cn.name, cn.role, cn.description, cn.quote, cn.motivation, COALESCE(cn.images,'[]')
		FROM scene_npcs sn
		JOIN campaign_npcs cn ON cn.id = sn.npc_id
		WHERE sn.scene_id=?
		ORDER BY cn.name`, sceneID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []SceneNPC
	for rows.Next() {
		var n SceneNPC
		if err := rows.Scan(&n.ID, &n.Name, &n.Role, &n.Description, &n.Quote, &n.Motivation, &n.Images); err != nil {
			return nil, err
		}
		list = append(list, n)
	}
	if list == nil {
		list = []SceneNPC{}
	}
	return list, rows.Err()
}

func AddSceneNPC(ctx context.Context, database *sql.DB, sceneID, npcID string) error {
	_, err := database.ExecContext(ctx,
		`INSERT INTO scene_npcs(id,scene_id,npc_id) VALUES(?,?,?)
		 ON CONFLICT(scene_id,npc_id) DO NOTHING`,
		uuid.New().String(), sceneID, npcID)
	return err
}

func RemoveSceneNPC(ctx context.Context, database *sql.DB, sceneID, npcID string) error {
	_, err := database.ExecContext(ctx,
		`DELETE FROM scene_npcs WHERE scene_id=? AND npc_id=?`, sceneID, npcID)
	return err
}

// ── Scene Artefacts ───────────────────────────────────────────────────────────

type SceneArtefact struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Images      string `json:"images"`
}

func ListSceneArtefacts(ctx context.Context, database *sql.DB, sceneID string) ([]SceneArtefact, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT ca.id, ca.name, ca.description, COALESCE(ca.images,'[]')
		FROM scene_artefacts sa
		JOIN campaign_artefacts ca ON ca.id = sa.artefact_id
		WHERE sa.scene_id=?
		ORDER BY ca.name`, sceneID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []SceneArtefact
	for rows.Next() {
		var a SceneArtefact
		if err := rows.Scan(&a.ID, &a.Name, &a.Description, &a.Images); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	if list == nil {
		list = []SceneArtefact{}
	}
	return list, rows.Err()
}

func AddSceneArtefact(ctx context.Context, database *sql.DB, sceneID, artefactID string) error {
	_, err := database.ExecContext(ctx,
		`INSERT INTO scene_artefacts(id,scene_id,artefact_id) VALUES(?,?,?)
		 ON CONFLICT(scene_id,artefact_id) DO NOTHING`,
		uuid.New().String(), sceneID, artefactID)
	return err
}

func RemoveSceneArtefact(ctx context.Context, database *sql.DB, sceneID, artefactID string) error {
	_, err := database.ExecContext(ctx,
		`DELETE FROM scene_artefacts WHERE scene_id=? AND artefact_id=?`, sceneID, artefactID)
	return err
}
