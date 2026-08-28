import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { jwtVerify } from 'jose'
import { Context } from '@deepseek-ai/cordis'
import DataQueryRuntime from '@deepseek-ai/dsh-data-query'
import type {
  DataQueryContext,
  DataQueryConversationId,
  DataQueryTurnId,
} from '@deepseek-ai/dsh-data-query'
import type { GkUserId } from '@deepseek-ai/dsh-authenticated-principal'
import * as dicBePlugin from '@deepseek-ai/dsh-data-query-dic-be'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import {
  DIC_BE_DATA_QUERY_PROVIDER_ID,
  DicBeDataQueryProvider,
  readCappedText,
  validateResponse,
} from '@deepseek-ai/dsh-data-query-dic-be'
import type { DicBeDataQueryProviderOptions } from '@deepseek-ai/dsh-data-query-dic-be'

const activeSecret = 'test-active-assertion-secret-32-bytes-minimum'
const previousSecret = 'test-previous-assertion-secret-32-bytes-minimum'
const servers: Server[] = []

const queryContext: DataQueryContext = {
  principalId: 'gk-user' as GkUserId,
  conversationId: 'conversation-one' as DataQueryConversationId,
  turnId: 'turn-one' as DataQueryTurnId,
}

const semanticRequest = {
  datasetCode: 'sales_daily',
  metricCodes: ['order_count', 'revenue'],
  dimensionCodes: ['team_code'],
  limit: 20,
}

function options(baseURL: string, overrides: Partial<DicBeDataQueryProviderOptions> = {}): DicBeDataQueryProviderOptions {
  return {
    baseURL,
    path: '/v1/internal/data-query/query',
    issuer: 'dsh',
    audience: 'dic-be:data-query',
    assertionKeyRing: { active: activeSecret, previous: previousSecret },
    assertionActiveKid: 'active',
    assertionTtlSeconds: 30,
    timeoutSeconds: 5,
    maxRows: 100,
    maxResultBytes: 2_000,
    ...overrides,
  }
}

async function listen(handler: (request: IncomingMessage, response: import('node:http').ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })))
})

function completeResponse(rows: unknown[][] = [['team-one', 12]]): string {
  return JSON.stringify({
    columns: ['team_code', 'order_count'],
    rows,
    rowCount: rows.length,
    complete: true,
    truncated: false,
  })
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

describe('DicBeDataQueryProvider', () => {
  it('posts only semantic fields and signs the exact active-kid turn-bound claims', async () => {
    let receivedBody: unknown
    let assertion: string | undefined
    const baseURL = await listen((request, response) => {
      expect(request.url).toBe('/v1/internal/data-query/query')
      assertion = request.headers['x-dsh-principal-assertion'] as string | undefined
      void readBody(request).then((body) => {
        receivedBody = JSON.parse(body) as unknown
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        response.end(completeResponse())
      }, (error: unknown) => response.destroy(error as Error))
    })

    const result = await new DicBeDataQueryProvider(options(baseURL)).query(semanticRequest, queryContext)
    expect(receivedBody).toEqual({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: ['team_code'],
      limit: 20,
    })
    expect(result).toEqual({
      columns: ['team_code', 'order_count'],
      rows: [['team-one', 12]],
      rowCount: 1,
      complete: true,
      truncated: false,
    })

    const verified = await jwtVerify(assertion ?? '', new TextEncoder().encode(activeSecret), {
      algorithms: ['HS256'],
      issuer: 'dsh',
      audience: 'dic-be:data-query',
      subject: 'gk-user',
    })
    expect(verified.protectedHeader).toEqual({ alg: 'HS256', typ: 'JWT', kid: 'active' })
    expect(Object.keys(verified.payload).sort()).toEqual([
      'aud', 'conversationId', 'exp', 'iat', 'iss', 'jti', 'sub', 'turnId',
    ])
    expect(verified.payload).toMatchObject({ conversationId: 'conversation-one', turnId: 'turn-one' })
    expect(verified.payload.jti).toMatch(/^[A-Za-z0-9_-]{16,64}$/u)
    expect(verified.payload.exp).toBe((verified.payload.iat as number) + 30)
  })

  it('forwards the DIC-BE array-operand semantic protocol unchanged', async () => {
    let receivedBody: unknown
    const baseURL = await listen((request, response) => {
      void readBody(request).then((body) => {
        receivedBody = JSON.parse(body) as unknown
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(completeResponse())
      }, (error: unknown) => response.destroy(error as Error))
    })

    await new DicBeDataQueryProvider(options(baseURL)).query({
      ...semanticRequest,
      filters: [{ dimensionCode: 'team_code', operator: 'in', value: ['1001', '1002'] }],
      timeRange: { dimensionCode: 'sale_date', startInclusive: '2026-08-01', endExclusive: '2026-08-02' },
      orderBy: [{ fieldCode: 'revenue', direction: 'desc' }],
    }, queryContext)
    expect(receivedBody).toEqual({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: ['team_code'],
      filters: [{ dimensionCode: 'team_code', operator: 'in', value: ['1001', '1002'] }],
      timeRange: { dimensionCode: 'sale_date', startInclusive: '2026-08-01', endExclusive: '2026-08-02' },
      orderBy: [{ fieldCode: 'revenue', direction: 'desc' }],
      limit: 20,
    })
  })

  it.each([301, 302, 303, 307, 308])('rejects HTTP %i without contacting the redirect target', async (status) => {
    let targetRequests = 0
    const target = await listen((_request, response) => {
      targetRequests++
      response.writeHead(204).end()
    })
    const source = await listen((_request, response) => {
      response.writeHead(status, { location: `${target}/collect` }).end()
    })

    await expect(new DicBeDataQueryProvider(options(source)).query(semanticRequest, queryContext))
      .rejects.toThrow('request failed')
    expect(targetRequests).toBe(0)
  })


  it('preserves only an exact stable DIC-BE rejection envelope', async () => {
    let body = JSON.stringify({ code: 200, bizCode: 'DQ_POLICY_DENIED', msg: 'policy denied', data: {} })
    const baseURL = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
    })
    const provider = new DicBeDataQueryProvider(options(baseURL))

    await expect(provider.query(semanticRequest, queryContext)).rejects.toMatchObject({ code: 'DQ_POLICY_DENIED' })
    body = JSON.stringify({ code: 200, bizCode: 'DQ_POLICY_DENIED', msg: 'policy denied', data: {}, detail: 'secret' })
    await expect(provider.query(semanticRequest, queryContext)).rejects.toThrow('malformed')
  })

  it('rejects non-JSON, extra fields, malformed matrices, finite violations, and row overflow', async () => {
    let contentType = 'text/plain'
    let body = completeResponse()
    const baseURL = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': contentType })
      response.end(body)
    })
    const provider = new DicBeDataQueryProvider(options(baseURL, { maxRows: 1 }))

    await expect(provider.query({ ...semanticRequest, limit: 1 }, queryContext)).rejects.toThrow('application/json')
    contentType = 'application/json'
    body = JSON.stringify({ ...JSON.parse(completeResponse()) as object, success: true })
    await expect(provider.query({ ...semanticRequest, limit: 1 }, queryContext)).rejects.toThrow('malformed')
    body = completeResponse([[1], [2]])
    await expect(provider.query({ ...semanticRequest, limit: 1 }, queryContext)).rejects.toThrow('result bounds')
    body = '{"columns":["value"],"rows":[[1e400]],"rowCount":1,"complete":true,"truncated":false}'
    await expect(provider.query({ ...semanticRequest, limit: 1 }, queryContext)).rejects.toThrow('result bounds')
  })

  it('caps both wire and normalized output in UTF-8 bytes', async () => {
    await expect(readCappedText(new Response('你'), 2)).rejects.toThrow('2 UTF-8 bytes')

    const body = completeResponse([['你好', 12]])
    const bytes = new TextEncoder().encode(body).byteLength
    const baseURL = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
    })
    await expect(new DicBeDataQueryProvider(options(baseURL, { maxResultBytes: bytes })).query(semanticRequest, queryContext))
      .resolves.toMatchObject({ rowCount: 1 })
    await expect(new DicBeDataQueryProvider(options(baseURL, { maxResultBytes: bytes - 1 })).query(semanticRequest, queryContext))
      .rejects.toThrow('UTF-8 bytes')
  })

  it('accepts bounded nested object/array cells and rejects unsafe recursive values', async () => {
    let body = completeResponse([[{ region: 'east', series: [1, { value: 2 }] }, ['a', { ok: true }]]])
    const baseURL = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
    })
    const provider = new DicBeDataQueryProvider(options(baseURL, { maxResultBytes: 20_000 }))

    await expect(provider.query(semanticRequest, queryContext)).resolves.toMatchObject({
      rows: [[{ region: 'east', series: [1, { value: 2 }] }, ['a', { ok: true }]]],
    })

    body = '{"columns":["a","b"],"rows":[[{"nested":[1e400]},[]]],"rowCount":1,"complete":true,"truncated":false}'
    await expect(provider.query(semanticRequest, queryContext)).rejects.toThrow('result bounds')

    let deep: unknown = 'leaf'
    for (let depth = 0; depth < 66; depth++) deep = [deep]
    body = completeResponse([[deep, null]])
    await expect(provider.query(semanticRequest, queryContext)).rejects.toThrow('result bounds')
  })

  it('rejects nested values that are not lossless plain JSON', () => {
    const responseWith = (value: unknown): Record<string, unknown> => ({
      columns: ['a', 'b'],
      rows: [[value, null]],
      rowCount: 1,
      complete: true,
      truncated: false,
    })
    const withAccessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 1,
    })
    for (const value of [new Date(0), { value: -0 }, withAccessor]) {
      expect(() => validateResponse(responseWith(value), { maxRows: 1, maxResultBytes: 2_000 }))
        .toThrow('result bounds')
    }
  })

  it('aborts the HTTP exchange when the caller signal aborts', async () => {
    const started = Promise.withResolvers<undefined>()
    const disconnected = Promise.withResolvers<undefined>()
    const baseURL = await listen((request) => {
      started.resolve(undefined)
      request.socket.once('close', () => { disconnected.resolve(undefined) })
    })
    const controller = new AbortController()
    const pending = new DicBeDataQueryProvider(options(baseURL)).query(semanticRequest, queryContext, controller.signal)
    await started.promise
    controller.abort(new Error('caller stopped'))

    await expect(pending).rejects.toThrow('request aborted')
    await expect(disconnected.promise).resolves.toBeUndefined()
  })

  it('times out and aborts the HTTP exchange under one deadline signal', async () => {
    const disconnected = Promise.withResolvers<undefined>()
    const baseURL = await listen((request) => {
      request.socket.once('close', () => { disconnected.resolve(undefined) })
    })
    const provider = new DicBeDataQueryProvider(options(baseURL, { timeoutSeconds: 0.02 }))

    await expect(provider.query(semanticRequest, queryContext)).rejects.toThrow('request timed out')
    await expect(disconnected.promise).resolves.toBeUndefined()
  })

  it('fails configuration above TTL, timeout, row, and byte ceilings or with unsafe signing keys', () => {
    const valid = options('https://dic-be.internal')
    expect(() => new DicBeDataQueryProvider({ ...valid, assertionTtlSeconds: 61 })).toThrow('1 to 60')
    expect(() => new DicBeDataQueryProvider({ ...valid, timeoutSeconds: 31 })).toThrow('no greater than 30')
    expect(() => new DicBeDataQueryProvider({ ...valid, maxRows: 101 })).toThrow('1 to 100')
    expect(() => new DicBeDataQueryProvider({ ...valid, maxResultBytes: 16_777_217 })).toThrow('1 to 16777216')
    expect(() => new DicBeDataQueryProvider({ ...valid, assertionActiveKid: 'missing' })).toThrow('contain assertionActiveKid')
    for (const secret of [
      'replace-with-a-32-byte-or-longer-secret',
      'example-only-assertion-secret-32-bytes-minimum',
      'dummy_secret_0123456789_abcdefghijklmnop',
    ]) {
      expect(() => new DicBeDataQueryProvider({
        ...valid,
        assertionKeyRing: { active: secret },
      }), secret).toThrow('weak secret')
    }
  })

  it('registers for the provider fiber lifetime', async () => {
    const baseURL = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(completeResponse())
    })
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: { DATA_AID_QUERY_BASE_URL: baseURL },
    }]))
    const { baseURL: snapshotBaseURL, ...config } = options(baseURL)
    expect(snapshotBaseURL).toBe(baseURL)
    await ctx.plugin(DataQueryRuntime, { provider: DIC_BE_DATA_QUERY_PROVIDER_ID })
    const fiber = await ctx.plugin(dicBePlugin, config)
    await expect(ctx.dataQuery.query(semanticRequest, queryContext)).resolves.toMatchObject({ columns: ['team_code', 'order_count'] })
    await fiber.dispose()
    expect(() => ctx.dataQuery.query(semanticRequest, queryContext)).toThrow('not registered')
    expect('default' in dicBePlugin).toBe(false)
    await ctx.fiber.dispose()
  })
})
