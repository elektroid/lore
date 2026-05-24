package db

import (
	"context"
	"database/sql"
)

func GetSetting(ctx context.Context, database *sql.DB, key string) (string, error) {
	var value string
	err := database.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func SetSetting(ctx context.Context, database *sql.DB, key, value string) error {
	_, err := database.ExecContext(ctx,
		`INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value)
	return err
}
