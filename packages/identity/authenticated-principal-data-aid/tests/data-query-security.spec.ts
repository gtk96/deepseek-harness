import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DataQueryRuntime from '@deepseek-ai/dsh-data-query'
import type { DataQueryProvider, DataQueryRequest } from '@deepseek-ai/dsh-data-query'
import { AuthenticatedPrincipalService, freezeAuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { MessageId, CallId } from '@deepseek-ai/dsh-llm'
import { buildRequest, apply as applyDataAidQueryTool } from '../src/data-query-tool.ts'
import { DataAidTurnPrincipalService } from '../src/turn-principal.ts'
import type {} from '@deepseek-ai/dsh-agent'

class TestPrincipalService extends AuthenticatedPrincipalService {
  async authenticate(): Promise<AuthenticatedPrincipal> {
    throw new Error('not used by turn-binding tests')
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
    authorizedScope: { tenant: 'fixture', user },
  })
}

function message(id: string): UserMessage {
  return { id: MessageId(id), content: [{ type: 'text', text: id }], source: { kind: 'user' } } as UserMessage
}

const agent = { id: 'data-aid-agent' } as Agent

async function mounted(): Promise<{
  readonly ctx: Context
  readonly principalService: TestPrincipalService
  readonly turns: DataAidTurnPrincipalService
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const principalFiber = ctx.plugin(TestPrincipalService)
  await principalFiber
  const turnFiber = ctx.plugin(DataAidTurnPrincipalService)
  await turnFiber
  const principalService = ctx.get('authenticatedPrincipal')
  const turns = ctx.get('dataAidTurnPrincipal')
  if (principalService === undefined || turns === undefined) throw new Error('test services were not installed')
  return {
    ctx,
    principalService: principalService as TestPrincipalService,
    turns,
    dispose: async () => {
      await turnFiber.dispose()
      await principalFiber.dispose()
    },
  }
}

describe('DataAidTurnPrincipalService', () => {
  it('carries only the authenticated message Principal into its matching live turn and erases it at turn stop', async () => {
    const { ctx, principalService, turns, dispose } = await mounted()
    const bound = principal('one')
    const item = message('data-aid-message-one')
    principalService.withPrincipal(bound, () => {
      ctx.emit('agent/inbox/inserted', { agent, message: item })
    })

    expect(principalService.current()).toBeUndefined()
    expect(() => turns.require(agent)).toThrow('authenticated active turn')

    ctx.emit('agent/inbox/claimed', { agent, message: item, turn: 7 })
    expect(turns.require(agent)).toBe(bound)

    ctx.emit('agent/turn-stopping', { agent, turn: 7, signal: new AbortController().signal })
    expect(() => turns.require(agent)).toThrow('authenticated active turn')

    await dispose()
  })

  it('fails closed for concurrent Principals claimed into one turn and clears queued references on discard', async () => {
    const { ctx, principalService, turns, dispose } = await mounted()
    const first = message('data-aid-message-first')
    const second = message('data-aid-message-second')
    const discarded = message('data-aid-message-discarded')
    principalService.withPrincipal(principal('one'), () => ctx.emit('agent/inbox/inserted', { agent, message: first }))
    principalService.withPrincipal(principal('two'), () => ctx.emit('agent/inbox/inserted', { agent, message: second }))
    principalService.withPrincipal(principal('discarded'), () => ctx.emit('agent/inbox/inserted', { agent, message: discarded }))

    ctx.emit('agent/inbox/discarded', { agent, message: discarded })
    ctx.emit('agent/inbox/claimed', { agent, message: first, turn: 8 })
    ctx.emit('agent/inbox/claimed', { agent, message: second, turn: 8 })

    expect(() => turns.require(agent)).toThrow('conflicting authenticated principals')
    await dispose()
  })
})

describe('data_query semantic request', () => {
  it('builds a host-owned semantic request from tool arguments and the authenticated Principal', () => {
    expect(buildRequest({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: ['team_code'],
      filters: [{ dimension: 'team_code', op: 'eq', value: '1001' }],
      timeRange: { dimension: 'sale_date', start: '2026-08-01', end: '2026-08-02' },
      orderBy: [{ field: 'revenue', direction: 'desc' }],
    }, principal('one'), 50)).toEqual({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: ['team_code'],
      filters: [{ dimension: 'team_code', op: 'eq', value: '1001' }],
      timeRange: { dimension: 'sale_date', start: '2026-08-01', end: '2026-08-02' },
      orderBy: [{ field: 'revenue', direction: 'desc' }],
      limit: 50,
      principal: principal('one'),
    })
  })

  it('applies the configured default limit and rejects a non-positive explicit limit', () => {
    expect(buildRequest({ datasetCode: 'sales_daily', metricCodes: ['order_count'] }, principal('one'), 100).limit).toBe(100)
    expect(() => buildRequest({ datasetCode: 'sales_daily', metricCodes: ['order_count'], limit: 0 }, principal('one'), 100)).toThrow('positive integer')
  })
})

describe('data_query tool execution', () => {
  it('dispatches a semantic request through the configured data-query provider and denies execution after turn cleanup', async () => {
    const ctx = new Context()
    const principalFiber = ctx.plugin(TestPrincipalService)
    await principalFiber
    const turnFiber = ctx.plugin(DataAidTurnPrincipalService)
    await turnFiber
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(DataQueryRuntime, { provider: 'test' })
    const requests: DataQueryRequest[] = []
    const provider: DataQueryProvider = {
      id: 'test',
      available: () => true,
      async query(request) {
        requests.push(request)
        return { columns: ['team_code', 'order_count'], rows: [['team-one', 12]] }
      },
    }
    ctx.dataQuery.registerProvider(provider)
    applyDataAidQueryTool(ctx, { timeoutSeconds: 15, defaultLimit: 50 })

    const item = message('data-query-tool-message')
    const authenticated = principal('one')
    const principalService = ctx.get('authenticatedPrincipal')
    if (principalService === undefined) throw new Error('test Principal service was not installed')
    principalService.withPrincipal(authenticated, () => ctx.emit('agent/inbox/inserted', { agent, message: item }))
    ctx.emit('agent/inbox/claimed', { agent, message: item, turn: 9 })

    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      callId: CallId('data-query-tool-call'),
      name: 'data_query',
      arguments: {
        datasetCode: 'sales_daily',
        metricCodes: ['order_count', 'revenue'],
        filters: [{ dimension: 'team_code', op: 'eq', value: '1001' }],
      },
      agent,
      signal,
    })
    expect(result).toMatchObject({
      isError: false,
      value: { columns: ['team_code', 'order_count'], rows: [['team-one', 12]] },
    })
    expect(requests).toEqual([{
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: [],
      filters: [{ dimension: 'team_code', op: 'eq', value: '1001' }],
      limit: 50,
      principal: authenticated,
    }])

    ctx.emit('agent/turn-stopping', { agent, turn: 9, signal })
    const denied = await ctx.tools.execute({
      callId: CallId('data-query-tool-after-turn'),
      name: 'data_query',
      arguments: { datasetCode: 'sales_daily', metricCodes: ['order_count'] },
      agent,
      signal,
    })
    expect(denied).toMatchObject({ isError: true })
    expect(requests).toHaveLength(1)

    await ctx.fiber.dispose()
  })
})
