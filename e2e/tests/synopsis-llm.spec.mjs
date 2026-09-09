import { expect, test } from '@playwright/test'
import { startInstance, startStubLLM } from '../harness/instance.mjs'

/**
 * An LLM action writes what it generated, and nothing else.
 *
 * These handlers read the synopsis, spend tens of seconds in a model call, then
 * wrote the whole row back — reverting everything the author typed meanwhile.
 * Worse, what they wrote back was the copy prepared for the *prompt*, with the
 * author's `@[name](ref)` mentions already flattened to plain text for the
 * model's benefit. Generating an overview permanently destroyed every mention
 * in the synopsis, whether or not anyone was typing.
 *
 * No browser here: this is entirely about what the server persists.
 */

let app, llm

test.beforeAll(async () => {
  llm = await startStubLLM({ port: 8096, latencyMs: 4000, reply: { overview: 'OVERVIEW DU STUB' } })
  app = await startInstance({ port: 8097, llmURL: llm.url })
})
test.afterAll(async () => { await app?.stop(); await llm?.stop() })

const hookOf = s => {
  const parsed = JSON.parse(s.hook)
  return typeof parsed === 'string' ? JSON.parse(parsed) : parsed
}
const synopsis = () => app.api.get(`/scenarios/${app.ids.scenarioId}/synopsis`)
const setHook = content =>
  app.api.put(`/scenarios/${app.ids.scenarioId}/synopsis`, { hook: { content, status: 'draft' } })

test('generating an overview does not revert an edit made during the call', async () => {
  const npc = await app.api.post(`/campaigns/${app.ids.campaignId}/npcs`, {
    name: 'Rache', role: 'fixeuse', description: '', quote: '', motivation: '',
  })
  await setHook(`Version A — les PJ rencontrent @[Rache](${npc.id}) au Kabuki.`)

  // Start the generation, then save a new hook one second in — which is all an
  // autosave firing mid-call is.
  const generating = app.api.post(`/scenarios/${app.ids.scenarioId}/synopsis/llm/generate-overview`, {})
  await new Promise(r => setTimeout(r, 1000))
  const authored = `Version B — un paragraphe entier ecrit pendant l'appel, avec @[Rache](${npc.id}).`
  await setHook(authored)
  await generating

  const after = await synopsis()
  expect(hookOf(after).content, 'the author wins over a stale pre-call copy').toBe(authored)
  expect(hookOf(after).content, 'mentions must survive as refs, not be flattened').toContain(`@[Rache](${npc.id})`)
  expect(after.overview_cache, 'the overview is what this action is for').toBe('OVERVIEW DU STUB')
})

test('completing the hook replaces the hook and leaves the overview alone', async () => {
  llm.set({ reply: { content: 'UN SYNOPSIS ECRIT PAR LE MODELE' } })
  await setHook('Un depart un peu vague.')
  const before = await synopsis()

  await app.api.post(`/scenarios/${app.ids.scenarioId}/synopsis/llm/complete-hook`, {})

  const after = await synopsis()
  expect(hookOf(after).content).toBe('UN SYNOPSIS ECRIT PAR LE MODELE')
  expect(hookOf(after).status, 'status is the author’s, not the model’s').toBe('draft')
  expect(after.overview_cache, 'completing the hook says nothing about the overview')
    .toBe(before.overview_cache)

  llm.set({ reply: { overview: 'OVERVIEW DU STUB' } })
})

test('saving the hook leaves the overview and the legacy npcs blob alone', async () => {
  // The editor sends only a hook. The route used to default everything absent
  // to empty, so every keystroke-batch blanked two columns it had no opinion on.
  llm.set({ reply: { overview: 'OVERVIEW A PRESERVER' } })
  await app.api.post(`/scenarios/${app.ids.scenarioId}/synopsis/llm/generate-overview`, {})
  const before = await synopsis()
  expect(before.overview_cache).toBe('OVERVIEW A PRESERVER')

  await setHook('Une revision du synopsis.')

  const after = await synopsis()
  expect(after.overview_cache).toBe('OVERVIEW A PRESERVER')
  expect(after.npcs).toBe(before.npcs)

  llm.set({ reply: { overview: 'OVERVIEW DU STUB' } })
})
