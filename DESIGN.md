# Design decisions

## Input debounce — never spam the API from text fields

### The rule

**Text inputs must never trigger a direct API call on every keystroke.**
Every `<input>` or `<textarea>` that auto-saves must go through one of the
three patterns below. The `immediate` save path is reserved for single-action
events (drag-and-drop reorder, status toggle, entity picker selection).

Violating this rule sends one API call per keystroke at ~200 ms intervals,
hammers the backend, and saturates the network tab.

---

### Pattern A — explicit submit button

Use for settings, campaign metadata, entity create/edit forms.

```tsx
const [form, setForm] = useState(initial)
const save = useMutation({ mutationFn: (f) => api.put('/endpoint', f) })

<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
<button onClick={() => save.mutate(form)}>Enregistrer</button>
```

No debounce needed — API is called only on explicit user action.

---

### Pattern B — parent-level debounce via useSynopsis

Use for synopsis fields that propagate through `SynopsisPage.onChange`.
The `useSynopsis.save` function debounces at **1 500 ms**.

```tsx
// In SynopsisPage, the safe path:
function onChange(patch: Partial<SynopsisData>) {
  save({ ...parsed, ...patch })          // debounced — OK for text inputs
}
function onChangeImmediate(patch: Partial<SynopsisData>) {
  save({ ...parsed, ...patch }, true)    // IMMEDIATE — only for structural events
}

// Child widgets must use onChange for text, onChangeImmediate only for:
//   - DnD reorder (arrayMove)
//   - add / remove items
//   - status toggle
//   - entity picker selection
```

If a child widget is wired to `onChangeImmediate`, its text `handle` functions
MUST apply their own internal debounce (Pattern C) before calling `onUpdate`.

---

### Pattern C — internal timer-ref with accumulated draft

Use when a row component owns its own save (NPCRow, SortableStep) or when
it sits behind an `onChangeImmediate` boundary.

```tsx
// Key refs
const localRef  = useRef(initialValues)  // always-current mirror of state
const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
const draftRef  = useRef<Partial<T>>({}) // accumulates patches across fields

function handle(field: keyof T, value: string) {
  localRef.current = { ...localRef.current, [field]: value }
  setLocal({ ...localRef.current })              // update display immediately
  prevRef.current = { ...prevRef.current, [field]: value }

  draftRef.current = { ...draftRef.current, [field]: value }
  if (timerRef.current) clearTimeout(timerRef.current)
  timerRef.current = setTimeout(() => {
    onUpdate(draftRef.current)   // or save.mutate(localRef.current) for full-object saves
    draftRef.current = {}
  }, 800)
}
```

**Why `localRef` instead of closing over `local` state?**
React state updates are asynchronous. If the user types in field A then
field B before a re-render, the closure inside `setTimeout` may read the
old `local` value and drop A's change. `localRef` is a plain object — it
is always synchronously up to date.

**Why `draftRef` for partial-patch APIs?**
`clearTimeout` cancels the previous timer but loses its captured value. Accumulating
patches in `draftRef` across multiple `handle` calls ensures a single fire covers
all fields changed in the burst, regardless of React render timing.

**Immediate actions (status toggle, entity picker) bypass the debounce:**

```tsx
function pickLocation(loc: CampaignLocation) {
  if (timerRef.current) clearTimeout(timerRef.current)
  draftRef.current = {}                          // discard any pending text draft
  localRef.current = { ...localRef.current, location: loc.name }
  setLocal({ ...localRef.current })
  prevRef.current = { ...prevRef.current, location: loc.name }
  onUpdate({ location: loc.name, location_id: loc.id })
}
```

Cancel the pending timer and flush the draft before applying the authoritative
pick — otherwise the debounced text change could overwrite it afterward.

---

---

### The other half of the rule — a debounce must always be flushable

A debounce that is only ever *cancelled* is a data-loss bug waiting for the
user to walk away at the wrong moment. Every timer above must have a `flush()`
that can send the pending draft from outside the timer's own closure, and that
flush must run in all four departure paths:

| Departure | What runs | Covered by |
|---|---|---|
| The edited record changes (next scene, next PNJ) | effect keyed on the id | the call site |
| Client-side navigation (`<Link>`, `navigate()`) | unmount cleanup | `useEffect(() => () => flush(), [flush])` |
| Reload, tab close, `<a href>` to an in-app route | `pagehide` / `visibilitychange` | `registerPendingWrite(flush)` — [`lib/pendingWrites.ts`](frontend/src/lib/pendingWrites.ts) |
| The tab being killed while backgrounded | `visibilitychange` → hidden | same |

The third row is why the registry exists at all: React never sees a real
document navigation, so nothing it can schedule will save for you. Writes
issued during teardown go out with `keepalive` (see `api/client.ts`).

Two rules follow, and both were broken once:

- **Never use a raw `<a href>` for an in-app route.** It is a full page load:
  it kills every pending timer and every in-flight request. Use `<Link to>`.
  Raw anchors are for `/api/…` downloads and external URLs only.
- **Never make the debounce the only copy of the draft.** Keep it in a ref the
  flush can read (`draftRef` / `pending`), not captured inside `setTimeout`.

---

### Server-side writes must be as narrow as the action

A handler writes the columns its action is *about*, and no others. A full-row
`UPDATE` built from a row read at the top of the handler silently reverts
anything that changed in between — and when the handler makes an LLM call, "in
between" is thirty seconds of the author typing.

- `GenerateOverview` writes `overview_cache` only. It used to write the hook
  back too, from a copy read before the model call, which reverted the author's
  paragraph — and wrote it back with `@[name](ref)` mentions already flattened
  to plain text for the prompt, permanently losing the links.
- `PUT /synopsis` writes `hook` only. The client has no business dictating
  `overview_cache` or the legacy `npcs` blob, so it no longer can.

If a prompt needs authored text transformed (mentions resolved, markdown
stripped), transform a copy. What goes to the model must never be what goes
back to the database.

---

### Checklist before adding a new auto-saving input

- [ ] Text `<input>` / `<textarea>` goes through Pattern A, B, or C
- [ ] `onChangeImmediate` / `save(data, true)` is NOT the direct callback for any text field
- [ ] If the component sits behind `onChangeImmediate`, it has its own `timerRef` + `draftRef`
- [ ] Single-action events (click, drop, pick) call `onUpdate` / `mutate` directly — no debounce
- [ ] `localRef` is used instead of `local` state inside `setTimeout` closures
- [ ] The pending draft lives in a ref, and `flush()` can send it
- [ ] `flush()` runs on unmount **and** is passed to `registerPendingWrite`
- [ ] Every in-app link on the page is a `<Link>`, not an `<a href>`
