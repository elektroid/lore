import { expect, test } from '@playwright/test'
import { startInstance } from '../harness/instance.mjs'

/**
 * The write journal — docs/adr/0002-write-journal-for-recovery.md.
 *
 * It exists because when an author lost a synopsis in production, we could not
 * tell which of three candidate bugs had eaten it: the server kept no record of
 * what it had been asked to write, and the author's text existed nowhere but a
 * row something else had already overwritten. Diagnosis took a rebuilt binary,
 * a stub LLM and a scripted browser. Recovery was not possible at all.
 *
 * So the property under test is not "rows get inserted". It is: after a write
 * has destroyed something, can we still get it back?
 */

let app

test.beforeAll(async () => { app = await startInstance({ port: 8097 }) })
test.afterAll(async () => { await app?.stop() })

const journal = q => app.api.get(`/journal?${new URLSearchParams(q)}`)

async function newScene(title) {
  return app.api.post(`/scenarios/${app.ids.scenarioId}/synopsis/scenes`, {
    type: 'scene', sort_order: 0, title,
  })
}
function putScene(id, patch) {
  return app.api.put(`/scenarios/${app.ids.scenarioId}/synopsis/scenes/${id}`, {
    title: 'T', status: 'idea', description: '', outcome: '', notes: '',
    location_id: '', is_start: false, is_end: false, ...patch,
  })
}
const sceneNow = async id =>
  (await app.api.get(`/scenarios/${app.ids.scenarioId}/synopsis/scenes`)).find(s => s.id === id)

test('records every write with the record as it stood before it', async () => {
  const scene = await newScene('Journalled Scene')
  await putScene(scene.id, { title: 'Journalled Scene', description: 'PREMIERE VERSION' })
  await putScene(scene.id, { title: 'Journalled Scene', description: 'DEUXIEME VERSION' })

  await expect.poll(async () => (await journal({ entity: 'scene', entity_id: scene.id })).total,
    { timeout: 10_000 }).toBeGreaterThanOrEqual(2)

  const { entries } = await journal({ entity: 'scene', entity_id: scene.id })
  const latest = entries[0]

  expect(latest.method).toBe('PUT')
  expect(latest.status).toBe(200)
  expect(latest.user_email, 'the author is on the row, not just their id')
    .toBe('e2e@example.test')
  expect(JSON.parse(latest.payload).description,
    'the newest row must be the newest write — two writes in the same second still order correctly')
    .toBe('DEUXIEME VERSION')
  expect(JSON.parse(latest.before).description, 'the before-image is the point of the whole table')
    .toBe('PREMIERE VERSION')
})

test('a paragraph destroyed by a later write can be recovered', async () => {
  const scene = await newScene('Recoverable Scene')
  const paragraph = 'Un paragraphe entier que personne ne veut perdre.\n\nAvec un second paragraphe.'
  await putScene(scene.id, { title: 'Recoverable Scene', description: paragraph })

  // The disaster: a full-record PUT built from a stale copy wipes it.
  await putScene(scene.id, { title: 'Recoverable Scene', description: '' })
  expect((await sceneNow(scene.id)).description, 'gone, as it was in production').toBe('')

  await expect.poll(async () => (await journal({ entity: 'scene', entity_id: scene.id })).total,
    { timeout: 10_000 }).toBeGreaterThanOrEqual(2)

  // Find the entry whose before-image still holds the paragraph, and put it back.
  const { entries } = await journal({ entity: 'scene', entity_id: scene.id })
  const rescue = entries.find(e => e.before && JSON.parse(e.before).description === paragraph)
  expect(rescue, 'the journal must still hold the lost text').toBeTruthy()

  await app.api.post(`/journal/${rescue.id}/restore`, {})
  expect((await sceneNow(scene.id)).description).toBe(paragraph)
})

test('redacts credential-shaped fields', async () => {
  // The journal keeps the full text of everything anyone writes, for weeks. A
  // credential that lands in it outlives every rotation.
  await app.api.post('/users', {
    email: `redaction-${Date.now()}@example.test`,
    password: 'sup3r-s3cret-value', name: 'Redaction', role: 'player',
  })

  await expect.poll(async () => (await journal({ limit: 50 })).entries.some(e => e.path === '/api/users'),
    { timeout: 10_000 }).toBe(true)

  const { entries } = await journal({ limit: 50 })
  const created = entries.find(e => e.path === '/api/users')
  expect(created.payload).not.toContain('sup3r-s3cret-value')
  expect(JSON.parse(created.payload).password).toBe('•redacted•')
  expect(JSON.parse(created.payload).email, 'non-secret fields stay readable')
    .toContain('redaction-')
})

test('does not journal the auth endpoints at all', async () => {
  const { entries } = await journal({ limit: 200 })
  expect(entries.some(e => e.path.startsWith('/api/auth/'))).toBe(false)
})

test('reports what it is costing', async () => {
  const { stats } = await journal({ limit: 1 })
  expect(stats.entries).toBeGreaterThan(0)
  expect(stats.bytes).toBeGreaterThan(0)
  expect(stats.oldest).toBeTruthy()
})

test('the admin screen shows the journal and can restore from it', async ({ page }) => {
  const { login } = await import('../harness/editor.mjs')

  const scene = await newScene('Admin Restore Scene')
  await putScene(scene.id, { title: 'Admin Restore Scene', description: 'TEXTE A RETROUVER' })
  await putScene(scene.id, { title: 'Admin Restore Scene', description: 'ECRASE' })
  await expect.poll(async () => (await journal({ entity: 'scene', entity_id: scene.id })).total,
    { timeout: 10_000 }).toBeGreaterThanOrEqual(2)

  await login(page, app.baseURL)
  await page.goto(`${app.baseURL}/admin`)
  await page.getByRole('tab', { name: 'Écritures' }).click()

  // The row whose diff holds the lost text.
  await page.getByRole('button', { name: /Scène/ }).first().waitFor({ timeout: 10_000 })
  const rows = page.getByRole('button', { name: /Scène/ })
  const count = await rows.count()
  let opened = false
  for (let i = 0; i < count; i++) {
    await rows.nth(i).click()
    if (await page.getByText('TEXTE A RETROUVER').count() > 0) { opened = true; break }
    await page.keyboard.press('Escape')
  }
  expect(opened, 'the diff must show the text that was overwritten').toBe(true)

  await page.getByRole('button', { name: /Restaurer cette version/ }).click()
  await expect.poll(async () => (await sceneNow(scene.id)).description, { timeout: 15_000 })
    .toBe('TEXTE A RETROUVER')
})

test('an image upload passes through the journal untouched', async () => {
  // The journal reads request bodies. A multipart upload is a file whose bytes
  // mean nothing in a diff, so it is skipped — a journal that corrupted an
  // upload on its way to the handler would be far worse than no journal.
  const npc = await app.api.post(`/campaigns/${app.ids.campaignId}/npcs`, {
    name: 'Upload NPC', role: '', description: '', quote: '', motivation: '',
  })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64')

  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), 'dot.png')
  await app.api.upload(`/campaigns/${app.ids.campaignId}/npcs/${npc.id}/images`, form)

  const after = await app.api.get(`/campaigns/${app.ids.campaignId}/npcs/${npc.id}`)
  expect(JSON.parse(after.images)).toHaveLength(1)

  // Journalled as an event, with no payload kept.
  await expect.poll(async () => (await journal({ limit: 100 })).entries
    .some(e => e.path.endsWith(`/npcs/${npc.id}/images`)), { timeout: 10_000 }).toBe(true)
  const entry = (await journal({ limit: 100 })).entries.find(e => e.path.endsWith(`/npcs/${npc.id}/images`))
  expect(entry.payload, 'binary has no place in a diff').toBe('')
})
