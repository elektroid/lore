import { expect, test } from '@playwright/test'
import { startInstance } from '../harness/instance.mjs'
import { login, openScene, pasteInto, proseField } from '../harness/editor.mjs'

/**
 * Pasting is how prose actually arrives in this app — authors write elsewhere
 * and paste in. The unit tests in frontend/src/lib/richtext.test.ts pin the
 * text format's round trip; this pins the whole path, from a real `paste`
 * event through TipTap's HTML parsing to what the server ends up storing.
 */

let app

test.beforeAll(async () => { app = await startInstance({ port: 8097 }) })
test.afterAll(async () => { await app?.stop() })

async function sceneWith(title) {
  return app.api.post(`/scenarios/${app.ids.scenarioId}/synopsis/scenes`, {
    type: 'scene', sort_order: 0, title,
  })
}
async function storedDescription(id) {
  const scenes = await app.api.get(`/scenarios/${app.ids.scenarioId}/synopsis/scenes`)
  return scenes.find(s => s.id === id).description
}

test.beforeEach(async ({ page }) => { await login(page, app.baseURL) })

test('pasted paragraphs stay separate paragraphs', async ({ page }) => {
  const scene = await sceneWith('Paste Paragraphs')
  await page.goto(`${app.baseURL}/scenarios/${app.ids.scenarioId}/synopsis`)
  await openScene(page, 'Paste Paragraphs')

  await pasteInto(proseField(page, 'Ce qui se passe'), {
    text: 'Premier paragraphe colle.\n\nDeuxieme paragraphe colle.\n\nTroisieme.',
  })

  await expect.poll(() => storedDescription(scene.id), { timeout: 15_000 })
    .toBe('Premier paragraphe colle.\n\nDeuxieme paragraphe colle.\n\nTroisieme.')

  // And they must still be three paragraphs after a reload — the failure was a
  // silent collapse into one paragraph with line breaks, on the *next* load.
  await page.reload()
  await openScene(page, 'Paste Paragraphs')
  expect(await storedDescription(scene.id))
    .toBe('Premier paragraphe colle.\n\nDeuxieme paragraphe colle.\n\nTroisieme.')
})

test('pasted HTML keeps its list attached to its intro line', async ({ page }) => {
  const scene = await sceneWith('Paste HTML')
  await page.goto(`${app.baseURL}/scenarios/${app.ids.scenarioId}/synopsis`)
  await openScene(page, 'Paste HTML')

  await pasteInto(proseField(page, 'Ce qui se passe'), {
    html: '<p>Les joueurs doivent monter un plan.</p><ul><li>Reperage</li><li>Entree</li></ul>',
    text: 'Les joueurs doivent monter un plan.\nReperage\nEntree',
  })

  await expect.poll(() => storedDescription(scene.id), { timeout: 15_000 })
    .toBe('Les joueurs doivent monter un plan.\n- Reperage\n- Entree')
})

test('opening a scene does not rewrite what is already stored', async ({ page }) => {
  // MentionEditor fires onUpdate for its initial content too, so merely opening
  // a scene runs the whole text through parse-and-serialize and saves the
  // result. That is only safe while the round trip is exact — which is the
  // point of this test.
  const scene = await sceneWith('Untouched Scene')
  const original = [
    'Les joueurs doivent monter un plan:',
    '- Quand est ce que la cargaison est accessible ?',
    '- Quelle securite est en place ?',
    '',
    '',
    '',
    'La caisse est hermetique, **grise**, et pese *45 kg*.',
  ].join('\n')
  await app.api.put(`/scenarios/${app.ids.scenarioId}/synopsis/scenes/${scene.id}`, {
    title: 'Untouched Scene', status: 'idea', description: original,
    outcome: '', notes: '', location_id: '', is_start: false, is_end: false,
  })

  await page.goto(`${app.baseURL}/scenarios/${app.ids.scenarioId}/synopsis`)
  await openScene(page, 'Untouched Scene')
  await page.waitForTimeout(3000)

  expect(await storedDescription(scene.id), 'opening a scene must be a read').toBe(original)
})
