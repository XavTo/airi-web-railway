import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.argv[2] || '.'
function patch(file, before, after) {
  const path = resolve(root, file)
  const source = readFileSync(path, 'utf8')
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before))
    throw new Error(`AIRI patch no longer matches: ${file}: ${before}`)
  writeFileSync(path, source.replace(before, () => after))
}

// The OIDC client, sync and all web API requests share the deploy's public origin.
patch('packages/stage-ui/src/libs/server.ts',
  "import.meta.env.VITE_SERVER_URL || 'https://api.airi.build'",
  "(typeof window !== 'undefined' ? window.location.origin : 'http://localhost')")
patch('apps/ui-server-auth/vite.config.ts', "base: '/',", "base: '/ui/',")
patch('apps/stage-web/index.html', '<title>AIRI</title>',
  '<title>AIRI</title>\n    <script src="/selfhost.js"></script>')

// Account creation is restricted by the gateway and performed only at startup.
// Marking the bootstrapped address verified is done explicitly in bootstrap.mjs.
patch('server/apps/auth/src/auth.ts', 'sendOnSignUp: true,', 'sendOnSignUp: false,')
patch('server/apps/auth/src/auth.ts', 'requireEmailVerification: true,', 'requireEmailVerification: false,')

// Sign links for the browser with the public origin, but use private networking
// for API reads, uploads, checks and deletes.
const s3Config = 'server/apps/api/src/services/adapters/s3-config.ts'
patch(s3Config, '  S3_BUCKET:', '  S3_INTERNAL_ENDPOINT: optional(pipe(string(), url())),\n  S3_BUCKET:')
const objects = 'server/apps/api/src/services/adapters/object-store.ts'
patch(objects, '  const client = new S3Client({', '  const options = {')
patch(objects, '  })\n  const bucket = config.S3_BUCKET', `  } as const
  const signer = new S3Client(options)
  const client = config.S3_INTERNAL_ENDPOINT
    ? new S3Client({ ...options, endpoint: config.S3_INTERNAL_ENDPOINT })
    : signer
  const bucket = config.S3_BUCKET`)
patch(objects, 'getSignedUrl(client, command', 'getSignedUrl(signer, command')
patch(objects, 'getSignedUrl(client, new GetObjectCommand', 'getSignedUrl(signer, new GetObjectCommand')
patch(objects, '      client.destroy()', '      client.destroy()\n      if (signer !== client) signer.destroy()')

// Keep the owner bootstrap header out of every public request and require it
// even if another route ever forwards requests to the private auth listener.
const auth = 'server/apps/auth/src/auth.ts'
patch(auth, "import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'",
  "import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'")
patch(auth, '      before: createAuthMiddleware(async (ctx) => {', `      before: createAuthMiddleware(async (ctx) => {
        const bootstrap = process.env.AIRI_BOOTSTRAP_TOKEN
        if (ctx.path === '/sign-up/email' && (!bootstrap || ctx.headers?.get('x-airi-bootstrap') !== bootstrap))
          throw new APIError('FORBIDDEN', { message: 'Registration is disabled' })`)
patch(auth, '  const uris = new Set(DEFAULT_WEB_REDIRECT_URIS)', '  const uris = new Set<string>()')

for (const file of ['server/apps/auth/src/origin.ts', 'server/apps/api/src/utils/origin.ts']) {
  patch(file, `  if (TRUSTED_EXACT_ORIGINS.includes(origin))
    return origin
  if (additionalTrustedOrigins.includes(origin))
    return origin
  if (matchesTrustedOriginRule(origin))
    return origin`, `  if (additionalTrustedOrigins.includes(origin))
    return origin`)
}
patch('server/apps/auth/src/origin.ts', `  for (const origin of TRUSTED_AUTH_CALLBACK_ORIGINS) {
    origins.add(origin)
  }
  origins.add('https://appleid.apple.com')

  for (const origin of env.ADDITIONAL_TRUSTED_ORIGINS) {
    origins.add(origin)
  }

  for (const origin of ALWAYS_TRUSTED_AUTH_ORIGINS) {
    origins.add(origin)
  }`, `  for (const origin of env.ADDITIONAL_TRUSTED_ORIGINS) {
    origins.add(origin)
  }`)

patch('apps/stage-web/vite.config.ts', '              /^\\/api\\//,', '              /^\\/api\\//,\n              /^\\/auth\\/(?!callback(?:\\/|$))/,')
