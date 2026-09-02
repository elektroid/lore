# Code audit — 2026-09-03

Full-repo review for code-rot and "vibe-coding" slop: dead code, duplication,
inefficiency, and drift from the app's own documented conventions
(`CLAUDE.md`). Read-only — nothing here has been patched. Backend (~21k lines
Go) and frontend (~18.5k lines TS/React) were reviewed separately; every
finding below was spot-checked against the actual source (grep/read), not
taken on the auditor's word alone.

**Headline**: the codebase is in noticeably better shape than "a while
vibe-coding" usually produces. No dead code in the backend, no `TODO`/`FIXME`/
`HACK` litter anywhere, clean TypeScript hygiene (no `any`, no
`@ts-ignore`, no stray `console.log`), CSRF and pagination handled
consistently, and the project's own documented rules (runs vs. story
separation, entity-list-item pattern) are actually followed, not just
written down. The issues found are real but concentrated in a few
well-defined spots, not spread evenly through the app.

---

## Backend (Go)

### Must

- ~~**`Import` game handler has no transaction wrapping.**~~ **Fixed
  2026-09-03.** `backend/internal/handlers/games.go`'s `Import` now runs
  its whole body inside one `h.db.BeginTx`/`tx.Commit`, with `defer
  tx.Rollback()` covering every early return. This needed the db-layer
  functions `Import` calls (`GetGame`, `GetGameBySlug`, `CreateGame`,
  `UpdateGameVisualStyle`, `GetSheetTemplate`, `GetSheetTemplateByName`,
  `CreateSheetTemplate`, `CreateGameLoreEntity`,
  `UpsertGameLoreEntityRelation`) to accept a new `db.DBTX` interface
  (satisfied by both `*sql.DB` and `*sql.Tx`) instead of a concrete
  `*sql.DB`, added in `internal/db/db.go` — every other call site keeps
  compiling unchanged since `*sql.DB` still satisfies the interface.
  Verified: `go build`/`go vet`/`go test ./...` all pass, and a live
  create/get/update/delete/generate-images/confirm-images round trip
  against the running dev backend behaved identically to before.

### Should

- ~~**CRUD handlers are copy-pasted per entity type instead of shared.**~~
  **Fixed 2026-09-03.** `backend/internal/handlers/entities.go`'s
  `List/Get/Create/Update/Delete` for NPC/Location/Artefact/Faction now go
  through four new generics in `router.go` — `writeList`, `writeEntity`,
  `writeCreated`, `writeDeleted`, plus a `decodeJSON[T]` for the
  Create/Update body — while every status code, error message string, and
  db-call signature stayed byte-for-byte the same (verified by curl against
  the live dev backend: create/get/get-404/update/delete/list all matched
  prior behavior exactly). `entities.go` dropped from 379 to 246 lines. The
  same pattern in `entity_image_llm.go`'s Generate/Confirm image handling
  (NPC/Location/Faction) and `artefact_llm.go`'s Artefact copy is also
  fixed: a shared `generateEntityImages`/`confirmEntityImages` pair now
  does the config/pending-dir/agent/spawn scaffolding once, parameterized
  by kind-specific closures for prompt-building and the one real
  per-kind difference (`LocationImage`'s extra `Type` field). Combined,
  `entity_image_llm.go` + `artefact_llm.go` dropped from ~592 to 402 lines.
  Live-tested end to end (including an actual `generate-images` call against
  the real dev backend) with no behavior change. One sub-finding is
  deliberately left as-is: `DevelopNPC/Location/Faction` still hang off
  `*EntityHandler` while `DevelopArtefact` hangs off `*ImageLLMHandler` —
  moving it would mean reshuffling which handler struct owns which LLM
  config/mention-resolver dependencies, which is a naming/organization
  question, not duplicated logic, so it was left for a separate pass.
- **`internal/db` (27 files, all persistence/transactional-write logic) has
  zero test files.** Contrast with `internal/handlers`, which has some
  coverage (`runs_test.go`, `access_test.go`, `proposal_test.go`). The
  transaction-heavy writers in `archive.go`, `game_lore.go`, `synopses.go`
  are exactly the code where a regression is expensive and silent.
- **`backend/internal/handlers/auth.go` (678 lines: login, registration,
  password reset, refresh) has no dedicated test file**, despite the
  adjacent authorization surface (`access.go`) being tested in
  `access_test.go`. This is the highest-value gap given it's the
  authentication path itself.
- **Raw internal error strings are forwarded to HTTP clients systemically.**
  235 of 622 `writeError(...)` call sites across `backend/internal/handlers`
  do `writeError(w, http.StatusInternalServerError, err.Error())` — the raw
  Go/SQL error text goes straight into the response body. Every handler
  package does this; it's a pattern, not a one-off. Low urgency for a
  single-tenant/self-hosted app, but it leaks SQL/driver internals to callers
  and blocks ever introducing a safe generic 500 message without touching
  every call site.

### Could

- `internal/llm`, `internal/mail`, `internal/crypto`, `internal/web` have no
  tests. `crypto` (API-key encryption/rotation) is the one worth prioritizing
  if this list is ever acted on — its own comments describe a fallback/
  rotation trap that a test would pin down.
- `db.go`'s `MigrateAlters` list (~45 entries, lines 39–83) is a
  strictly-additive `ALTER TABLE` list kept forever for old-database
  compatibility. This is deliberate and well-documented (in both the code
  and `CLAUDE.md`), not oversight, and it's safe as-is — flagged only because
  at some point a "baseline reset for fresh installs" could squash it back
  into `schema.sql`. No forcing function to do this now.

### Explicitly clean (no action needed)

No dead code, no `TODO`/`FIXME`/`HACK`/`XXX` anywhere in the backend. No
violations of the CLAUDE.md-documented story/play separation —
`synopsis_scenes.played`, `sessions.players`, `session_players` stay dropped
and guarded (`dropLegacyPlayData`/`hasLegacyPlayData`); no play-state columns
have crept onto `synopsis_scenes`/`scenarios`/`campaigns`; no `run_scenes`
table exists. Secrets are handled correctly (env-only, never argv) in both
CLI tools. CORS defaults are conservative (`localhost:5173` only, not `*`).

---

## Frontend (React/TypeScript)

### Must

- ~~**29 of 31 files that call `useMutation` have no `onError` handler, and
  the app has no toast/notification library at all.**~~ **Fixed 2026-09-03.**
  Added `frontend/src/stores/toast.ts` (a small zustand store with an
  imperative `toast.error()/success()` API) and
  `frontend/src/components/ui/Toaster.tsx`, mounted once at the root in
  `App.tsx`. Wired as a global fallback via
  `new QueryClient({ mutationCache: new MutationCache({ onError }) })` in
  `main.tsx`, so every mutation that doesn't define its own `onError` now
  surfaces the backend's error message as a toast instead of failing
  silently — no per-file changes needed across the 29 call sites. Mutations
  that already show an inline error (`ImprovPanel.tsx`,
  `ScenarioFactoryPage.tsx`) are unaffected; a mutation-level `onError`
  still runs in addition to the global one. Verified: `tsc -b --noEmit`,
  `eslint`, and `vite build` all pass; confirmed against the real dev
  backend that a failed write (`PUT /api/campaigns/does-not-exist` →
  `{"error":"campaign not found"}`, HTTP 404) produces exactly the message
  the toast will render, end to end through `api/client.ts`'s error
  parsing. No toast library was added as a dependency — this is ~70 lines
  of new code reusing the project's existing zustand/Tailwind conventions.

### Should

- ~~**Image-management logic is hand-copied four times.**~~ **Fixed
  2026-09-03.** Extracted `frontend/src/hooks/useEntityImages.ts` — a
  generic hook providing the upload/delete/generate/confirm mutations
  shared by all four editors, parameterized by entity/image type and the
  URL kind segment. `NPCEditorModal.tsx`, `LocationEditorModal.tsx`,
  `FactionEditorModal.tsx` and `ArtefactEditorModal.tsx` now all call it;
  Location's one genuine outlier (the `type`/label `updateMeta` mutation,
  which has no equivalent on the other three kinds) stays local to
  `LocationEditorModal.tsx` rather than being forced into the shared hook.
  Each modal's own JSX/visual layout was deliberately left untouched —
  Artefact's compact flex-wrap grid is a real, pre-existing design
  difference from the other three's drag-and-drop grid, not slop, so
  unifying presentation was out of scope for a duplication fix. Verified
  with `tsc -b --noEmit`, `eslint`, and `vite build`, plus a full read of
  every changed call site against the originals.
- ~~**`AutoTextarea` is separately redefined**~~ **Fixed 2026-09-03.**
  Extracted to `frontend/src/components/ui/AutoTextarea.tsx`, matching the
  project's `components/ui/` primitives convention; both call sites updated.
- ~~**`onUpdated` callbacks lie about their type.**~~ **Fixed 2026-09-03,**
  as a consequence of centralizing the image mutations above — the shared
  hook's `onUpdated` is now typed `(patch: Partial<TEntity>) => void`
  everywhere, and every call site (all four modals) updates the cache via
  `patchCachedItem`/`patchCachedListItem` instead of a full-object cast.
  This is a real behavior improvement, not just a type fix: the old
  `qc.setQueryData(['npc', id], { ...({} as CampaignNPC), images: ... })`
  after a delete overwrote every other cached field with `undefined` until
  the next refetch; the merge-patch never does.
- **`PlayPage.tsx` is a 1029-line God-component.** The default export alone
  owns 10 `useState`, 12 `useQuery`, 11 `useMutation`, and the file also
  defines six more components inline (`SessionModal`, `RosterDialog`,
  `PlaySceneRow`, `NpcDetailDialog`, `LocationDetailDialog`,
  `PlayScenePanel`) instead of splitting them into `components/play/`, which
  is exactly the pattern the project already uses for the synopsis screen
  (`components/synopsis/*`). Worth doing before this file grows further.
- **Two dead files, never deleted after a refactor.**
  `components/synopsis/NPCWidget.tsx` (406 lines) and
  `components/synopsis/SnapshotSidebar.tsx` (110 lines) are both confirmed
  unreferenced anywhere else in the tree (`grep` for each name outside its
  own file returns nothing) — superseded during the scene-based synopsis
  redesign but never removed. Low risk, but they read as live UI to anyone
  skimming the directory.
- **`ProtectedRoute`'s `requiredRole` prop is a dead scaffold.**
  `components/ProtectedRoute.tsx:6,28–33` — the prop is declared and typed
  but the role-check body is commented out with `// Note: This is a
  placeholder - you'll need to implement role checking`. Either implement it
  or remove the prop and the placeholder comment; right now it looks like
  route-level role gating exists when it doesn't.

### Could

- **No route-level code splitting.** `App.tsx` eagerly imports all ~20 pages
  into the main bundle. By contrast, `TablePage.tsx`/`ProjectionPanel.tsx`
  already `lazy()`-load the 1.5MB Excalidraw bundle with a comment
  explaining why — the pattern exists in the codebase, it's just not applied
  to routes generally. `React.lazy` on page-level routes would shrink the
  initial JS payload.
- **Query keys are hand-typed string-array literals in 8+ places**
  (`ArtefactEditorModal.tsx`, `NPCWidget.tsx`, `NPCEditorModal.tsx`,
  `ProjectionPanel.tsx`, `ScenarioFactoryPage.tsx`,
  `useCampaignMentions.ts`, `SceneDetail.tsx`, `CampaignEntitiesPage.tsx`,
  …), across 82 total `invalidateQueries` calls. Works today, but a typo in
  any one call site silently breaks cache invalidation with no compile-time
  safety. A small query-key factory module would make that class of bug
  impossible instead of just unlikely.
- **9 non-null assertions (`!`)**, 7 of them in `PlayPage.tsx`, 1 in
  `SynopsisPage.tsx` — all of the form `scenario!.campaign_id` inside
  callbacks where an earlier guard makes it locally safe today. Low risk,
  but a narrowed local variable would let the compiler verify the
  invariant instead of the reader having to trust it.

### Explicitly clean (no action needed)

No `any`, no `@ts-ignore`/`@ts-expect-error`, no stray `console.log`/
`debugger`, no `TODO`/`FIXME` anywhere in `frontend/src`. The
CLAUDE.md-documented entity-list-item pattern (clickable `<button>` name,
`EntityAvatar`, two-line metadata cap) is actually followed consistently
across NPCs/Locations/Factions/Artefacts and reused correctly in
`CampaignsPage.tsx`/`GamesPage.tsx` — no drift found there.

---

## Suggested order of attack

1. ~~Frontend `onError`/toast gap (Must)~~ — done, see above.
2. ~~Backend `Import` transaction (Must)~~ — done, see above.
3. ~~The two duplication clusters (backend entity CRUD + image-LLM,
   frontend `ImageGrid`/`AutoTextarea`)~~ — done, see above. The one
   deliberately-skipped sub-item (`DevelopArtefact`'s handler-struct
   placement) is noted inline above.
4. Test gaps (`internal/db`, `auth.go`) — before the next round of changes
   to either, not urgent in isolation. Not attempted this pass (explicitly
   out of scope).
5. Everything in Could — nice-to-haves, no forcing function. Not attempted
   this pass (explicitly out of scope).
