import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

const env = process.env

async function retry(label, attempt) {
  let reason
  for (let i = 0; i < 50; ++i) {
    try {
      return await attempt()
    }
    catch (error) {
      reason = error
      await delay(3000)
    }
  }
  throw new Error(`${label} non disponible (${reason.code || reason.name})`)
}

const db = new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 })
try {
  if (process.argv[2] === 'storage') {
    await retry('PostgreSQL / VectorChord', () => db.query('CREATE EXTENSION IF NOT EXISTS vchord CASCADE'))
    const s3 = new S3Client({
      endpoint: env.S3_INTERNAL_ENDPOINT, region: env.S3_REGION, forcePathStyle: true, maxAttempts: 1,
    })
    try {
      await retry('RustFS', async () => {
        const options = { Bucket: env.S3_BUCKET }
        const deadline = AbortSignal.timeout(6000)
        try {
          await s3.send(new HeadBucketCommand(options), { abortSignal: deadline })
        }
        catch (error) {
          if (error.$metadata?.httpStatusCode !== 404)
            throw error
          await s3.send(new CreateBucketCommand(options), { abortSignal: deadline })
        }
      })
    }
    finally {
      s3.destroy()
    }
  }
  else if (process.argv[2] === 'owner') {
    const email = env.OWNER_EMAIL
    const existing = await db.query('SELECT id FROM "user" WHERE email = $1', [email])
    if (!existing.rowCount) {
      const res = await fetch('http://127.0.0.1:3001/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': env.PUBLIC_ORIGIN,
          'X-Forwarded-Proto': env.PUBLIC_SCHEME,
          'X-Airi-Bootstrap': env.AIRI_BOOTSTRAP_TOKEN,
        },
        body: JSON.stringify({ email, name: 'AIRI Owner', password: env.OWNER_PASSWORD }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok)
        throw new Error(`Impossible d’initialiser le compte AIRI (HTTP ${res.status}).`)
    }
    await db.query('UPDATE "user" SET email_verified = true WHERE email = $1 AND NOT email_verified', [email])
  }
  else {
    throw new Error('bootstrap requires storage or owner')
  }
}
finally {
  await db.end()
}
