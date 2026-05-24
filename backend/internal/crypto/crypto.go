package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
)

// MaskedKey is returned to clients in place of stored key values.
const MaskedKey = "••••••••"

func deriveKey(secret string) []byte {
	h := sha256.Sum256([]byte(secret))
	return h[:]
}

// Encrypt encrypts plaintext with AES-256-GCM and returns a base64-encoded blob.
// Returns "" if plaintext is "".
func Encrypt(secret, plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	block, err := aes.NewCipher(deriveKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

// Decrypt decrypts a base64-encoded AES-256-GCM blob produced by Encrypt.
// Falls back to returning the raw value unchanged for legacy plaintext keys,
// so existing unencrypted values remain readable until the next save.
func Decrypt(secret, stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	data, err := base64.StdEncoding.DecodeString(stored)
	if err != nil {
		// Not base64 → legacy plaintext key, pass through.
		return stored, nil
	}
	block, err := aes.NewCipher(deriveKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	ns := gcm.NonceSize()
	if len(data) < ns {
		// Too short to be a valid blob → legacy plaintext.
		return stored, nil
	}
	pt, err := gcm.Open(nil, data[:ns], data[ns:], nil)
	if err != nil {
		// Auth failure → legacy plaintext key, pass through.
		return stored, nil
	}
	return string(pt), nil
}

// IsMasked reports whether v is the sentinel returned by GET endpoints.
func IsMasked(v string) bool {
	return v == MaskedKey
}

