# Authorization — who can reach what

Short by design. There are only three rules; the value is in applying all three.

---

## 1. Two layers, not one

A nested URL makes two claims, and both need checking:

```
/api/campaigns/{campaignId}/npcs/{npcId}
                 ▲                 ▲
                 │                 └── does this NPC belong to that campaign?
                 └── do you own this campaign?
```

Checking only the parent is the trap, and it is not theoretical: it left ~20
endpoints reachable across accounts. The owner of *any* campaign could pass
their own `campaignId` — sailing through the ownership guard — together with
someone else's `npcId`, and every handler that looks the child up by id alone
served it. Read, edit and delete, on NPCs, locations, factions, artefacts,
scenes, sessions, beats and brainstorm threads; plus minting the table token of
a session they did not own, which hands over the live table.

| Layer | Guard | Where |
|---|---|---|
| Parent ownership | `requireCampaignOwner`, `requireScenarioOwner`, `requireDraftOwner` | `handlers/access.go` |
| Child parentage | `requireChild(database, parent, child, table, column)` | `handlers/access.go` |

`requireChild` goes on the **route group**, not in the handler, so it covers
every verb underneath — including the LLM and upload sub-routes that are easy
to forget:

```go
r.Route("/{npcId}", func(r chi.Router) {
    r.Use(requireChild(database, "id", "npcId", db.TableNPCs, db.ColCampaignID))
    …
})
```

Two deliberate choices: it answers **404, not 403** (a 403 would confirm the id
exists somewhere), and it has **no superuser bypass** — this is a structural
invariant about what a URL means, not a permission.

### Ids that arrive in the body

Route guards only cover path parameters. An id in a JSON payload — `npc_id` on
a scene link, `location_id` on a scene update, the `ids` array in a reorder —
needs the same check, or it becomes the way in. Use
`db.EntityInCampaign` / `SynopsisHandler.entityInScenarioCampaign`, and scope
bulk writes in the query itself (`ReorderScenesIn` renumbers only scenes in the
scenario, whatever the body says).

## 2. Instance-wide configuration is the administrator's

`PUT /api/settings/*` and every write to `/api/games` require `superuser`
(`requireSuperuser`). Reads stay open — the app needs to know whether an LLM is
configured, and every campaign needs the game list.

This one is worth stating plainly: the LLM settings hold the endpoint **and the
key that every campaign in the instance runs through**. A player who can
repoint `base_url` quietly receives every prompt the server sends — campaign
lore included — while spending the owner's API key.

## 3. What is deliberately open

| Path | Why | Exposure |
|---|---|---|
| `/api/table/{token}` | the projection screen is a TV nobody logs in on | only the current projection and the public roll feed — see [play-table.md](play-table.md) |
| `/uploads/*` | the same screens must load the images the GM projects | UUID paths; a broken image otherwise |
| `/api/auth/{register,login,logout,refresh,csrf,bootstrap}` | the front door | — |

`/external-material/*` (game PDFs) stays **behind auth**: it is not part of the
projection contract.

---

## Known gaps, accepted for now

- **Rate limiting is a stub** (`rateLimitMiddleware`). Dice rolls have their own
  per-session limiter; nothing else is throttled. Fine behind a private
  deployment, not on the open internet.
- **`GET /api/users` returns every user's name and email** to any authenticated
  user, so the campaign-member picker can work. Small-group assumption.
- **No length caps on text fields.** A determined user can store a very large
  campaign lore.

## Regression tests

`internal/handlers/access_test.go` covers the invariants above, plus
`TestRouterBoots` — chi panics at *registration* time on a duplicate route
pattern, so a bad route definition takes the process down on start rather than
on the request that uses it. That test is cheap and catches the most
embarrassing possible failure.
