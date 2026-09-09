import { expect, test } from '@playwright/test'
import { startInstance } from '../harness/instance.mjs'
import { seedBook } from '../harness/seedBook.mjs'
import { login } from '../harness/editor.mjs'

/**
 * The printed book — docs/print.md.
 *
 * What is worth testing about a document is not its wording but its
 * completeness and its pagination: that every scenario is in it, that the
 * pictures actually made it onto the page, that a chapter starts on a fresh
 * sheet, and that the print dialog is not opened over a half-loaded document.
 * Those are the things that quietly stop being true.
 */

let app, seeded

test.beforeAll(async () => {
  app = await startInstance({ port: 8097 })
  seeded = await seedBook(app)
})
test.afterAll(async () => { await app?.stop() })

const campaignURL = () => `${app.baseURL}/campaigns/${app.ids.campaignId}/print?auto=0`

/** Count pages in a PDF Chrome just produced. */
function pdfPages(buffer) {
  const text = buffer.toString('latin1')
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

test.beforeEach(async ({ page }) => { await login(page, app.baseURL) })

test('the campaign document contains every scenario and every appendix', async ({ page }) => {
  await page.goto(campaignURL())
  await page.locator('.doc-cover__title').waitFor()

  await expect(page.locator('.doc-cover__title')).toHaveText('Les Cendres de Nyx-9')

  // A chapter opener per scenario, plus the contents page and four appendices.
  for (const title of ['Le contrat', 'Six jours']) {
    await expect(page.locator('.doc-h1', { hasText: title })).toBeVisible()
  }
  for (const appendix of ['Sommaire', 'Distribution', 'Lieux', 'Factions', 'Artefacts']) {
    await expect(page.locator('.doc-h1', { hasText: appendix })).toBeVisible()
  }

  // Every entity gets an entry, not just the ones a scene happens to reference.
  const entries = await page.locator('.doc-entry__name').allInnerTexts()
  for (const e of [...seeded.npcs, ...seeded.locations, ...seeded.factions, ...seeded.artefacts]) {
    expect(entries, `${e.name} must be in the book`).toContain(e.name)
  }
})

test('the print payload carries nothing the document does not print', async () => {
  // It would be easy to hand the book the whole campaign row. That row carries
  // `llm_config`, which can hold an encrypted API key — and a payload that
  // ships what it does not need is a payload waiting to be pasted somewhere.
  const doc = await app.api.get(`/campaigns/${app.ids.campaignId}/print`)
  expect(Object.keys(doc.campaign).sort())
    .toEqual(['game_name', 'genre', 'id', 'name', 'pitch'])
  expect(JSON.stringify(doc)).not.toContain('llm_config')
})

test('the pictures are on the page', async ({ page }) => {
  // The complaint that started this: "the print does not include entities and
  // their pictures". An <img> in the DOM is not enough — a portrait that 404s
  // still has a tag, and prints as a hole.
  await page.goto(campaignURL())
  await page.locator('.doc-cover__title').waitFor()
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.lore-doc img')).every(i => i.complete), null, { timeout: 20_000 })

  const broken = await page.$$eval('.lore-doc img', imgs =>
    imgs.filter(i => i.naturalWidth === 0).map(i => i.src))
  expect(broken, 'every picture must actually decode').toEqual([])

  const count = await page.locator('.lore-doc img').count()
  // 12 entities with a picture, plus the cast strip on the cover.
  expect(count).toBeGreaterThanOrEqual(12)
})

test('mentions print as the entity’s current name, not the name typed', async ({ page }) => {
  // A mention stores the name it was typed with. Renaming the PNJ must update
  // every sentence that mentions it — on paper as well as on screen.
  const rache = seeded.npcs[0]
  await app.api.put(`/campaigns/${app.ids.campaignId}/npcs/${rache.id}`, {
    name: 'Rache Oyelaran-Devereux', role: rache.role, description: rache.description,
    quote: rache.quote, motivation: rache.motivation, sheet: rache.sheet ?? '{}',
  })

  await page.goto(campaignURL())
  await page.locator('.doc-cover__title').waitFor()

  const mentions = await page.locator('.doc-mention').allInnerTexts()
  expect(mentions).toContain('Rache Oyelaran-Devereux')
  expect(mentions, 'the stale name must be gone').not.toContain('Rache Velasquez-Oyelaran')
  // And no raw token or stray @ leaked into the prose — including the contents
  // page, whose one-line blurbs are flattened by a different code path and
  // shipped the `@Name` form once.
  const body = await page.locator('.lore-doc').innerText()
  expect(body).not.toContain('@[')
  expect(body, 'a mention is a name in a book, not a handle').not.toMatch(/@[A-ZÉÈÀ]/)

  const blurbs = (await page.locator('.doc-toc__blurb').allInnerTexts()).join(' ')
  expect(blurbs).toContain('Rache Oyelaran-Devereux')
})

test('an appendix entry says which scenes the entity is in', async ({ page }) => {
  // Chrome cannot resolve page numbers at print time, so the book addresses
  // itself by chapter.scene instead — which survives re-pagination on a
  // different paper size anyway.
  await page.goto(campaignURL())
  await page.locator('.doc-cover__title').waitFor()

  const osei = page.locator('.doc-entry', { hasText: 'Enfant de la coque' }).first()
  await expect(osei.locator('.doc-entry__refs')).toHaveText(/Apparaît en 1\.\d\d/)

  // The cargo is used in the second chapter.
  const cargo = page.locator('.doc-entry', { hasText: 'échantillons horticoles' }).first()
  await expect(cargo.locator('.doc-entry__refs')).toHaveText(/Apparaît en 2\.\d\d/)

  // Brandt is in the second scenario's cast without being pinned to a scene.
  // A reference to the chapter beats no address at all.
  const brandt = page.locator('.doc-entry', { hasText: 'Médecin de bord' }).first()
  await expect(brandt.locator('.doc-entry__refs')).toHaveText('Apparaît en 2')
})

test('an archived scenario is not in the book', async ({ page }) => {
  const extra = await app.api.post(`/campaigns/${app.ids.campaignId}/scenarios`, {
    name: 'Piste abandonnée', description: '',
  })
  await app.api.put(`/scenarios/${extra.id}`, { name: 'Piste abandonnée', status: 'archived' })

  await page.goto(campaignURL())
  await page.locator('.doc-cover__title').waitFor()
  await expect(page.locator('.doc-h1', { hasText: 'Piste abandonnée' })).toHaveCount(0)

  await app.api.del(`/scenarios/${extra.id}`)
})

test('each chapter starts on a fresh page', async ({ page }) => {
  await page.goto(campaignURL())
  await page.locator('.doc-cover__title').waitFor()
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.lore-doc img')).every(i => i.complete), null, { timeout: 20_000 })

  const pdf = await page.pdf({ format: 'A4', printBackground: true })
  const pages = pdfPages(pdf)
  // Cover, contents, two chapters, four appendices — at minimum.
  expect(pages, 'the document must paginate, not run as one slab').toBeGreaterThanOrEqual(8)
})

test('the scenario sheet carries only the entities that scenario uses', async ({ page }) => {
  // A one-evening sheet with the whole campaign's gazetteer stapled to it is a
  // worse document, not a fuller one.
  await page.goto(`${app.baseURL}/scenarios/${seeded.scenarioIds[0]}/print?auto=0`)
  await page.locator('.doc-h1').first().waitFor()

  const entries = await page.locator('.doc-entry__name').allInnerTexts()
  expect(entries).toContain('Osei')
  expect(entries, 'a PNJ from the other scenario has no business here')
    .not.toContain('Docteur Ilse Brandt')
  expect(entries).toContain('Le Marché de Quai')
})

test('the print dialog is not opened before the pictures have loaded', async ({ page }) => {
  // The old sheet called window.print() on a 400 ms timer, which is a guess: a
  // campaign book pulls dozens of portraits, and a dialog that opens before
  // they decode produces a PDF with holes in it.
  await page.addInitScript(() => {
    window.__printedAt = null
    window.print = () => {
      window.__printedAt = Array.from(document.querySelectorAll('.lore-doc img'))
        .filter(i => !i.complete).length
    }
  })
  await page.goto(`${app.baseURL}/campaigns/${app.ids.campaignId}/print`)
  await page.waitForFunction(() => window.__printedAt !== null, null, { timeout: 20_000 })
  expect(await page.evaluate(() => window.__printedAt),
    'no image may still be loading when the dialog opens').toBe(0)
})
