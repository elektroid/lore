import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

/**
 * A throwaway Lore instance: its own binary, its own port, its own database.
 *
 * CLAUDE.md forbids writing to the dev database, and these tests exist
 * precisely to click Save. So every run builds the real production binary
 * (`make build` — frontend embedded, exactly what ships) and points it at a
 * fresh SQLite file under /tmp. Nothing here can reach `backend/lore.db`.
 */

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')

/** Wait for a predicate, polling — no bare sleeps that pass on a fast machine. */
async function until(fn, { timeout = 30_000, every = 200, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    try { if (await fn()) return } catch { /* not ready yet */ }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(r => setTimeout(r, every))
  }
}

/**
 * An OpenAI-compatible stub, so the LLM paths are testable without a key, a
 * bill, or a model's opinion. `latencyMs` is the point of it: the lost-update
 * bugs in these handlers only appear when the author keeps typing *during* the
 * call, which needs a call slow enough to type into.
 */
export function startStubLLM({ port = 8096, latencyMs = 0, reply = {} } = {}) {
  const state = { latencyMs, reply, calls: 0 }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      state.calls++
      setTimeout(() => {
        const payload = { choices: [{ message: { content: JSON.stringify(state.reply) } }] }
        const out = JSON.stringify(payload)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) })
        res.end(out)
      }, state.latencyMs)
    })
  })
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${port}/v1`,
      set: patch => Object.assign(state, patch),
      get calls() { return state.calls },
      stop: () => new Promise(r => server.close(r)),
    }))
  })
}

/** A logged-in API client: carries the cookie jar and the double-submit CSRF header. */
function apiClient(baseURL) {
  let cookie = ''
  let csrf = ''

  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' }
    if (cookie) headers.cookie = cookie
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf

    const res = await fetch(`${baseURL}/api${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    })

    const setCookie = res.headers.getSetCookie?.() ?? []
    if (setCookie.length) {
      const jar = new Map(cookie ? cookie.split('; ').map(c => c.split(/=(.*)/).slice(0, 2)) : [])
      for (const c of setCookie) {
        const [k, v] = c.split(';')[0].split(/=(.*)/)
        jar.set(k, v)
      }
      cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
      csrf = decodeURIComponent(jar.get('lore_csrf') ?? csrf)
    }

    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`)
    return res.status === 204 ? undefined : res.json()
  }

  return {
    get: p => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    del: p => call('DELETE', p),
    get cookieHeader() { return cookie },
  }
}

export const CREDENTIALS = { email: 'e2e@example.test', password: 'e2e-password' }

/**
 * Build, boot, seed. Returns the base URL, an authenticated API client, and the
 * ids of a game / campaign / scenario ready to be edited.
 */
export async function startInstance({ port = 8097, build = true, llmURL = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lore-e2e-'))
  const binary = join(REPO, 'lore-engine')

  if (build) {
    execFileSync('make', ['build'], { cwd: REPO, stdio: 'pipe' })
  }

  writeFileSync(join(dir, 'lore.toml'), `
[server]
host = "127.0.0.1"
port = ${port}

[database]
path = "${join(dir, 'e2e.db')}"

[uploads]
dir = "${join(dir, 'uploads')}"

[external_material]
dir = "${join(dir, 'external-material')}"

[jwt]
secret = "e2e0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab"

[cors]
origins     = ["http://127.0.0.1:${port}"]
credentials = true

[llm]
base_url   = "${llmURL}"
api_key    = "stub"
model      = "stub"
max_tokens = 0

[bootstrap]
user = "${CREDENTIALS.email}:${CREDENTIALS.password}:superuser"

[auth]
registration = "open"
`)

  const proc = spawn(binary, [join(dir, 'lore.toml')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = []
  proc.stdout.on('data', d => log.push(String(d)))
  proc.stderr.on('data', d => log.push(String(d)))

  const baseURL = `http://127.0.0.1:${port}`
  try {
    await until(async () => (await fetch(`${baseURL}/api/version`)).ok, { what: `${baseURL} to come up` })
  } catch (err) {
    proc.kill('SIGKILL')
    throw new Error(`${err.message}\n--- server log ---\n${log.join('')}`)
  }

  const api = apiClient(baseURL)
  await api.post('/auth/login', CREDENTIALS)

  // A campaign's game_id is a real foreign key, and a game needs a slug — both
  // are easy to trip over when seeding by hand (see CLAUDE.md).
  const game = await api.post('/games', { name: 'E2E Game', slug: 'e2e-game', description: '', visual_style: '' })
  const campaign = await api.post('/campaigns', { name: 'E2E Campaign', game_id: game.id, description: '' })
  const scenario = await api.post(`/campaigns/${campaign.id}/scenarios`, { name: 'E2E Scenario', description: '' })

  if (llmURL) {
    await api.put('/settings/llm', { base_url: llmURL, api_key: 'stub', model: 'stub', max_tokens: 0 })
  }

  return {
    baseURL, api, dir,
    ids: { gameId: game.id, campaignId: campaign.id, scenarioId: scenario.id },
    log: () => log.join(''),
    async stop() {
      proc.kill('SIGTERM')
      await new Promise(r => { proc.once('exit', r); setTimeout(r, 3000) })
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export { until }
