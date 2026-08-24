/**
 * Assembled data-query composition: exactly one model-facing tool, real
 * provider HTTP round trip, and fail-closed turn binding.
 *
 * This mirrors the `data-aid` profile's agent-plane contribution (the tool)
 * plus the host-plane data-query runtime and dic-be provider, exercised
 * against a real fake dic-be HTTP endpoint instead of a mocked provider.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DataQueryRuntime from '@deepseek-ai/dsh-data-query'
import * as dicBePlugin from '@deepseek-ai/dsh-data-query-dic-be'
import type { DicBeDataQueryProviderOptions } from '@deepseek-ai/dsh-data-query-dic-be'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { AuthenticatedPrincipalService, freezeAuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { MessageId, CallId } from '@deepseek-ai/dsh-llm'
import { DATA_QUERY_TOOL_NAME, apply as applyDataAidQueryTool } from '../src/data-query-tool.ts'
import { DataAidTurnPrincipalService } from '../src/turn-principal.ts'

const servers: Server[] = []

async function listen(handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

function completeResponse(): string {
  return JSON.stringify({
    success: true,
    complete: true,
    truncated: false,
    rowCount: 1,
    rowsReturned: 1,
    columns: ['team_code', 'order_count'],
    rows: [['team-one', 12]],
  })
}

function providerOptions(baseURL: string): DicBeDataQueryProviderOptions {
  return {
    baseURL,
    path: '/query',
    issuer: 'dsh-composition-test',
    audience: 'dic-be-test',
    assertionSecret: 'test-assertion-secret-at-least-32-bytes',
    assertionTtlSeconds: 30,
    timeoutSeconds: 5,
    maxRows: 100,
    maxResultChars: 2_000,
  }
}

class TestPrincipalService extends AuthenticatedPrincipalService {
  async authenticate(): Promise<AuthenticatedPrincipal> {
    throw new Error('not used by composition test')
  }
}

function principal(user: string): AuthenticatedPrincipal {
  return freezeAuthenticatedPrincipal({
    ddUserId: `dd-${user}` as AuthenticatedPrincipal['ddUserId'],
    gkUserId: `gk-${user}` as AuthenticatedPrincipal['gkUserId'],
    gimpStaffId: `staff-${user}` as AuthenticatedPrincipal['gimpStaffId'],
    dataRole: 'reader' as AuthenticatedPrincipal['dataRole'],
    teamCodes: [`team-${user}`] as unknown as AuthenticatedPrincipal['teamCodes'],
    dataOrgCodes: [`org-${user}`] as unknown as AuthenticatedPrincipal['dataOrgCodes'],
  })
}

function message(id: string): UserMessage {
  return { id: MessageId(id), content: [{ type: 'text', text: id }], source: { kind: 'user' } } as UserMessage
}

const agent = { id: 'data-aid-agent' } as Agent

describe('assembled data-query composition', () => {
  it('exposes exactly data_query, dispatches a real semantic query to dic-be, and denies after turn cleanup', async () => {
    let receivedBody: unknown
    let assertionHeader: string | undefined
    const baseURL = await listen((request, response) => {
      assertionHeader = request.headers['x-dsh-principal-assertion'] as string | undefined
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        receivedBody = JSON.parse(body) as unknown
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(completeResponse())
      })
    })

    const ctx = new Context()
    const principalFiber = ctx.plugin(TestPrincipalService)
    await principalFiber
    const turnFiber = ctx.plugin(DataAidTurnPrincipalService)
    await turnFiber
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(DataQueryRuntime, { provider: dicBePlugin.providerId })
    await ctx.plugin(dicBePlugin, providerOptions(baseURL))

    // Capture the only tool registration the composition performs.
    const registered: string[] = []
    const originalRegister = ctx.tools.register.bind(ctx.tools)
    const toolsAny = ctx.tools as unknown as { register: (definition: ToolDefinition) => () => void }
    toolsAny.register = (definition) => {
      registered.push(definition.name)
      return originalRegister(definition)
    }
    applyDataAidQueryTool(ctx, { timeoutSeconds: 15, defaultLimit: 50 })
    expect(registered).toEqual([DATA_QUERY_TOOL_NAME])

    const item = message('composition-message')
    const authenticated = principal('one')
    const principalService = ctx.get('authenticatedPrincipal')
    if (principalService === undefined) throw new Error('test Principal service was not installed')
    principalService.withPrincipal(authenticated, () => ctx.emit('agent/inbox/inserted', { agent, message: item }))
    ctx.emit('agent/inbox/claimed', { agent, message: item, turn: 9 })

    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      callId: CallId('composition-call'),
      name: DATA_QUERY_TOOL_NAME,
      arguments: { datasetCode: 'sales_daily', metricCodes: ['order_count'] },
      agent,
      signal,
    })
    expect(result).toMatchObject({
      isError: false,
      value: { columns: ['team_code', 'order_count'], rows: [['team-one', 12]] },
    })
    expect(receivedBody).toEqual({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count'],
      dimensionCodes: [],
      limit: 50,
    })
    expect(assertionHeader).toEqual(expect.stringContaining('.'))
    expect(assertionHeader).not.toContain('Bearer')

    ctx.emit('agent/turn-stopping', { agent, turn: 9, signal })
    const denied = await ctx.tools.execute({
      callId: CallId('composition-after-turn'),
      name: DATA_QUERY_TOOL_NAME,
      arguments: { datasetCode: 'sales_daily', metricCodes: ['order_count'] },
      agent,
      signal,
    })
    expect(denied).toMatchObject({ isError: true })

    await ctx.fiber.dispose()
  })
})

afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})
