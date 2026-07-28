package db

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// User represents a user account
type User struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	PasswordHash  string `json:"-"` // Not returned in JSON
	Name          string `json:"name"`
	Role          string `json:"role"`
	EmailVerified bool   `json:"email_verified"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

// CreateUserParams parameters for creating a user
type CreateUserParams struct {
	Email    string
	Password string
	Name     string
	Role     string
}

// GetUserByID retrieves a user by ID
func GetUserByID(ctx context.Context, database *sql.DB, id string) (*User, error) {
	row := database.QueryRowContext(ctx, 
		`SELECT id, email, password_hash, name, role, email_verified, created_at, updated_at FROM users WHERE id = ?`, id)

	u := &User{}
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.EmailVerified, &u.CreatedAt, &u.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

// GetUserByEmail retrieves a user by email
func GetUserByEmail(ctx context.Context, database *sql.DB, email string) (*User, error) {
	row := database.QueryRowContext(ctx,
		`SELECT id, email, password_hash, name, role, email_verified, created_at, updated_at FROM users WHERE email = ?`, email)

	u := &User{}
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.EmailVerified, &u.CreatedAt, &u.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

// CreateUser creates a new user
func CreateUser(ctx context.Context, database *sql.DB, p CreateUserParams) (*User, error) {
	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(p.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	// Default role if not specified
	role := p.Role
	if role == "" {
		role = "player"
	}

	id := uuid.New().String()
	_, err = database.ExecContext(ctx,
		`INSERT INTO users (id, email, password_hash, name, role, email_verified) VALUES (?, ?, ?, ?, ?, FALSE)`,
		id, p.Email, string(hashedPassword), p.Name, role)
	if err != nil {
		return nil, err
	}

	return GetUserByID(ctx, database, id)
}

// ListUsers returns all users (superuser only)
func ListUsers(ctx context.Context, database *sql.DB) ([]User, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, email, password_hash, name, role, email_verified, created_at, updated_at FROM users ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		u := User{}
		if err := rows.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.EmailVerified, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// UpdateUser updates a user's profile
func UpdateUser(ctx context.Context, database *sql.DB, id, name, email string) (*User, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE users SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		name, email, id)
	if err != nil {
		return nil, err
	}
	return GetUserByID(ctx, database, id)
}

// UpdateUserPassword updates a user's password
func UpdateUserPassword(ctx context.Context, database *sql.DB, id, password string) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = database.ExecContext(ctx,
		`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		string(hashedPassword), id)
	return err
}

// UpdateUserRole sets a user's role
func UpdateUserRole(ctx context.Context, database *sql.DB, id, role string) (*User, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, role, id)
	if err != nil {
		return nil, err
	}
	return GetUserByID(ctx, database, id)
}

// DeleteUser deletes a user
func DeleteUser(ctx context.Context, database *sql.DB, id string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	return err
}

// CheckPassword verifies a password against the stored hash
func (u *User) CheckPassword(password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil
}

// CampaignMember represents a user's membership in a campaign
type CampaignMember struct {
	ID         string `json:"id"`
	CampaignID string `json:"campaign_id"`
	UserID     string `json:"user_id"`
	UserName   string `json:"user_name"`
	UserEmail  string `json:"user_email"`
	CreatedAt  string `json:"created_at"`
}

// IsCampaignMember checks if a user is a member of a campaign
func IsCampaignMember(ctx context.Context, database *sql.DB, campaignID, userID string) (bool, error) {
	var count int
	err := database.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM campaign_members WHERE campaign_id = ? AND user_id = ?`, campaignID, userID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// MemberWithCharacters is a campaign member and their characters for the campaign's game system.
type MemberWithCharacters struct {
	UserID     string          `json:"user_id"`
	UserName   string          `json:"user_name"`
	UserEmail  string          `json:"user_email"`
	Characters []PlayerCharacter `json:"characters"`
}

// ListCampaignMemberCharacters returns all campaign members with their player characters
// filtered to the campaign's game system. Characters is empty for members with none.
func ListCampaignMemberCharacters(ctx context.Context, database *sql.DB, campaignID string) ([]MemberWithCharacters, error) {
	// Resolve the campaign's game_id first
	var gameID string
	if err := database.QueryRowContext(ctx,
		`SELECT game_id FROM campaigns WHERE id=?`, campaignID).Scan(&gameID); err != nil {
		return nil, err
	}

	rows, err := database.QueryContext(ctx, `
		SELECT u.id, u.name, u.email,
		       COALESCE(pc.id,''), COALESCE(pc.game_id,''), COALESCE(g.name,''),
		       COALESCE(pc.name,''), COALESCE(pc.description,''), COALESCE(pc.personal_story,''),
		       COALESCE(pc.created_at,''), COALESCE(pc.updated_at,'')
		FROM campaign_members cm
		JOIN users u ON u.id = cm.user_id
		LEFT JOIN player_characters pc ON pc.user_id = u.id AND pc.game_id = ?
		LEFT JOIN games g ON g.id = pc.game_id
		WHERE cm.campaign_id = ?
		ORDER BY u.name, pc.name`, gameID, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byUser := map[string]*MemberWithCharacters{}
	order := []string{}
	for rows.Next() {
		var userID, userName, userEmail string
		var pc PlayerCharacter
		if err := rows.Scan(
			&userID, &userName, &userEmail,
			&pc.ID, &pc.GameID, &pc.GameName,
			&pc.Name, &pc.Description, &pc.PersonalStory,
			&pc.CreatedAt, &pc.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if _, ok := byUser[userID]; !ok {
			byUser[userID] = &MemberWithCharacters{UserID: userID, UserName: userName, UserEmail: userEmail, Characters: []PlayerCharacter{}}
			order = append(order, userID)
		}
		if pc.ID != "" {
			pc.UserID = userID
			byUser[userID].Characters = append(byUser[userID].Characters, pc)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]MemberWithCharacters, 0, len(order))
	for _, id := range order {
		result = append(result, *byUser[id])
	}
	return result, nil
}

// ListCampaignMembers returns all members of a campaign
func ListCampaignMembers(ctx context.Context, database *sql.DB, campaignID string) ([]CampaignMember, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT cm.id, cm.campaign_id, cm.user_id, u.name, u.email, cm.created_at
		FROM campaign_members cm
		JOIN users u ON u.id = cm.user_id
		WHERE cm.campaign_id = ?
		ORDER BY cm.created_at DESC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := []CampaignMember{}
	for rows.Next() {
		m := CampaignMember{}
		if err := rows.Scan(&m.ID, &m.CampaignID, &m.UserID, &m.UserName, &m.UserEmail, &m.CreatedAt); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

// AddCampaignMember adds a user to a campaign
func AddCampaignMember(ctx context.Context, database *sql.DB, campaignID, userID string) error {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO campaign_members (id, campaign_id, user_id) VALUES (?, ?, ?)`,
		id, campaignID, userID)
	return err
}

// RemoveCampaignMember removes a user from a campaign
func RemoveCampaignMember(ctx context.Context, database *sql.DB, campaignID, userID string) error {
	_, err := database.ExecContext(ctx,
		`DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?`,
		campaignID, userID)
	return err
}

// PlayerCharacter represents a player's character
type PlayerCharacter struct {
	ID           string `json:"id"`
	UserID      string `json:"user_id"`
	GameID      string `json:"game_id"`
	GameName    string `json:"game_name"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PersonalStory string `json:"personal_story"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// CreatePlayerCharacterParams parameters for creating a player character
type CreatePlayerCharacterParams struct {
	UserID      string
	GameID      string
	Name        string
	Description string
	PersonalStory string
}

// UpdatePlayerCharacterParams parameters for updating a player character
type UpdatePlayerCharacterParams struct {
	Name           string
	Description   string
	PersonalStory string
}

// ListPlayerCharacters returns all characters for a user
func ListPlayerCharacters(ctx context.Context, database *sql.DB, userID string) ([]PlayerCharacter, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT pc.id, pc.user_id, pc.game_id, g.name as game_name, pc.name, pc.description, pc.personal_story, pc.created_at, pc.updated_at
		FROM player_characters pc
		LEFT JOIN games g ON g.id = pc.game_id
		WHERE pc.user_id = ?
		ORDER BY pc.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chars := []PlayerCharacter{}
	for rows.Next() {
		c := PlayerCharacter{}
		if err := rows.Scan(&c.ID, &c.UserID, &c.GameID, &c.GameName, &c.Name, &c.Description, &c.PersonalStory, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		chars = append(chars, c)
	}
	return chars, rows.Err()
}

// CharacterBelongsToUser reports whether a character is this user's. The GM
// assigns characters to their party from a campaign-scoped route, which proves
// nothing about a character id arriving in the body.
func CharacterBelongsToUser(ctx context.Context, database *sql.DB, characterID, userID string) (bool, error) {
	if characterID == "" || userID == "" {
		return false, nil
	}
	var n int
	err := database.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM player_characters WHERE id = ? AND user_id = ?`,
		characterID, userID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// GetPlayerCharacter returns a single character by ID
func GetPlayerCharacter(ctx context.Context, database *sql.DB, id, userID string) (*PlayerCharacter, error) {
	row := database.QueryRowContext(ctx, `
		SELECT pc.id, pc.user_id, pc.game_id, g.name as game_name, pc.name, pc.description, pc.personal_story, pc.created_at, pc.updated_at
		FROM player_characters pc
		LEFT JOIN games g ON g.id = pc.game_id
		WHERE pc.id = ? AND pc.user_id = ?`, id, userID)

	c := &PlayerCharacter{}
	err := row.Scan(&c.ID, &c.UserID, &c.GameID, &c.GameName, &c.Name, &c.Description, &c.PersonalStory, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return c, err
}

// CreatePlayerCharacter creates a new player character
func CreatePlayerCharacter(ctx context.Context, database *sql.DB, p CreatePlayerCharacterParams) (*PlayerCharacter, error) {
	id := uuid.New().String()
	_, err := database.ExecContext(ctx,
		`INSERT INTO player_characters (id, user_id, game_id, name, description, personal_story) VALUES (?, ?, ?, ?, ?, ?)`,
		id, p.UserID, p.GameID, p.Name, p.Description, p.PersonalStory)
	if err != nil {
		return nil, err
	}
	return GetPlayerCharacter(ctx, database, id, p.UserID)
}

// UpdatePlayerCharacter updates a player character
func UpdatePlayerCharacter(ctx context.Context, database *sql.DB, id, userID string, p UpdatePlayerCharacterParams) (*PlayerCharacter, error) {
	_, err := database.ExecContext(ctx,
		`UPDATE player_characters SET name = ?, description = ?, personal_story = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
		p.Name, p.Description, p.PersonalStory, id, userID)
	if err != nil {
		return nil, err
	}
	return GetPlayerCharacter(ctx, database, id, userID)
}

// DeletePlayerCharacter deletes a player character
func DeletePlayerCharacter(ctx context.Context, database *sql.DB, id, userID string) error {
	_, err := database.ExecContext(ctx, `DELETE FROM player_characters WHERE id = ? AND user_id = ?`, id, userID)
	return err
}
