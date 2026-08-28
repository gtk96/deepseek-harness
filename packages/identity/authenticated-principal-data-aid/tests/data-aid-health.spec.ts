/** DSH data-aid health route tests. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as health from '../src/data-aid-health.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function start(): Promise<string> {
  context = new Context()
  await context.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await context.plugin(health, { livePath: '/healthz/live', readyPath: '/healthz/ready' })
  await context.loader?.await()
  return `http://127.0.0.1:${String(context.webServer.port)}`
}

describe('data-aid health routes', () => {
  it('serves exact liveness and readiness without exposing a fallback API', async () => {
    const base = await start()

    const live = await fetch(`${base}/healthz/live`)
    const ready = await fetch(`${base}/healthz/ready`)

    expect(live.status).toBe(200)
    expect(await live.json()).toEqual({ status: 'live' })
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: 'ready' })
    expect((await fetch(`${base}/healthz`)).status).toBe(404)
    expect((await fetch(`${base}/healthz/ready`, { method: 'POST' })).status).toBe(405)
  })

  it('rejects ambiguous or unsafe probe paths at load', async () => {
    context = new Context()
    await context.plugin(WebServer, { host: '127.0.0.1', port: 0 })

    await expect(context.plugin(health, { livePath: '/healthz', readyPath: '/healthz' }))
      .rejects.toThrow('must be distinct')
  })
})
