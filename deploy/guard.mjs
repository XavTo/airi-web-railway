import { createServer } from 'node:http'

export function createGuard({ origin, owner, authUrl = 'http://127.0.0.1:3001/api/auth/get-session' }) {
  return createServer(async (req, res) => {
    function reply(code, message) {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(message ? JSON.stringify({ error: { message } }) : undefined)
    }
    if (req.method !== 'GET' || req.url !== '/authorized')
      return reply(404, 'Not found')
    if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site')
      return reply(403, 'Cross-origin request rejected')
    if (!req.headers.cookie)
      return reply(401, 'Sign in to AIRI to use local inference')
    try {
      const session = await fetch(authUrl, {
        headers: { cookie: req.headers.cookie, origin, 'X-Forwarded-Proto': new URL(origin).protocol.slice(0, -1) },
        signal: AbortSignal.timeout(5000),
      })
      if (!session.ok)
        return reply(503, 'AIRI session service is unavailable')
      const data = await session.json()
      if (data?.user?.email?.toLowerCase() !== owner)
        return reply(401, 'Sign in with the AIRI owner account')
      return reply(204)
    }
    catch {
      return reply(503, 'AIRI session service is unavailable')
    }
  })
}
