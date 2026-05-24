package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type BrainstormThread struct {
	ID         string `json:"id"`
	ScenarioID string `json:"scenario_id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

type BrainstormMessage struct {
	ID        string `json:"id"`
	ThreadID  string `json:"thread_id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

func ListBrainstormThreads(ctx context.Context, database *sql.DB, scenarioID string) ([]BrainstormThread, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, scenario_id, name, created_at, updated_at FROM brainstorm_threads WHERE scenario_id=? ORDER BY updated_at DESC`, scenarioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []BrainstormThread
	for rows.Next() {
		var t BrainstormThread
		if err := rows.Scan(&t.ID, &t.ScenarioID, &t.Name, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	if list == nil {
		list = []BrainstormThread{}
	}
	return list, rows.Err()
}

func GetBrainstormThread(ctx context.Context, database *sql.DB, id string) (*BrainstormThread, error) {
	var t BrainstormThread
	err := database.QueryRowContext(ctx,
		`SELECT id, scenario_id, name, created_at, updated_at FROM brainstorm_threads WHERE id=?`, id).
		Scan(&t.ID, &t.ScenarioID, &t.Name, &t.CreatedAt, &t.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &t, err
}

func CreateBrainstormThread(ctx context.Context, database *sql.DB, scenarioID string) (*BrainstormThread, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO brainstorm_threads(id,scenario_id,name) VALUES(?,?,'Nouvelle conversation')`, id, scenarioID)
	if err != nil {
		return nil, err
	}
	return GetBrainstormThread(ctx, database, id)
}

func RenameBrainstormThread(ctx context.Context, database *sql.DB, id, name string) (*BrainstormThread, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE brainstorm_threads SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, name, id)
	if err != nil {
		return nil, err
	}
	return GetBrainstormThread(ctx, database, id)
}

func DeleteBrainstormThread(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM brainstorm_threads WHERE id=?`, id)
	return err
}

func ListBrainstormMessages(ctx context.Context, database *sql.DB, threadID string) ([]BrainstormMessage, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, thread_id, role, content, created_at FROM brainstorm_messages WHERE thread_id=? ORDER BY created_at ASC`, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []BrainstormMessage
	for rows.Next() {
		var m BrainstormMessage
		if err := rows.Scan(&m.ID, &m.ThreadID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	if list == nil {
		list = []BrainstormMessage{}
	}
	return list, rows.Err()
}

func CreateBrainstormMessage(ctx context.Context, database *sql.DB, threadID, role, content string) (*BrainstormMessage, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO brainstorm_messages(id,thread_id,role,content) VALUES(?,?,?,?)`, id, threadID, role, content)
	if err != nil {
		return nil, err
	}
	var m BrainstormMessage
	return &m, database.QueryRowContext(ctx,
		`SELECT id, thread_id, role, content, created_at FROM brainstorm_messages WHERE id=?`, id).
		Scan(&m.ID, &m.ThreadID, &m.Role, &m.Content, &m.CreatedAt)
}

func CountBrainstormMessages(ctx context.Context, database *sql.DB, threadID string) (int, error) {
	var count int
	err := database.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM brainstorm_messages WHERE thread_id=?`, threadID).Scan(&count)
	return count, err
}
