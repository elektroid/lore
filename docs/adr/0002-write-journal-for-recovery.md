# ADR-0002 — A write journal, so a lost edit is recoverable rather than gone

**Status:** proposed
**Date:** 2026-09-09

## Context

An author wrote a synopsis in production, navigated away inside the app, came
back, and most of what they had written was gone. Three separate defects could
each have caused it, and only one of them was reproducible from the report:

1. The Synopsis toolbar's **Entités** button was a raw `<a href>`, so leaving
   the page that way was a full document load. The 1 500 ms autosave timer died
   with the page and no request was ever sent. Reproduced: everything typed
   since the last pause was lost, silently, with no error.
2. `GenerateOverview` wrote the whole synopsis row back from a copy read
   *before* its LLM call — reverting anything typed during those tens of
   seconds, and flattening `@[name](ref)` mentions into plain text on the way.
3. A window-focus refetch landing after a write re-seated pre-write data in the
   query cache; the next full-record PUT then saved that stale copy back.

All three are fixed. That is not the point of this ADR.

The point is that **we could not tell which one had happened.** The server kept
no record of the writes it received, the client kept no record of the writes it
meant to send, and the author's text existed nowhere but in a database row that
something else had already overwritten. Diagnosis took a rebuilt binary, a stub
LLM and a scripted browser. Recovery was not possible at all.

Until the app is genuinely production-ready, the class of bug matters more than
any instance of it: every autosaving field in this app is a full-record PUT, and
a full-record PUT is a loaded gun pointed at whatever the client's copy is stale
about. We will keep finding these. What we need is for finding one to be cheap,
and for the author's words to survive it.

`synopsis_snapshots` already exists and is the right instinct, but it is not
this: it only covers the synopsis hook, only when an LLM action fires, keeps 20
entries, and stores no author, no time-of-edit and no diff.

## Decision

Add a **write journal**: an append-only record of every mutating request the
server accepts, storing the row as it was *before* the write and the payload
that changed it. Expose it read-only to superusers as a **Journal** panel in
`/admin`, with a diff view and a one-click restore of any prior version.

It is a debug facility with a retention window, not a version-control feature
and not an undo stack. It is expected to be turned off — or down — once the app
stops eating people's prose.

### Data model

One table, no foreign keys (a journal that can fail to write is worse than
useless, and a cascade delete that erases the record of a deletion is absurd):

```sql
CREATE TABLE write_journal (
  id          TEXT PRIMARY KEY,
  at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_id     TEXT NOT NULL,          -- no FK: keep the record if the user goes
  user_email  TEXT NOT NULL,          -- denormalised, so it survives too
  method      TEXT NOT NULL,          -- PUT / POST / PATCH / DELETE
  path        TEXT NOT NULL,          -- /api/scenarios/…/synopsis
  entity      TEXT NOT NULL,          -- "synopsis", "scene", "npc", …
  entity_id   TEXT NOT NULL,
  before      TEXT NOT NULL,          -- JSON: the row as it was, "" on create
  payload     TEXT NOT NULL,          -- JSON: the request body, redacted
  status      INTEGER NOT NULL,       -- what we answered
  request_id  TEXT NOT NULL           -- correlates with the access log
);
CREATE INDEX idx_write_journal_entity ON write_journal (entity, entity_id, at DESC);
CREATE INDEX idx_write_journal_at     ON write_journal (at DESC);
```

`before` is the crucial column and the reason this is not just request logging:
it is what makes a lost edit *recoverable*, not merely explicable. A write that
reverts a paragraph leaves the paragraph sitting in the next row's `before`.

> **Migration note.** `schema.sql` is `go:embed`-ed and re-run on every rebuild,
> and an index over a column that does not exist aborts the whole migration and
> takes the dev server down with it (`main.go` treats a `Migrate` error as
> `log.Fatalf`). Add the table and its indexes in the same statement block, and
> check the migration landed rather than assuming — see CLAUDE.md § hot reload.

### Where it hooks in

A single chi middleware wrapping the authenticated `/api` routes, not a call in
every handler — an audit trail with per-handler opt-in is an audit trail with
holes in it. The middleware:

1. Skips `GET`/`HEAD`, and skips paths on a small deny-list (`/auth/*`,
   `/settings/llm`, `/settings/image`, anything carrying a credential).
2. Derives `entity`/`entity_id` from the route pattern, so it needs no handler
   cooperation: chi exposes the matched pattern and its URL params.
3. Reads the current row *before* calling the handler, via a per-entity
   `snapshot(ctx, db, id) (string, error)` registered in one table in the
   journal package. An entity with no snapshotter journals the request without a
   `before` rather than not journalling at all.
4. Calls the handler, capturing the status.
5. Writes the journal row **after** responding, on a buffered channel drained by
   one goroutine — the author must never wait on the journal, and a full buffer
   drops journal rows, never requests.
6. Redacts: any payload field named `password`, `api_key`, `secret`, `token`.

### Retention

Two knobs in `lore.toml`, both defaulting to on because this exists precisely
for the period when we do not yet trust the app:

```toml
[journal]
enabled   = true
retain    = "30d"   # rows older than this are pruned hourly
max_bytes = "500MB" # oldest-first prune if the table exceeds this
```

Prose is small; 30 days of a handful of authors is tens of megabytes. The
`max_bytes` cap is there so an image-heavy or runaway payload cannot fill the
disk the live database sits on.

### What the UI offers

In `/admin`, a **Journal** tab beside the existing audit log (they stay
separate: [[project_admin_audit_log]] is a deliberately narrow record of
sensitive *admin* actions, and drowning it in every keystroke-batch PUT would
destroy the thing it is good at):

- A filterable list — by author, entity, time range, path.
- A row expands to a **field-level diff** of `before` against `payload`,
  rendered with the same prose renderer as everywhere else, so a mention or a
  bold run reads as a mention or a bold run.
- **Restaurer cette version** on any row: writes `before` back through the
  normal handler, and is itself journalled. Restoring is a write like any other.

And, for the author rather than the admin, the smaller half of the feature: on
the Synopsis page, a discreet **Historique** affordance listing that scenario's
own journal rows with the same diff and restore. The person who lost the
paragraph should not have to ask a superuser to get it back.

### What this is not

- **Not an undo stack.** No inverse operations, no redo, no ordering guarantees
  across entities. Restore is "write this old value back", nothing cleverer.
- **Not a replacement for backups.** It lives in the same SQLite file it is
  protecting. A backup story is a separate, and still necessary, decision.
- **Not conflict detection.** It records what happened; it does not stop the
  next stale full-record PUT from happening. The narrow-writes rule in DESIGN.md
  is what does that. The journal is how we find out we broke the rule again.

## Consequences

- Every write costs one extra SELECT (the `before` snapshot) on the request
  path, plus an asynchronous INSERT. On prose-sized rows in SQLite this is
  microseconds, and the debounce means writes are already rare per author.
- The live database grows. Bounded by the two retention knobs, monitored by
  showing the table's size at the top of the Journal tab.
- The journal contains the full text of everything anyone writes, including a
  player's private run notes. It is superuser-only, it is redacted for
  credentials, and it inherits the same disclosure risk as the database itself —
  which is to say, turning it off is a real decision and the config makes it a
  one-liner.
- Adding an entity type means registering a snapshotter, or accepting a
  `before`-less journal row for it. The middleware never needs touching.

## Alternatives considered

**Client-side draft persistence (localStorage).** Cheap, and it would have saved
the reported paragraph. But it only protects the browser that typed the text, is
invisible to us when we are trying to diagnose, and creates its own class of bug
(a stale draft resurrecting over a newer server version). Worth adding later as
a belt-and-braces for the editor specifically; not a substitute for a record of
what the server actually did.

**Extending `synopsis_snapshots` to every entity.** Snapshot-per-entity-table
means N migrations, N handlers remembering to call it, and the same opt-in holes
we are trying to close. One journal, one middleware.

**A `sqlite3` `.backup` on a timer.** Recovers everything or nothing, at
whatever granularity the timer has, and answers no diagnostic question at all.
Complementary — it is the backup story, not this.
