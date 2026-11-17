import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const [projectId, environmentId, workspaceId, repo = 'XavTo/airi-web-railway', branch = 'full-selfhost'] = process.argv.slice(2)
if (!projectId || !environmentId || !workspaceId || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('usage: node scripts/railway-input.mjs PROJECT_ID ENVIRONMENT_ID WORKSPACE_ID [OWNER/REPO [BRANCH]]')
  process.exit(2)
}
const baseTemplateId = '21e45dc2-f4a9-433b-a455-e20c5d612323'
const uuid = key => {
  const s = createHash('sha256').update(`${projectId}:${key}`).digest('hex')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`
}
const secret = length => '${{secret(' + length + ', "0123456789abcdef")}}'
const ref = name => '${{' + name + '}}'
const cfg = (value, description = undefined) => ({ defaultValue: value, isOptional: false, ...(description ? { description } : {}) })
const model = 'qwen2.5:1.5b'
const stt = 'Systran/faster-whisper-base'
const tts = 'speaches-ai/Kokoro-82M-v1.0-ONNX'
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const ollamaScript = await readFile(new URL('../deploy/ollama.sh', import.meta.url), 'utf8')
const startOllama = '/bin/bash -c ' + shellQuote(ollamaScript)
const source = { repo, branch, rootDirectory: null }
const volume = (name, path) => ({ [uuid(`${name}-volume`)]: { mountPath: path } })
function service(name, source, values, { port, mount, command, health, publicDomain } = {}) {
  return [uuid(name), {
    name,
    source,
    ...(mount ? { volumeMounts: volume(name, mount) } : {}),
    networking: publicDomain ? { serviceDomains: { [`<hasDomain>:${port}`]: { port } } } : {},
    variables: Object.fromEntries(Object.entries({ ...(port ? { PORT: cfg(String(port)) } : {}), ...values })),
    deploy: {
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
      ...(command ? { startCommand: command } : {}),
      ...(health ? { healthcheckPath: health, healthcheckTimeout: 600 } : {}),
      ...(mount ? { requiredMountPath: mount } : {}),
    },
  }]
}

const services = Object.fromEntries([
  service('AIRI', source, {
    OWNER_EMAIL: cfg('owner@example.net', 'Adresse de connexion du compte propriétaire initial. Aucun e-mail ne sera envoyé.'),
    OWNER_PASSWORD: cfg(secret(32), 'Mot de passe initial généré. À lire dans les variables AIRI après déploiement.'),
    APP_SECRET: cfg(secret(64), 'Secret stable de session et de chiffrement. À sauvegarder avec la base.'),
    DATABASE_URL: cfg(`postgres://airi:${ref('Postgres.POSTGRES_PASSWORD')}@${ref('Postgres.RAILWAY_PRIVATE_DOMAIN')}:5432/airi`),
    REDIS_URL: cfg(`redis://:${ref('Redis.REDIS_PASSWORD')}@${ref('Redis.RAILWAY_PRIVATE_DOMAIN')}:6379/0?family=0`),
    AWS_ACCESS_KEY_ID: cfg(ref('Storage.RUSTFS_ACCESS_KEY')),
    AWS_SECRET_ACCESS_KEY: cfg(ref('Storage.RUSTFS_SECRET_KEY')),
    S3_UPSTREAM: cfg(`${ref('Storage.RAILWAY_PRIVATE_DOMAIN')}:9000`),
    OLLAMA_UPSTREAM: cfg(`${ref('Ollama.RAILWAY_PRIVATE_DOMAIN')}:11434`),
    VOICE_UPSTREAM: cfg(`${ref('Voice.RAILWAY_PRIVATE_DOMAIN')}:8000`),
    OLLAMA_MODEL: cfg(ref('Ollama.OLLAMA_MODEL')),
    TTS_MODEL: cfg(ref('Voice.TTS_MODEL')),
    STT_MODEL: cfg(ref('Voice.STT_MODEL')),
    TTS_VOICE: cfg(ref('Voice.TTS_VOICE')),
  }, { port: 8080, health: '/healthz', publicDomain: true }),
  service('Postgres', { image: 'ghcr.io/tensorchord/vchord-postgres:pg18-v1.0.0' }, {
    POSTGRES_USER: cfg('airi'),
    POSTGRES_DB: cfg('airi'),
    POSTGRES_PASSWORD: cfg(secret(48)),
    PGDATA: cfg('/var/lib/postgresql/18/docker'),
  }, { port: 5432, mount: '/var/lib/postgresql' }),
  service('Redis', { image: 'redis:7.4.9-alpine' }, {
    REDIS_PASSWORD: cfg(secret(48)),
  }, { port: 6379, mount: '/data', command: '/bin/sh -ec ' + shellQuote('exec redis-server --appendonly yes --requirepass "$REDIS_PASSWORD"') }),
  service('Storage', { image: 'rustfs/rustfs:1.0.5' }, {
    RUSTFS_VOLUMES: cfg('/data/airi'),
    RUSTFS_ADDRESS: cfg('[::]:9000'),
    RUSTFS_CONSOLE_ENABLE: cfg('false'),
    RUSTFS_ACCESS_KEY: cfg('airi-app'),
    RUSTFS_SECRET_KEY: cfg(secret(48)),
    RAILWAY_RUN_UID: cfg('0'),
  }, { port: 9000, mount: '/data' }),
  service('Ollama', { image: 'ollama/ollama:0.13.5' }, {
    OLLAMA_HOST: cfg('[::]:11434'),
    OLLAMA_MODEL: cfg(model),
    OLLAMA_MODELS: cfg('/root/.ollama/models'),
    OLLAMA_NO_CLOUD: cfg('1'),
    OLLAMA_KEEP_ALIVE: cfg('2m'),
    OLLAMA_CONTEXT_LENGTH: cfg('4096'),
    OLLAMA_NUM_PARALLEL: cfg('1'),
    OLLAMA_MAX_LOADED_MODELS: cfg('1'),
  }, { port: 11434, mount: '/root/.ollama', command: startOllama }),
  service('Voice', { image: 'ghcr.io/speaches-ai/speaches:0.9.0-rc.3-cpu' }, {
    UVICORN_HOST: cfg('::'),
    UVICORN_PORT: cfg('8000'),
    HF_HUB_CACHE: cfg('/data/hub'),
    ENABLE_UI: cfg('false'),
    RAILWAY_RUN_UID: cfg('0'),
    WHISPER__INFERENCE_DEVICE: cfg('cpu'),
    WHISPER__COMPUTE_TYPE: cfg('int8'),
    PRELOAD_MODELS: cfg(JSON.stringify([ref('STT_MODEL'), ref('TTS_MODEL')])),
    STT_MODEL: cfg(stt),
    TTS_MODEL: cfg(tts),
    TTS_VOICE: cfg('ff_siwis'),
  }, { port: 8000, mount: '/data' }),
])

console.log(JSON.stringify({
  input: {
    templateId: baseTemplateId,
    projectId,
    environmentId,
    workspaceId,
    stageOnly: true,
    serializedConfig: { services, buckets: {} },
  },
}, null, 2))
