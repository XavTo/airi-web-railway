import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createGuard } from './guard.mjs'

const base = { ...process.env }
const children = new Set()
let stopping = false
let guard

async function stop(code) {
  if (stopping)
    return
  stopping = true
  guard?.close()
  const ended = [...children].map(child => {
    const exited = once(child, 'exit').catch(() => {})
    child.kill('SIGTERM')
    return exited
  })
  await Promise.race([Promise.all(ended), delay(5000)])
  for (const child of children)
    child.kill('SIGKILL')
  process.exit(code)
}

process.once('SIGINT', () => void stop(130))
process.once('SIGTERM', () => void stop(0))

function required(key, min = 1) {
  const value = base[key] || ''
  if (value.length < min)
    throw new Error(`Variable manquante ou trop courte : ${key}`)
  return value
}

function run(name, args, env, opts = {}) {
  const child = spawn(args[0], args.slice(1), { env, cwd: opts.cwd ?? '/app', stdio: 'inherit' })
  children.add(child)
  child.once('close', (code) => {
    children.delete(child)
    if (!opts.oneShot && !stopping) {
      console.error(`${name} s’est arrêté (code ${code})`)
      void stop(1)
    }
  })
  child.once('error', error => {
    console.error(`Échec au démarrage de ${name}: ${error.code || error.name}`)
    void stop(1)
  })
  return child
}

async function init(step, env) {
  const child = run(step, ['node', '/app/server/apps/api/bootstrap.mjs', step], env, { oneShot: true })
  const [code] = await once(child, 'close')
  if (code !== 0)
    throw new Error(`Initialisation ${step} interrompue (code ${code})`)
}

async function ready(port) {
  for (let i = 0; i < 75; i++) {
    try {
      const result = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(1500) })
      if (result.ok)
        return
    }
    catch {}
    await delay(1500)
  }
  throw new Error(`AIRI sur le port ${port} n’est pas prêt`)
}

async function main() {
  const url = new URL(base.PUBLIC_URL || `https://${required('RAILWAY_PUBLIC_DOMAIN')}`)
  if (url.pathname !== '/' || url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && url.origin !== 'http://localhost:8080'))
    throw new Error('PUBLIC_URL doit être une origine HTTPS ou http://localhost:8080 pour Compose')
  const secret = required('APP_SECRET', 32)
  const owner = required('OWNER_EMAIL').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner))
    throw new Error('OWNER_EMAIL doit être une adresse e-mail valide')
  const password = required('OWNER_PASSWORD', 16)
  if (password.length > 128)
    throw new Error('OWNER_PASSWORD doit contenir au plus 128 caractères')
  for (const name of ['DATABASE_URL', 'REDIS_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_UPSTREAM', 'OLLAMA_UPSTREAM', 'VOICE_UPSTREAM'])
    required(name)

  const cfg = {
    chat: base.OLLAMA_MODEL || 'qwen2.5:1.5b',
    speech: base.TTS_MODEL || 'speaches-ai/Kokoro-82M-v1.0-ONNX',
    transcription: base.STT_MODEL || 'Systran/faster-whisper-base',
    voice: base.TTS_VOICE || 'ff_siwis',
  }
  await writeFile('/srv/stage/selfhost.js',
    `globalThis.AIRI_SELFHOST = ${JSON.stringify(cfg)};\n` + await readFile('/opt/airi/client.js', 'utf8'))

  const { OWNER_PASSWORD, APP_SECRET, ...serviceEnv } = base
  const origin = url.origin
  const env = {
    ...serviceEnv,
    OWNER_EMAIL: owner,
    AIRI_BOOTSTRAP_TOKEN: createHmac('sha256', secret).update('airi-owner-bootstrap').digest('hex'),
    PUBLIC_ORIGIN: origin,
    PUBLIC_SCHEME: url.protocol.slice(0, -1),
    HOST: '127.0.0.1',
    OTEL_SDK_DISABLED: 'true',
    DB_POOL_MAX: '6',
    ADDITIONAL_TRUSTED_ORIGINS: origin,
    PUBLIC_URL: origin,
    API_SERVER_URL: origin,
    AUTH_SERVER_URL: origin,
    AUTH_SERVER_INTERNAL_URL: 'http://127.0.0.1:3001',
    AUTH_UI_URL: `${origin}/ui`,
    RESOURCE_SERVER_URL: 'http://127.0.0.1:3000',
    WEB_APP_URL: origin,
    S3_BUCKET: 'airi-private',
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: origin,
    S3_INTERNAL_ENDPOINT: `http://${base.S3_UPSTREAM}`,
    S3_FORCE_PATH_STYLE: 'true',
    LLM_ROUTER_MASTER_KEY: createHmac('sha256', secret).update('airi-router').digest('base64'),
    BETTER_AUTH_SECRET: createHmac('sha256', secret).update('airi-auth').digest('base64url'),
    AUTH_GOOGLE_CLIENT_ID: 'disabled',
    AUTH_GOOGLE_CLIENT_SECRET: 'disabled',
    AUTH_GITHUB_CLIENT_ID: 'disabled',
    AUTH_GITHUB_CLIENT_SECRET: 'disabled',
  }

  await init('storage', env)
  const args = ['node', '--import', 'tsx', '--import', './instrumentation.ts', 'src/main.ts']
  run('AIRI API', args, { ...env, PORT: '3000' }, { cwd: '/app/server/apps/api' })
  await ready(3000)
  run('AIRI Auth', args, { ...env, PORT: '3001' }, { cwd: '/app/server/apps/auth' })
  await ready(3001)
  await init('owner', { ...env, OWNER_PASSWORD: password })
  guard = createGuard({ origin, owner })
  guard.listen(3002, '127.0.0.1')
  await once(guard, 'listening')
  run('Caddy', ['caddy', 'run', '--config', '/opt/airi/Caddyfile', '--adapter', 'caddyfile'], env)
}

try {
  await main()
}
catch (error) {
  console.error(error.message)
  await stop(1)
}
