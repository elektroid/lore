package handlers

import (
	"fmt"
	"strings"

	db "lore/internal/db"
)

// appendCampaignContext appends game system, genre, and lore to sb when set.
func appendCampaignContext(sb *strings.Builder, campaign *db.Campaign) {
	if campaign.GameName != "" {
		sb.WriteString(fmt.Sprintf("\n\nGame system: %s.", campaign.GameName))
	}
	if campaign.Genre != "" {
		sb.WriteString(fmt.Sprintf("\nGenre: %s.", campaign.Genre))
	}
	if campaign.Lore != "" {
		sb.WriteString(fmt.Sprintf("\n\nLore de la campagne :\n%s", campaign.Lore))
	}
}
