# User profiles — what the app is for, per person in the room

Three documents, one per class of person the app serves:

- [docs/users-authors.md](users-authors.md) — the **Auteur**, who writes and runs a campaign
- [docs/users-players.md](users-players.md) — the **Joueur**, who plays in one
- [docs/users-admin.md](users-admin.md) — the **Administrateur**, who runs the instance

Each is written as a mission statement, a rough end-to-end workflow, and a set
of user stories in the style of [docs/play-table.md](play-table.md) §2 —
concrete enough to point at a screen, honest about what is missing. They exist
to keep three questions answerable while building a feature:

1. **Whose job does this serve?** A button that helps the author but confuses
   the player at the table is a design bug, not a missing tooltip.
2. **What does this profile already have, and where does it stop?** "Out of
   scope" sections are load-bearing — see [docs/runs.md](runs.md) for what
   happens when that line gets crossed by accident.
3. **What's missing?** Each doc ends with a gap list — read against the
   current code, not aspirational. When a gap gets closed, move it into the
   workflow section instead of leaving a stale TODO.

## Why three documents and not one

The temptation is a single "personas" doc. It was rejected: the author and the
player almost never look at the same screen (`docs/play-table.md` §1 — the
console, the table, and the seat are three different surfaces with three
different auth models), and conflating their requirements produces a doc where
half of every section is a caveat about the other profile. One document per
class of user, cross-linked, is worth the extra file.

## Reading order for an agent about to touch UI

If the task names a page, start with the doc whose workflow section mentions
it, not the one whose title sounds closest — `RunPlayerPage.tsx` belongs to
the player doc even though it renders inside a route the author also reaches
(`/campaigns/:id/runs`, as the delegated Meneur — see
[users-authors.md](users-authors.md) §4).
