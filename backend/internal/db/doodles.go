package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"strings"

	"github.com/google/uuid"
)

// Doodle is a GM-owned scheduling poll. See schema.sql for why it carries no
// campaign, run or player reference.
type Doodle struct {
	ID          string `json:"id"`
	OwnerID     string `json:"owner_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ShareToken  string `json:"share_token"`
	Closed      bool   `json:"closed"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type DoodleSlot struct {
	ID       string `json:"id"`
	DoodleID string `json:"doodle_id"`
	StartsAt string `json:"starts_at"`
}

// DoodleRespondentVotes is one respondent's name plus their answer per slot
// (slot ID -> "yes"/"no"/"maybe"). A slot missing from Votes was left blank.
type DoodleRespondentVotes struct {
	ID    string            `json:"id"`
	Name  string            `json:"name"`
	Votes map[string]string `json:"votes"`
}

const doodleCols = `id, owner_id, title, description, share_token, closed_at IS NOT NULL, created_at, updated_at`

func scanDoodle(row interface{ Scan(...any) error }) (*Doodle, error) {
	var d Doodle
	err := row.Scan(&d.ID, &d.OwnerID, &d.Title, &d.Description, &d.ShareToken, &d.Closed, &d.CreatedAt, &d.UpdatedAt)
	return &d, err
}

func newShareToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func CreateDoodle(ctx context.Context, database *sql.DB, ownerID, title, description string) (*Doodle, error) {
	token, err := newShareToken()
	if err != nil {
		return nil, err
	}
	id := uuid.New().String()
	_, err = database.ExecContext(ctx,
		`INSERT INTO doodles (id, owner_id, title, description, share_token) VALUES (?, ?, ?, ?, ?)`,
		id, ownerID, title, description, token)
	if err != nil {
		return nil, err
	}
	return GetDoodle(ctx, database, id)
}

func ListDoodlesByOwner(ctx context.Context, database *sql.DB, ownerID string) ([]Doodle, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT `+doodleCols+` FROM doodles WHERE owner_id = ? ORDER BY created_at DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	doodles := []Doodle{}
	for rows.Next() {
		d, err := scanDoodle(rows)
		if err != nil {
			return nil, err
		}
		doodles = append(doodles, *d)
	}
	return doodles, rows.Err()
}

func GetDoodle(ctx context.Context, database *sql.DB, id string) (*Doodle, error) {
	d, err := scanDoodle(database.QueryRowContext(ctx, `SELECT `+doodleCols+` FROM doodles WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return d, err
}

func GetDoodleByShareToken(ctx context.Context, database *sql.DB, token string) (*Doodle, error) {
	if token == "" {
		return nil, nil
	}
	d, err := scanDoodle(database.QueryRowContext(ctx, `SELECT `+doodleCols+` FROM doodles WHERE share_token = ?`, token))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return d, err
}

func UpdateDoodle(ctx context.Context, database *sql.DB, id, title, description string, closed bool) (*Doodle, error) {
	if closed {
		_, err := database.ExecContext(ctx,
			`UPDATE doodles SET title=?, description=?, closed_at=COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=?`,
			title, description, id)
		if err != nil {
			return nil, err
		}
	} else {
		_, err := database.ExecContext(ctx,
			`UPDATE doodles SET title=?, description=?, closed_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
			title, description, id)
		if err != nil {
			return nil, err
		}
	}
	return GetDoodle(ctx, database, id)
}

func DeleteDoodle(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM doodles WHERE id = ?`, id)
	return err
}

func ListDoodleSlots(ctx context.Context, database DBTX, doodleID string) ([]DoodleSlot, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, doodle_id, starts_at FROM doodle_slots WHERE doodle_id = ? ORDER BY starts_at ASC`, doodleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	slots := []DoodleSlot{}
	for rows.Next() {
		var s DoodleSlot
		if err := rows.Scan(&s.ID, &s.DoodleID, &s.StartsAt); err != nil {
			return nil, err
		}
		slots = append(slots, s)
	}
	return slots, rows.Err()
}

func AddDoodleSlot(ctx context.Context, database *sql.DB, doodleID, startsAt string) (*DoodleSlot, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO doodle_slots (id, doodle_id, starts_at) VALUES (?, ?, ?)`, id, doodleID, startsAt)
	if err != nil {
		return nil, err
	}
	return &DoodleSlot{ID: id, DoodleID: doodleID, StartsAt: startsAt}, nil
}

// UpdateDoodleSlot rewrites a slot's date/time, scoped to doodleID so a
// caller can't reach across doodles by guessing a slot ID.
func UpdateDoodleSlot(ctx context.Context, database *sql.DB, doodleID, slotID, startsAt string) error {
	res, err := database.ExecContext(ctx,
		`UPDATE doodle_slots SET starts_at = ? WHERE id = ? AND doodle_id = ?`, startsAt, slotID, doodleID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func DeleteDoodleSlot(ctx context.Context, database *sql.DB, doodleID, slotID string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM doodle_slots WHERE id = ? AND doodle_id = ?`, slotID, doodleID)
	return err
}

// ListDoodleRespondentVotes returns every respondent for a doodle with their
// per-slot answers, for both the owner's results view and the public page.
func ListDoodleRespondentVotes(ctx context.Context, database DBTX, doodleID string) ([]DoodleRespondentVotes, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, name FROM doodle_respondents WHERE doodle_id = ? ORDER BY created_at ASC`, doodleID)
	if err != nil {
		return nil, err
	}
	respondents := []DoodleRespondentVotes{}
	byID := map[string]*DoodleRespondentVotes{}
	for rows.Next() {
		var rv DoodleRespondentVotes
		if err := rows.Scan(&rv.ID, &rv.Name); err != nil {
			rows.Close()
			return nil, err
		}
		rv.Votes = map[string]string{}
		respondents = append(respondents, rv)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range respondents {
		byID[respondents[i].ID] = &respondents[i]
	}
	if len(respondents) == 0 {
		return respondents, nil
	}

	voteRows, err := database.QueryContext(ctx, `
		SELECT v.respondent_id, v.slot_id, v.answer
		FROM doodle_votes v
		JOIN doodle_respondents r ON r.id = v.respondent_id
		WHERE r.doodle_id = ?`, doodleID)
	if err != nil {
		return nil, err
	}
	defer voteRows.Close()
	for voteRows.Next() {
		var respondentID, slotID, answer string
		if err := voteRows.Scan(&respondentID, &slotID, &answer); err != nil {
			return nil, err
		}
		if rv, ok := byID[respondentID]; ok {
			rv.Votes[slotID] = answer
		}
	}
	return respondents, voteRows.Err()
}

var validDoodleAnswers = map[string]bool{"yes": true, "no": true, "maybe": true}

// SubmitDoodleVotes upserts one respondent's answers by (doodle_id, name):
// re-submitting under the same name replaces their previous votes rather
// than creating a second respondent. Only slot IDs belonging to the doodle
// are recorded; unknown answers are rejected.
func SubmitDoodleVotes(ctx context.Context, database *sql.DB, doodleID, name string, answers map[string]string) (*DoodleRespondentVotes, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, sql.ErrNoRows
	}

	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck — no-op once committed

	var respondentID string
	err = tx.QueryRowContext(ctx,
		`SELECT id FROM doodle_respondents WHERE doodle_id = ? AND name = ?`, doodleID, name).Scan(&respondentID)
	if err == sql.ErrNoRows {
		respondentID = uuid.New().String()
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO doodle_respondents (id, doodle_id, name) VALUES (?, ?, ?)`, respondentID, doodleID, name); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM doodle_votes WHERE respondent_id = ?`, respondentID); err != nil {
		return nil, err
	}

	rv := &DoodleRespondentVotes{ID: respondentID, Name: name, Votes: map[string]string{}}
	for slotID, answer := range answers {
		if !validDoodleAnswers[answer] {
			continue
		}
		res, err := tx.ExecContext(ctx, `
			INSERT INTO doodle_votes (respondent_id, slot_id, answer)
			SELECT ?, id, ? FROM doodle_slots WHERE id = ? AND doodle_id = ?`,
			respondentID, answer, slotID, doodleID)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			rv.Votes[slotID] = answer
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rv, nil
}
