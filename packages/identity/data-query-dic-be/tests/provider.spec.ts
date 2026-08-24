import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { jwtVerify } from 'jose'
import { Context } from '@deepseek-ai/cordis'
import DataQueryRuntime from '@deepseek-ai/dsh-data-query'
import { freezeAuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import * as dicBePlugin from '@deepseek-ai/dsh-data-query-dic-be'
import { DIC_BE_DATA_QUERY_PROVIDER_ID, DicBeDataQueryProvider } from '@deepseek-ai/dsh-data-query-dic-be'
import type { DicBeDataQueryProviderOptions } from '@deepseek-ai/dsh-data-query-dic-be'

const secret = 'test-assertion-secret-at-least-32-bytes'
const servers: Server[] = []

const principal = freezeAuthenticatedPrincipal({
  ddUserId: 'dd-user' as AuthenticatedPrincipal['ddUserId'],
  gkUserId: 'gk-user' as AuthenticatedPrincipal['gkUserId'],
  gimpStaffId: 'staff-user' as AuthenticatedPrincipal['gimpStaffId'],
  dataRole: 'regional-reader' as AuthenticatedPrincipal['dataRole'],
  teamCodes: ['team-one'] as unknown as AuthenticatedPrincipal['teamCodes'],
  dataOrgCodes: ['org-one'] as unknown as AuthenticatedPrincipal['dataOrgCodes'],
})

const semanticRequest = {
  datasetCode: 'sales_daily',
  metricCodes: ['order_count', 'revenue'],
  dimensionCodes: ['team_code'],
  limit: 20,
  principal,
}

function options(baseURL: string, overrides: Partial<DicBeDataQueryProviderOptions> = {}): DicBeDataQueryProviderOptions {
  return {
    baseURL,
    path: '/query',
    issuer: 'dsh-test',
    audience: 'dic-be-test',
    assertionSecret: secret,
    assertionTtlSeconds: 30,
    timeoutSeconds: 5,
    maxRows: 100,
    maxResultChars: 2_000,
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
    server.close(error => error === undefined ? resolve() : reject(error))
  })))
})

function completeResponse(rows: unknown[][] = [['team-one', 12]]): string {
  return JSON.stringify({
    success: true,
    complete: true,
    truncated: false,
    rowCount: rows.length,
    rowsReturned: rows.length,
    columns: ['team_code', 'order_count'],
    rows,
  })
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

describe('DicBeDataQueryProvider', () => {
  it('posts only the semantic query and signs short-lived host Principal claims', async () => {
    let receivedBody: unknown
    let assertion: string | undefined
    const baseURL = await listen((request, response) => {
      assertion = request.headers['x-dsh-principal-assertion'] as string | undefined
      void readBody(request).then((body) => {
        receivedBody = JSON.parse(body) as unknown
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(completeResponse())
      }, error => response.destroy(error as Error))
    })

    const result = await new DicBeDataQueryProvider(options(baseURL)).query(semanticRequest)
    expect(receivedBody).toEqual({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: ['team_code'],
      limit: 20,
    })
    expect(receivedBody).not.toHaveProperty('principal')
    expect(result).toEqual({ columns: ['team_code', 'order_count'], rows: [['team-one', 12]] })

    const verified = await jwtVerify(assertion ?? '', new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      issuer: 'dsh-test',
      audience: 'dic-be-test',
      subject: 'gk-user',
    })
    expect(verified.protectedHeader).toMatchObject({ alg: 'HS256', typ: 'JWT' })
    expect(verified.payload.dataRoles).toEqual(['regional-reader'])
    expect(verified.payload.jti).toEqual(expect.any(String))
    expect(verified.payload.iat).toEqual(expect.any(Number))
    expect(verified.payload.exp).toBe((verified.payload.iat as number) + 30)
  })

  it('forwards semantic filters, time range, and ordering when the request carries them', async () => {
    let receivedBody: unknown
    const baseURL = await listen((request, response) => {
      void readBody(request).then((body) => {
        receivedBody = JSON.parse(body) as unknown
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(completeResponse())
      }, error => response.destroy(error as Error))
    })

    await new DicBeDataQueryProvider(options(baseURL)).query({
      ...semanticRequest,
      filters: [{ dimension: 'team_code', op: 'in', value: ['1001', '1002'] }],
      timeRange: { dimension: 'sale_date', start: '2026-08-01', end: '2026-08-02' },
      orderBy: [{ field: 'revenue', direction: 'desc' }],
    })
    expect(receivedBody).toEqual({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: ['team_code'],
      filters: [{ dimension: 'team_code', op: 'in', value: ['1001', '1002'] }],
      timeRange: { dimension: 'sale_date', start: '2026-08-01', end: '2026-08-02' },
      orderBy: [{ field: 'revenue', direction: 'desc' }],
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

    await expect(new DicBeDataQueryProvider(options(source)).query(semanticRequest))
      .rejects.toThrow('request failed')
    expect(targetRequests).toBe(0)
  })

  it('rejects malformed, partial, over-row, and oversized responses', async () => {
    const request = { ...semanticRequest, limit: 1 }
    let body = JSON.stringify({ columns: ['value'], rows: [[1]] })
    const baseURL = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
    })
    const provider = new DicBeDataQueryProvider(options(baseURL, { maxRows: 1, maxResultChars: 300 }))

    await expect(provider.query(request)).rejects.toThrow('incomplete or malformed')
    body = completeResponse([[1, 2], [3, 4]])
    await expect(provider.query(request)).rejects.toThrow('result bounds')
    body = `${' '.repeat(301)}${completeResponse()}`
    await expect(provider.query(request)).rejects.toThrow('exceeds 300 characters')
  })

  it('registers for the provider fiber lifetime', async () => {
    const baseURL = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(completeResponse())
    })
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, { provider: DIC_BE_DATA_QUERY_PROVIDER_ID })
    const fiber = await ctx.plugin(dicBePlugin, options(baseURL))
    await expect(ctx.dataQuery.query(semanticRequest)).resolves.toMatchObject({ columns: ['team_code', 'order_count'] })
    await fiber.dispose()
    expect(() => ctx.dataQuery.query(semanticRequest)).toThrow('not registered')
    expect('default' in dicBePlugin).toBe(false)
    await ctx.fiber.dispose()
  })
})
