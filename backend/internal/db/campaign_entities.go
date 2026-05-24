package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

// ── Campaign NPCs ─────────────────────────────────────────────────────────────

type CampaignNPC struct {
	ID          string `json:"id"`
	CampaignID  string `json:"campaign_id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
	Quote       string `json:"quote"`
	Motivation  string `json:"motivation"`
	Images      string `json:"images"` // JSON array of NPCImage
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

const npcCols = `id, campaign_id, name, role, description, quote, motivation, images, created_at, updated_at`

func scanNPC(row interface{ Scan(...any) error }) (*CampaignNPC, error) {
	var n CampaignNPC
	return &n, row.Scan(&n.ID, &n.CampaignID, &n.Name, &n.Role, &n.Description, &n.Quote, &n.Motivation, &n.Images, &n.CreatedAt, &n.UpdatedAt)
}

func ListCampaignNPCs(ctx context.Context, database *sql.DB, campaignID string) ([]CampaignNPC, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+npcCols+` FROM campaign_npcs WHERE campaign_id=? ORDER BY name`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []CampaignNPC
	for rows.Next() {
		n, err := scanNPC(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *n)
	}
	if list == nil {
		list = []CampaignNPC{}
	}
	return list, rows.Err()
}

func GetCampaignNPC(ctx context.Context, database *sql.DB, id string) (*CampaignNPC, error) {
	n, err := scanNPC(database.QueryRowContext(ctx, `SELECT `+npcCols+` FROM campaign_npcs WHERE id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return n, err
}

func CreateCampaignNPC(ctx context.Context, database *sql.DB, campaignID, name, role, description, quote, motivation string) (*CampaignNPC, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO campaign_npcs(id,campaign_id,name,role,description,quote,motivation) VALUES(?,?,?,?,?,?,?)`,
		id, campaignID, name, role, description, quote, motivation)
	if err != nil {
		return nil, err
	}
	return GetCampaignNPC(ctx, database, id)
}

func UpdateCampaignNPC(ctx context.Context, database *sql.DB, id, name, role, description, quote, motivation string) (*CampaignNPC, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE campaign_npcs SET name=?,role=?,description=?,quote=?,motivation=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		name, role, description, quote, motivation, id)
	if err != nil {
		return nil, err
	}
	return GetCampaignNPC(ctx, database, id)
}

func DeleteCampaignNPC(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM campaign_npcs WHERE id=?`, id)
	return err
}

func UpdateNPCImages(ctx context.Context, database *sql.DB, id, images string) (*CampaignNPC, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE campaign_npcs SET images=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, images, id)
	if err != nil {
		return nil, err
	}
	return GetCampaignNPC(ctx, database, id)
}

// ── Campaign Locations ────────────────────────────────────────────────────────

type CampaignLocation struct {
	ID          string `json:"id"`
	CampaignID  string `json:"campaign_id"`
	Name        string `json:"name"`
	City        string `json:"city"`
	District    string `json:"district"`
	Description string `json:"description"`
	Atmosphere  string `json:"atmosphere"`
	Images      string `json:"images"` // JSON array of LocationImage
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

const locationCols = `id, campaign_id, name, city, district, description, atmosphere, images, created_at, updated_at`

func scanLocation(row interface{ Scan(...any) error }) (*CampaignLocation, error) {
	var l CampaignLocation
	return &l, row.Scan(&l.ID, &l.CampaignID, &l.Name, &l.City, &l.District, &l.Description, &l.Atmosphere, &l.Images, &l.CreatedAt, &l.UpdatedAt)
}

func ListCampaignLocations(ctx context.Context, database *sql.DB, campaignID string) ([]CampaignLocation, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+locationCols+` FROM campaign_locations WHERE campaign_id=? ORDER BY name`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []CampaignLocation
	for rows.Next() {
		l, err := scanLocation(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *l)
	}
	if list == nil {
		list = []CampaignLocation{}
	}
	return list, rows.Err()
}

func GetCampaignLocation(ctx context.Context, database *sql.DB, id string) (*CampaignLocation, error) {
	l, err := scanLocation(database.QueryRowContext(ctx, `SELECT `+locationCols+` FROM campaign_locations WHERE id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return l, err
}

func CreateCampaignLocation(ctx context.Context, database *sql.DB, campaignID, name, city, district, description, atmosphere string) (*CampaignLocation, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO campaign_locations(id,campaign_id,name,city,district,description,atmosphere) VALUES(?,?,?,?,?,?,?)`,
		id, campaignID, name, city, district, description, atmosphere)
	if err != nil {
		return nil, err
	}
	return GetCampaignLocation(ctx, database, id)
}

func UpdateCampaignLocation(ctx context.Context, database *sql.DB, id, name, city, district, description, atmosphere, images string) (*CampaignLocation, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE campaign_locations SET name=?,city=?,district=?,description=?,atmosphere=?,images=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		name, city, district, description, atmosphere, images, id)
	if err != nil {
		return nil, err
	}
	return GetCampaignLocation(ctx, database, id)
}

func UpdateLocationImages(ctx context.Context, database *sql.DB, id, images string) (*CampaignLocation, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE campaign_locations SET images=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, images, id)
	if err != nil {
		return nil, err
	}
	return GetCampaignLocation(ctx, database, id)
}

func DeleteCampaignLocation(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM campaign_locations WHERE id=?`, id)
	return err
}


// ── Campaign Artefacts ────────────────────────────────────────────────────────

type CampaignArtefact struct {
	ID          string `json:"id"`
	CampaignID  string `json:"campaign_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Images      string `json:"images"` // JSON array of ArtefactImage
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

const artefactCols = `id, campaign_id, name, description, images, created_at, updated_at`

func scanArtefact(row interface{ Scan(...any) error }) (*CampaignArtefact, error) {
	var a CampaignArtefact
	return &a, row.Scan(&a.ID, &a.CampaignID, &a.Name, &a.Description, &a.Images, &a.CreatedAt, &a.UpdatedAt)
}

func ListCampaignArtefacts(ctx context.Context, database *sql.DB, campaignID string) ([]CampaignArtefact, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+artefactCols+` FROM campaign_artefacts WHERE campaign_id=? ORDER BY name`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []CampaignArtefact
	for rows.Next() {
		a, err := scanArtefact(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *a)
	}
	if list == nil {
		list = []CampaignArtefact{}
	}
	return list, rows.Err()
}

func GetCampaignArtefact(ctx context.Context, database *sql.DB, id string) (*CampaignArtefact, error) {
	a, err := scanArtefact(database.QueryRowContext(ctx, `SELECT `+artefactCols+` FROM campaign_artefacts WHERE id=?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return a, err
}

func CreateCampaignArtefact(ctx context.Context, database *sql.DB, campaignID, name, description string) (*CampaignArtefact, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO campaign_artefacts(id,campaign_id,name,description) VALUES(?,?,?,?)`,
		id, campaignID, name, description)
	if err != nil {
		return nil, err
	}
	return GetCampaignArtefact(ctx, database, id)
}

func UpdateCampaignArtefact(ctx context.Context, database *sql.DB, id, name, description, images string) (*CampaignArtefact, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE campaign_artefacts SET name=?,description=?,images=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
		name, description, images, id)
	if err != nil {
		return nil, err
	}
	return GetCampaignArtefact(ctx, database, id)
}

func UpdateArtefactImages(ctx context.Context, database *sql.DB, id, images string) (*CampaignArtefact, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE campaign_artefacts SET images=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, images, id)
	if err != nil {
		return nil, err
	}
	return GetCampaignArtefact(ctx, database, id)
}

func DeleteCampaignArtefact(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM campaign_artefacts WHERE id=?`, id)
	return err
}

// ── NPC-Artefact Links ────────────────────────────────────────────────────────

type NPCArtefactLink struct {
	ID           string `json:"id"`
	NPCId        string `json:"npc_id"`
	ArtefactID   string `json:"artefact_id"`
	Nature       string `json:"nature"`
	CreatedAt    string `json:"created_at"`
	NPCName      string `json:"npc_name"`
	ArtefactName string `json:"artefact_name"`
}

const npcArtefactLinkQuery = `
	SELECT l.id, l.npc_id, l.artefact_id, l.nature, l.created_at, n.name, a.name
	FROM npc_artefact_links l
	JOIN campaign_npcs n ON n.id = l.npc_id
	JOIN campaign_artefacts a ON a.id = l.artefact_id`

func scanArtefactLink(row interface{ Scan(...any) error }) (*NPCArtefactLink, error) {
	var l NPCArtefactLink
	return &l, row.Scan(&l.ID, &l.NPCId, &l.ArtefactID, &l.Nature, &l.CreatedAt, &l.NPCName, &l.ArtefactName)
}

func ListNPCArtefactLinks(ctx context.Context, database *sql.DB, artefactID string) ([]NPCArtefactLink, error) {
	rows, err := database.QueryContext(ctx, npcArtefactLinkQuery+` WHERE l.artefact_id=?`, artefactID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []NPCArtefactLink
	for rows.Next() {
		l, err := scanArtefactLink(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *l)
	}
	if list == nil {
		list = []NPCArtefactLink{}
	}
	return list, rows.Err()
}

func CreateNPCArtefactLink(ctx context.Context, database *sql.DB, npcID, artefactID, nature string) (*NPCArtefactLink, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO npc_artefact_links(id,npc_id,artefact_id,nature) VALUES(?,?,?,?)`,
		id, npcID, artefactID, nature)
	if err != nil {
		return nil, err
	}
	rows, err := database.QueryContext(ctx, npcArtefactLinkQuery+` WHERE l.id=?`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if rows.Next() {
		return scanArtefactLink(rows)
	}
	return nil, nil
}

func DeleteNPCArtefactLink(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM npc_artefact_links WHERE id=?`, id)
	return err
}
