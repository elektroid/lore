package db

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"time"

	"github.com/google/uuid"
)

// passwordResetTTL is how long an issued link stays valid.
const passwordResetTTL = time.Hour

// CreatePasswordResetToken mints a reset link for userID and returns the raw
// token to embed in the emailed URL. Only its SHA-256 hash is stored, so
// GetValidPasswordResetToken must be given the same raw value to match it —
// a leaked database cannot be used to forge a reset.
func CreatePasswordResetToken(ctx context.Context, database *sql.DB, userID string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)

	id := uuid.New().String()
	expiresAt := time.Now().Add(passwordResetTTL)
	_, err := database.ExecContext(ctx,
		`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
		id, userID, hashResetToken(token), expiresAt)
	if err != nil {
		return "", err
	}
	return token, nil
}

// GetValidPasswordResetToken looks up the user a raw token was issued for,
// returning nil if the token is unknown, expired, or already spent. Expired
// rows are opportunistically swept here rather than via a background job —
// this app has neither cron nor a task runner (see ratelimit's own comment
// about proportionate solutions for a single-process, single-file app).
func GetValidPasswordResetToken(ctx context.Context, database *sql.DB, token string) (userID string, err error) {
	if token == "" {
		return "", nil
	}
	_, _ = database.ExecContext(ctx, `DELETE FROM password_reset_tokens WHERE expires_at < ?`, time.Now())

	row := database.QueryRowContext(ctx,
		`SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at >= ?`,
		hashResetToken(token), time.Now())
	err = row.Scan(&userID)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return userID, err
}

// DeletePasswordResetTokensForUser invalidates every outstanding reset link
// for a user. Called once a reset succeeds, so an old copy of a previous
// link (forwarded, cached, intercepted) cannot be redeemed afterwards.
func DeletePasswordResetTokensForUser(ctx context.Context, database *sql.DB, userID string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM password_reset_tokens WHERE user_id = ?`, userID)
	return err
}

func hashResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
