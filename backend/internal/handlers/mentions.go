package handlers

import (
	"context"
	"database/sql"
	"log"
	"regexp"

	db "lore/internal/db"
)

// Mentions — `@[name](ref)` inline references to campaign entities, typed by the
// GM into scene and entity prose. The authoritative description of the format,
// including why PNJ refs carry no prefix, lives in frontend/src/lib/mentions.ts.
//
// The server's only job with them is to turn refs back into names before
// authored text reaches a model. A prompt containing `@[Rache](3f2a…)` spends
// tokens on a uuid and teaches the model to write uuids back.
var mentionRE = regexp.MustCompile(`@\[([^\]]+)\]\(([^)]+)\)`)

// Kept in step with PREFIXES in frontend/src/lib/mentions.ts. A prefix added
// there and not here degrades to the stored name, which is the same fallback a
// deleted entity gets — wrong, but never garbled.
const (
	artefactMentionPrefix = "artefact:"
	locationMentionPrefix = "location:"
	factionMentionPrefix  = "faction:"
)

// The ref to store when writing a mention. PNJs carry no prefix; see above.
func npcMentionRef(id string) string      { return id }
func artefactMentionRef(id string) string { return artefactMentionPrefix + id }
func locationMentionRef(id string) string { return locationMentionPrefix + id }
func factionMentionRef(id string) string  { return factionMentionPrefix + id }

// mentionResolver maps a stored ref to the name to show a model. Built once per
// request from the campaign's entities, since a single prompt resolves many
// fields.
type mentionResolver struct {
	labels map[string]string
}

// newMentionResolver loads every mentionable entity in the campaign.
//
// A list that fails to load is skipped rather than fatal: the worst case is a
// mention falling back to the name captured when it was typed, which is very
// nearly right. Refusing to generate because one entity table was unreadable
// would be worse.
func newMentionResolver(ctx context.Context, database *sql.DB, campaignID string) mentionResolver {
	m := mentionResolver{labels: map[string]string{}}

	if npcs, err := db.ListCampaignNPCs(ctx, database, campaignID); err == nil {
		for _, n := range npcs {
			// The role is what makes a name useful to a model that has never
			// met this PNJ — kept from when mentions were PNJ-only.
			if n.Role != "" {
				m.labels[n.ID] = n.Name + " (" + n.Role + ")"
			} else {
				m.labels[n.ID] = n.Name
			}
		}
	} else {
		log.Printf("mentions: PNJs unresolved for campaign %s: %v", campaignID, err)
	}

	if arts, err := db.ListCampaignArtefacts(ctx, database, campaignID); err == nil {
		for _, a := range arts {
			m.labels[artefactMentionPrefix+a.ID] = a.Name
		}
	}
	if locs, err := db.ListCampaignLocations(ctx, database, campaignID); err == nil {
		for _, l := range locs {
			m.labels[locationMentionPrefix+l.ID] = l.Name
		}
	}
	if facs, err := db.ListCampaignFactions(ctx, database, campaignID); err == nil {
		for _, f := range facs {
			m.labels[factionMentionPrefix+f.ID] = f.Name
		}
	}
	return m
}

// resolve rewrites every mention in text to a plain name.
//
// Note what this costs: a suggestion generated from resolved text comes back
// with plain names, so accepting it replaces the GM's chips with text. That is
// the right trade — the alternative is a model reasoning about uuids — but it is
// why resolution happens on the way to the model and never on the way to the db.
func (m mentionResolver) resolve(text string) string {
	if text == "" {
		return text
	}
	return mentionRE.ReplaceAllStringFunc(text, func(match string) string {
		sub := mentionRE.FindStringSubmatch(match)
		if len(sub) < 3 {
			return match
		}
		storedName, ref := sub[1], sub[2]
		if label, ok := m.labels[ref]; ok {
			return label
		}
		// The entity is gone. The name it had when mentioned is the only thing
		// left that carries meaning.
		return storedName
	})
}

// resolveAll rewrites the values of a field map in place, for the `current`
// payloads the develop handlers build.
func (m mentionResolver) resolveAll(fields map[string]string) {
	for k, v := range fields {
		fields[k] = m.resolve(v)
	}
}

// mentionsForScenario is the convenience the synopsis handlers need: they know a
// scenario, and mentions are scoped to its campaign. An unreadable scenario
// yields an empty resolver, which falls every mention back to its stored name.
func mentionsForScenario(ctx context.Context, database *sql.DB, scenarioID string) mentionResolver {
	scenario, err := db.GetScenario(ctx, database, scenarioID)
	if err != nil || scenario == nil {
		return mentionResolver{labels: map[string]string{}}
	}
	return newMentionResolver(ctx, database, scenario.CampaignID)
}
