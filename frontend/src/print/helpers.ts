import { parseRichText } from '@/lib/richtext'
import type { MentionKind } from '@/lib/mentions'

/**
 * The non-component half of the print module: everything the document needs
 * that is not itself a piece of the document. Kept out of blocks.tsx and
 * PrintProse.tsx so those files export components only — which is what React
 * Fast Refresh needs to do its job.
 */

/** First image URL out of an entity's `images` JSON column, if any. */
export function firstImage(imagesJson: string | undefined): string | null {
  try {
    const arr: { url?: string }[] = JSON.parse(imagesJson || '[]')
    return arr.find(i => i.url)?.url ?? null
  } catch { return null }
}

/**
 * A lookup from a mention's stored ref to the entity's *current* name.
 *
 * The screen resolves mentions live against the campaign's entities. The print
 * used to have no entity list to hand, so it flattened `@[Rache](uuid)` to the
 * name captured when it was typed and left the `@` in — which reads like a
 * social handle in the middle of a printed paragraph, and goes stale the moment
 * anyone renames the PNJ.
 *
 * The campaign document loads every entity anyway, so it can do better.
 */
export type MentionNames = Map<string, string>

export function buildMentionNames(entities: {
  npcs?: { id: string; name: string }[]
  locations?: { id: string; name: string }[]
  factions?: { id: string; name: string }[]
  artefacts?: { id: string; name: string }[]
}): MentionNames {
  const m = new Map<string, string>()
  // Kept in step with PREFIXES in lib/mentions.ts — PNJ refs carry no prefix.
  for (const n of entities.npcs ?? []) m.set(n.id, n.name)
  for (const l of entities.locations ?? []) m.set(`location:${l.id}`, l.name)
  for (const f of entities.factions ?? []) m.set(`faction:${f.id}`, f.name)
  for (const a of entities.artefacts ?? []) m.set(`artefact:${a.id}`, a.name)
  return m
}

export function mentionRefOf(kind: MentionKind, id: string): string {
  const prefix: Record<MentionKind, string> = {
    npc: '', location: 'location:', faction: 'faction:', artefact: 'artefact:',
  }
  return (prefix[kind] ?? '') + id
}

/**
 * Waits for the document to be genuinely ready, then resolves.
 *
 * The old sheet called `window.print()` on a 400 ms timer, which is a guess: a
 * campaign book pulls dozens of portraits, and a print dialog that opens before
 * they decode produces a PDF with holes in it. This waits for the real signals
 * and keeps the timeout only as a cap, so a single broken image URL cannot hang
 * the whole document.
 */
export async function waitForPaint(root: HTMLElement, capMs = 8000): Promise<void> {
  const deadline = new Promise<void>(r => setTimeout(r, capMs))
  const ready = (async () => {
    const images = Array.from(root.querySelectorAll('img'))
    await Promise.all([
      document.fonts?.ready,
      ...images.map(img => img.complete
        ? Promise.resolve()
        : new Promise<void>(r => {
          img.addEventListener('load', () => r(), { once: true })
          img.addEventListener('error', () => r(), { once: true })
        })),
    ])
    // One more frame, so the last layout pass has landed before the dialog
    // freezes the page.
    await new Promise<void>(r => requestAnimationFrame(() => r()))
  })()
  await Promise.race([ready, deadline])
}

/**
 * Authored prose as one line of plain text, for a contents entry or a caption.
 *
 * Not `toPlainText`: that renders a mention as `@Name` using the name captured
 * when it was typed — a stray social handle in the middle of a book, and stale
 * the moment anyone renames the entity. Here a mention is simply its current
 * name, because a summary line has no room to mark a cross-reference anyway.
 */
export function flattenProse(text: string, names?: MentionNames): string {
  return parseRichText(text)
    .map(block => {
      const runs = block.type === 'list' ? block.items : block.lines
      return runs
        .map(line => line
          .map(run => run.type === 'mention'
            ? (names?.get(mentionRefOf(run.kind, run.id)) ?? run.storedName)
            : run.text)
          .join(''))
        .join(' ')
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Where each entity appears, as chapter.scene references like "1.02".
 *
 * The appendices list who and what is in the campaign; this is what tells the
 * reader where to go and look. It is the closest a browser-printed book can get
 * to an index, because Chrome cannot resolve page numbers at print time — but
 * a scene reference is arguably the better address anyway: it survives the
 * document being re-paginated on a different paper size.
 */
export type Appearances = Map<string, string[]>

export function buildAppearances(scenarios: {
  scenes: { type: string; npcs?: { id: string }[]; artefacts?: { id: string }[]; location_id?: string }[]
  synopsis_npcs?: { id: string }[]
  synopsis_factions?: { id: string }[]
}[]): Appearances {
  const map: Appearances = new Map()
  const add = (id: string | undefined, ref: string) => {
    if (!id) return
    const list = map.get(id) ?? []
    if (!list.includes(ref)) list.push(ref)
    map.set(id, list)
  }

  scenarios.forEach((chapter, ci) => {
    let n = 0
    for (const scene of chapter.scenes) {
      if (scene.type !== 'scene') continue
      n++
      const ref = `${ci + 1}.${String(n).padStart(2, '0')}`
      for (const npc of scene.npcs ?? []) add(npc.id, ref)
      for (const art of scene.artefacts ?? []) add(art.id, ref)
      add(scene.location_id, ref)
    }
    // A faction, and a PNJ listed in the scenario's cast without being pinned
    // to a scene, are attached to the chapter rather than to a scene — so they
    // are referenced by chapter alone rather than left with no address at all.
    for (const f of chapter.synopsis_factions ?? []) add(f.id, `${ci + 1}`)
    for (const n of chapter.synopsis_npcs ?? []) {
      if (!(map.get(n.id) ?? []).some(r => r.startsWith(`${ci + 1}.`))) add(n.id, `${ci + 1}`)
    }
  })
  return map
}
