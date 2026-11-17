import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { createGuard } from '../deploy/guard.mjs'

test('Caddy routes only the public AIRI surface and session-protected inference', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'airi-gateway-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  await mkdir(join(base, 'ui'))
  await writeFile(join(base, 'index.html'), 'AIRI Stage')
  await writeFile(join(base, 'selfhost.js'), 'runtime defaults')
  await writeFile(join(base, 'ui/index.html'), 'AIRI Accounts')

  const start = async (server) => {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => server.close())
    return '127.0.0.1:' + server.address().port
  }
  const auth = await start(createServer((req, res) => {
    if (req.url === '/api/auth/get-session') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(req.headers.cookie === 'session=owner'
        ? { user: { email: 'owner@example.net' } }
        : null))
    }
    else res.end('auth:' + req.url)
  }))
  const upstream = await start(createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ url: req.url, host: req.headers.host, authorization: req.headers.authorization, cookie: req.headers.cookie }))
  }))
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const origin = 'http://127.0.0.1:' + port
  const guard = await start(createGuard({ origin, owner: 'owner@example.net', authUrl: 'http://' + auth + '/api/auth/get-session' }))

  const child = spawn(process.env.CADDY || 'caddy', [
    'run', '--config', fileURLToPath(new URL('../deploy/Caddyfile', import.meta.url)), '--adapter', 'caddyfile',
  ], {
    env: { ...process.env, PORT: String(port), STAGE_ROOT: base, ACCOUNTS_ROOT: base,
      PUBLIC_SCHEME: 'http', AUTH_UPSTREAM: auth, API_UPSTREAM: upstream, GUARD_UPSTREAM: guard,
      S3_UPSTREAM: upstream, OLLAMA_UPSTREAM: upstream, VOICE_UPSTREAM: upstream },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let logs = ''
  child.on('error', error => { logs += error.message })
  child.stderr.on('data', chunk => { logs += chunk })
  t.after(() => { if (child.exitCode === null) child.kill() })
  const request = (path, options) => fetch(origin + path, options)
  let healthy
  for (let n = 0; n < 50; ++n) {
    healthy = await request('/healthz').then(res => res.status).catch(() => 0)
    if (healthy === 200) break
    await delay(50)
  }
  assert.equal(healthy, 200, logs)

  assert.equal(await (await request('/auth/callback?code=test')).text(), 'AIRI Stage')
  assert.equal(await (await request('/auth/sign-in')).text(), 'auth:/auth/sign-in')
  assert.equal(await (await request('/ui/sign-in')).text(), 'AIRI Accounts')
  assert.equal((await request('/api/auth/sign-up/email', { method: 'POST' })).status, 404)
  assert.equal((await request('/internal/non-public')).status, 404)
  assert.equal((await request('/local/chat/v1/models')).status, 401)
  assert.equal((await request('/local/chat/v1/models', { headers: { cookie: 'session=wrong' } })).status, 401)
  assert.equal((await request('/local/chat/v1/models', { headers: { cookie: 'session=owner', origin: 'https://outside.invalid' } })).status, 403)
  const headers = { cookie: 'session=owner', authorization: 'Bearer local-session' }
  const chat = await request('/local/chat/v1/chat/completions', { method: 'POST', headers })
  assert.equal(chat.status, 200)
  assert.deepEqual(await chat.json(), { url: '/v1/chat/completions', host: '127.0.0.1:' + port })
  const speech = await request('/local/voice/v1/audio/speech', { method: 'POST', headers })
  assert.equal((await speech.json()).url, '/v1/audio/speech')
  assert.equal((await request('/local/chat/api/pull', { method: 'POST', headers })).status, 404)
  const object = await request('/airi-private/file.png?X-Amz-Expires=123', { headers })
  assert.deepEqual(await object.json(), { url: '/airi-private/file.png?X-Amz-Expires=123', host: '127.0.0.1:' + port, authorization: 'Bearer local-session' })
  assert.equal((await request('/selfhost.js')).headers.get('Cache-Control'), 'no-store')
})
