-- name: ListCampaigns :many
SELECT id, name, genre, game, lore, llm_config, created_at, updated_at
FROM campaigns
ORDER BY updated_at DESC;

-- name: GetCampaign :one
SELECT id, name, genre, game, lore, llm_config, created_at, updated_at
FROM campaigns WHERE id = ?;

-- name: CreateCampaign :one
INSERT INTO campaigns (id, name, genre, game, lore, llm_config)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: UpdateCampaign :one
UPDATE campaigns
SET name=?, genre=?, game=?, lore=?, llm_config=?, updated_at=CURRENT_TIMESTAMP
WHERE id=?
RETURNING *;

-- name: DeleteCampaign :exec
DELETE FROM campaigns WHERE id=?;
