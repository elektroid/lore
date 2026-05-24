package db

import (
	"database/sql"
	_ "embed"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

func Open(path string) (*sql.DB, error) {
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(1)

	if _, err := database.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		database.Close()
		return nil, err
	}

	return database, nil
}

func Migrate(database *sql.DB) error {
	_, err := database.Exec(schema)
	return err
}

// MigrateAlters adds columns to existing tables that predate the current schema.
// Each ALTER is attempted independently; "duplicate column" errors are ignored.
func MigrateAlters(database *sql.DB) {
	alters := []string{
		`ALTER TABLE campaign_npcs ADD COLUMN motivation TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE campaign_locations ADD COLUMN images TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE campaign_npcs ADD COLUMN images TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE synopsis_scenes ADD COLUMN notes TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE campaign_locations ADD COLUMN city TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE campaign_locations ADD COLUMN district TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE synopsis_scenes ADD COLUMN status TEXT NOT NULL DEFAULT 'idea'`,
		`ALTER TABLE campaigns RENAME COLUMN ambiance TO game`,
		`ALTER TABLE synopsis_scenes ADD COLUMN is_start INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE synopsis_scenes ADD COLUMN is_end INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE campaigns ADD COLUMN game_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE campaigns ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE games ADD COLUMN visual_style TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE games ADD COLUMN mistral_agent_id TEXT NOT NULL DEFAULT ''`,
	}
	for _, stmt := range alters {
		database.Exec(stmt) //nolint:errcheck — duplicate column error is expected on re-run
	}
}
