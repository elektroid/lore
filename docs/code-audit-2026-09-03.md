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

- **`Import` game handler has no transaction wrapping.**
  `backend/internal/handlers/games.go`, `Import` (~line 683–748). Restoring a
  game export does a sequence of individual `Exec`/`Create*` calls — game row,
  sheet template, then one `CreateGameLoreEntity`/`UpsertGameLoreEntityRelation`
  per entity/relation in the import file — with no `Begin`/`Commit`/`Rollback`
  around any of it. Every other multi-statement writer in the codebase
  (`archive.go`, `game_lore.go`, `scenarios.go`, `synopses.go`) wraps in a
  transaction; this one doesn't. A failure partway through an import (bad
  entity 150 of 300, disk full, etc.) leaves an orphaned game row and a
  half-populated lore graph, with no automatic way back — an admin has to
  clean it up by hand in the DB. Fix: wrap the whole import body in one `Tx`.

### Should

- **CRUD handlers are copy-pasted per entity type instead of shared.**
  `backend/internal/handlers/entities.go` — `List/Get/Create/Update/Delete`
  for NPC, Location, Artefact, Faction (lines 21–366) are ~90 lines each,
  identical in shape and differing only in the type name and the French
  error string. Same pattern repeats in
  `backend/internal/handlers/entity_image_llm.go` (Generate/Confirm image
  handling, ~60 lines × 3, plus a fourth near-copy for Artefact in
  `artefact_llm.go`). A generic helper or table-driven dispatch would cut
  roughly 250+ lines and — more importantly — mean a bug fix only has to
  happen once. One drift already visible from this: `DevelopNPC/Location/
  Faction` all hang off `*EntityHandler`, but `DevelopArtefact` hangs off a
  different type (`*ImageLLMHandler`) — a sign Artefact support was bolted on
  later without reconciling with its three siblings.
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

- **Image-management logic is hand-copied four times.**
  `NPCEditorModal.tsx`, `LocationEditorModal.tsx`, `FactionEditorModal.tsx`
  each define a near-identical local `ImageGrid` component (~130 lines each:
  upload/delete/generate/confirm mutations, drag-drop, lightbox);
  `ArtefactEditorModal.tsx` inlines the same five mutations again instead of
  using a shared component (confirmed: `generateImages`, `confirmImages`,
  `uploadImage`, `deleteImage` all redefined at lines 129–163). The
  duplication has already caused drift: Location's copy gained a
  `type`/`updateMeta` mutation the other three don't have. Extract one
  `useEntityImages(kind, campaignId, entityId)` hook plus a generic
  `<EntityImageGrid>`; today a bug fix or new feature here has to be applied
  by hand in four places, and one already lags behind.
- **`AutoTextarea` is separately redefined** in both `NPCEditorModal.tsx:37`
  and `CharacterEditorModal.tsx:19` with slightly different props — smaller
  version of the same problem.
- **`onUpdated` callbacks lie about their type.** `NPCEditorModal.tsx:84`,
  `LocationEditorModal.tsx:76`, `FactionEditorModal.tsx:47` all do
  `onUpdated({ ...({} as CampaignNPC), images: ... })` — an empty object
  cast to the full entity type to satisfy a callback that's really only
  ever used as a partial patch. This defeats the type checker: nothing stops
  a future callee from reading an unset field off the "full" object and
  silently getting `undefined`. Type `onUpdated` as `(patch: Partial<T>) =>
  void` instead.
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
2. Backend `Import` transaction (Must) — low-frequency but real data
   integrity risk, and a small fix. Still open.
3. The two duplication clusters (backend entity CRUD, frontend
   `ImageGrid`/`AutoTextarea`) — same root cause on both sides
   (copy-pasted-per-entity-type instead of parameterized), worth doing
   together since fixing the pattern once teaches the fix for the other.
4. Test gaps (`internal/db`, `auth.go`) — before the next round of changes
   to either, not urgent in isolation.
5. Everything in Could — nice-to-haves, no forcing function.
