# End-to-end suite

```bash
make check-e2e
```

Builds the real production binary (`make build`), boots it on `127.0.0.1:8097`
against a throwaway SQLite file under `/tmp`, seeds a game/campaign/scenario,
drives it with Chromium, then tears the whole thing down. **It never touches
`backend/lore.db`** — see CLAUDE.md § smoke-testing.

Everything in `tests/` is a regression that reached production. The suite is
worth keeping only as long as that stays true: add a spec when a bug escapes,
not to cover code that has never broken.

| Spec | What escaped |
|---|---|
| `autosave.spec.mjs` | Prose typed and then left behind — the debounce died with the page on reload and on an `<a href>` to an in-app route; a focus refetch's late response re-seated the cache so the next full-record PUT reverted an edit. |
| `synopsis-llm.spec.mjs` | LLM handlers rewrote the whole synopsis row from a copy read before the model call, reverting edits made during it and flattening `@[name](ref)` mentions into dead text. |
| `paste.spec.mjs` | Pasted paragraphs collapsed into one on the next load. Also pins that merely *opening* a scene does not rewrite it. |
| `journal.spec.mjs` | The write journal: before-images recorded, a destroyed paragraph recoverable, credentials redacted, uploads passed through untouched. |
| `print.spec.mjs` | The printed book — completeness, pictures that actually decode, mentions resolved to current names, and real pagination. |

## Notes

- `workers: 1`, no retries. A flaky autosave test is a real autosave bug.
- `harness/seedBook.mjs` builds a campaign rich enough to judge a page layout
  by — long names, act breaks, prose with mentions, and a picture on every
  entity. Thin seed data flatters a layout.
- `harness/instance.mjs` also exposes `startStubLLM` — an OpenAI-compatible stub
  with controllable latency, because the lost-update bugs in the LLM handlers
  only appear when the author keeps typing *during* the call.
- Pure text-format questions belong in `frontend/src/lib/richtext.test.ts`
  (`npm test` in `frontend/`), which runs in milliseconds. Only put things here
  that genuinely need a browser or a server.
