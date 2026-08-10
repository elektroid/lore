package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

// SheetTemplate is a reusable character-sheet definition: sections of
// fields an admin builds once per ruleset. Schema is opaque JSON — see
// sheet_templates in schema.sql.
type SheetTemplate struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Schema    string `json:"schema"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func ListSheetTemplates(ctx context.Context, database *sql.DB) ([]SheetTemplate, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, name, schema, created_at, updated_at FROM sheet_templates ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []SheetTemplate{}
	for rows.Next() {
		var t SheetTemplate
		if err := rows.Scan(&t.ID, &t.Name, &t.Schema, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

func GetSheetTemplate(ctx context.Context, database *sql.DB, id string) (*SheetTemplate, error) {
	var t SheetTemplate
	err := database.QueryRowContext(ctx,
		`SELECT id, name, schema, created_at, updated_at FROM sheet_templates WHERE id = ?`, id).
		Scan(&t.ID, &t.Name, &t.Schema, &t.CreatedAt, &t.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &t, err
}

func CreateSheetTemplate(ctx context.Context, database *sql.DB, name, schema string) (*SheetTemplate, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO sheet_templates (id, name, schema) VALUES (?, ?, ?)`, id, name, schema)
	if err != nil {
		return nil, err
	}
	return GetSheetTemplate(ctx, database, id)
}

func UpdateSheetTemplate(ctx context.Context, database *sql.DB, id, name, schema string) (*SheetTemplate, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE sheet_templates SET name=?, schema=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, name, schema, id)
	if err != nil {
		return nil, err
	}
	return GetSheetTemplate(ctx, database, id)
}

func DeleteSheetTemplate(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM sheet_templates WHERE id=?`, id)
	return err
}
