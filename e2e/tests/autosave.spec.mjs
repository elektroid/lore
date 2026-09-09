import { expect, test } from '@playwright/test'
import { startInstance } from '../harness/instance.mjs'
import { altTabAway, login, openScene, proseField, typeInto } from '../harness/editor.mjs'

/**
 * Autosave must survive the author leaving.
 *
 * Every one of these reproduces a real production data loss: an author wrote a
 * synopsis, moved inside the app, came back, and most of it was gone. The
 * writes were never failing — 49 PUTs, every one a 200. They were being
 * skipped, or undone.
 */

let app

test.beforeAll(async () => { app = await startInstance({ port: 8097 }) })
test.afterAll(async () => { await app?.stop() })

const synopsisURL = () => `${app.baseURL}/scenarios/${app.ids.scenarioId}/synopsis`

async function storedHook() {
  const s = await app.api.get(`/scenarios/${app.ids.scenarioId}/synopsis`)
  const parsed = JSON.parse(s.hook)
  return (typeof parsed === 'string' ? JSON.parse(parsed) : parsed).content ?? ''
}

async function storedScene(id) {
  const scenes = await app.api.get(`/scenarios/${app.ids.scenarioId}/synopsis/scenes`)
  return scenes.find(s => s.id === id)
}

async function freshScene(title) {
  return app.api.post(`/scenarios/${app.ids.scenarioId}/synopsis/scenes`, {
    type: 'scene', sort_order: 0, title,
  })
}

test.describe('the synopsis hook', () => {
  test.beforeEach(async ({ page }) => {
    await app.api.put(`/scenarios/${app.ids.scenarioId}/synopsis`, { hook: { content: '', status: 'draft' } })
    await login(page, app.baseURL)
  })

  test('survives a reload straight after typing', async ({ page }) => {
    // The debounce is 1 500 ms and a reload tears the page down long before
    // that. Nothing React can schedule runs; the flush has to come from
    // `pagehide` (lib/pendingWrites.ts) with a keepalive request.
    await page.goto(synopsisURL())
    await proseField(page, 'Synopsis').waitFor()
    await typeInto(proseField(page, 'Synopsis'), page, 'UN PARAGRAPHE ECRIT PUIS RECHARGE')

    await page.reload()
    await expect.poll(storedHook, { timeout: 15_000 }).toBe('UN PARAGRAPHE ECRIT PUIS RECHARGE')
  })

  test('survives client-side navigation straight after typing', async ({ page }) => {
    await page.goto(synopsisURL())
    await proseField(page, 'Synopsis').waitFor()
    await typeInto(proseField(page, 'Synopsis'), page, 'ECRIT PUIS NAVIGATION INTERNE')

    await page.getByRole('link', { name: 'Entités' }).click()
    await expect.poll(storedHook, { timeout: 15_000 }).toBe('ECRIT PUIS NAVIGATION INTERNE')
  })

  test('the Entités button is a client-side link, not a page load', async ({ page }) => {
    // A raw <a href> to an in-app route is a full document navigation: it kills
    // the pending timer *and* any request already in flight. This one shipped
    // as an <a href> and reliably ate whatever had just been typed next to it.
    await page.goto(synopsisURL())
    const link = page.getByRole('link', { name: 'Entités' })
    await link.waitFor()

    // A marker on `window` is the only reliable tell: history events fire for
    // client-side navigation too, but only a real document load wipes this.
    await page.evaluate(() => { window.__sameDocument = true })
    await link.click()
    await page.waitForURL(/\/entities$/)
    expect(await page.evaluate(() => window.__sameDocument === true),
      'clicking Entités must not reload the document').toBe(true)
  })
})

test.describe('a scene description', () => {
  test.beforeEach(async ({ page }) => { await login(page, app.baseURL) })

  test('survives a reload straight after typing', async ({ page }) => {
    const scene = await freshScene('Reload Scene')
    await page.goto(synopsisURL())
    await openScene(page, 'Reload Scene')
    await typeInto(proseField(page, 'Ce qui se passe'), page, 'CE QUI SE PASSE, PUIS RECHARGE')

    await page.reload()
    await expect.poll(async () => (await storedScene(scene.id)).description, { timeout: 15_000 })
      .toBe('CE QUI SE PASSE, PUIS RECHARGE')
  })

  test('is not reverted by leaving the window and coming back', async ({ page }) => {
    // The production failure, exactly: alt-tab out to copy some text, alt-tab
    // back (which fired a focus refetch), edit, then touch any *other* field.
    // The refetch's late response re-seated the cache with pre-edit data, and
    // the next full-record PUT wrote that stale copy back — silently, while the
    // editor on screen still showed the new text.
    const scene = await freshScene('Alt Tab Scene')
    await app.api.put(`/scenarios/${app.ids.scenarioId}/synopsis/scenes/${scene.id}`, {
      title: 'Alt Tab Scene', status: 'idea', description: 'TEXTE ORIGINE',
      outcome: '', notes: '', location_id: '', is_start: false, is_end: false,
    })

    await page.goto(synopsisURL())
    await openScene(page, 'Alt Tab Scene')

    // The query has to be stale for a focus refetch to be possible at all
    // (staleTime is 30 s), which is why this one waits in real time.
    await page.waitForTimeout(32_000)
    await altTabAway(page)

    await typeInto(proseField(page, 'Ce qui se passe'), page, 'TEXTE ECRIT APRES AVOIR CHANGE DE FENETRE')
    await expect.poll(async () => (await storedScene(scene.id)).description, { timeout: 15_000 })
      .toBe('TEXTE ECRIT APRES AVOIR CHANGE DE FENETRE')

    // Now the move that used to destroy it: edit a different field.
    await page.locator('input').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' X', { delay: 40 })

    await expect.poll(async () => (await storedScene(scene.id)).title, { timeout: 15_000 })
      .toBe('Alt Tab Scene X')
    expect((await storedScene(scene.id)).description,
      'editing the title must not revert the description')
      .toBe('TEXTE ECRIT APRES AVOIR CHANGE DE FENETRE')
  })
})
