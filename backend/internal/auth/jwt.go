package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims represents the JWT claims for access tokens
type Claims struct {
	UserID string `json:"sub"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// RefreshClaims represents the JWT claims for refresh tokens
type RefreshClaims struct {
	UserID    string `json:"sub"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

// TokenService handles JWT token generation and validation
type TokenService struct {
	secret       []byte
	accessExpiry  time.Duration
	refreshExpiry time.Duration
	signingMethod jwt.SigningMethod
}

// NewTokenService creates a new TokenService
func NewTokenService(secret string, accessExpiry, refreshExpiry time.Duration) *TokenService {
	return &TokenService{
		secret:        []byte(secret),
		accessExpiry:  accessExpiry,
		refreshExpiry: refreshExpiry,
		signingMethod: jwt.SigningMethodHS256,
	}
}

// GenerateAccessToken creates a new access JWT token
func (s *TokenService) GenerateAccessToken(userID, role string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(s.accessExpiry)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(s.signingMethod, claims)
	return token.SignedString(s.secret)
}

// GenerateRefreshToken creates a new refresh JWT token
func (s *TokenService) GenerateRefreshToken(userID string) (string, error) {
	now := time.Now()
	claims := RefreshClaims{
		UserID:    userID,
		TokenType: "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(s.refreshExpiry)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(s.signingMethod, claims)
	return token.SignedString(s.secret)
}

// ParseAccessToken validates and parses an access token
func (s *TokenService) ParseAccessToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.secret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("invalid access token: %w", err)
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid access token")
}

// ParseRefreshToken validates and parses a refresh token
func (s *TokenService) ParseRefreshToken(tokenString string) (*RefreshClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &RefreshClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.secret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("invalid refresh token: %w", err)
	}

	if claims, ok := token.Claims.(*RefreshClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid refresh token")
}

// AccessExpiry returns the access token expiry duration
func (s *TokenService) AccessExpiry() time.Duration {
	return s.accessExpiry
}

// RefreshExpiry returns the refresh token expiry duration
func (s *TokenService) RefreshExpiry() time.Duration {
	return s.refreshExpiry
}

// ParseDuration parses a duration string like "24h", "7d", etc.
func ParseDuration(s string) (time.Duration, error) {
	return time.ParseDuration(s)
}
