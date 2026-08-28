import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DataQueryRuntime from '@deepseek-ai/dsh-data-query'
import type {
  DataQueryContext,
  DataQueryConversationId,
  DataQueryProvider,
  DataQueryRequest,
  DataQueryTurnId,
} from '@deepseek-ai/dsh-data-query'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { AuthenticatedPrincipalService, freezeAuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { MessageId, CallId } from '@deepseek-ai/dsh-llm'
import { buildRequest, apply as applyDataAidQueryTool, type Config } from '../src/data-query-tool.ts'
import { DataAidTurnPrincipalService } from '../src/turn-principal.ts'
import type {} from '@deepseek-ai/dsh-agent'

const toolSchemaSnapshot = new URL('./snapshots/data-query-tool-schema.expected.json', import.meta.url)


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

function ids(conversation = 'conversation-one', turn = 'turn-one') {
  return {
    conversationId: conversation as DataQueryConversationId,
    turnId: turn as DataQueryTurnId,
  }
}

const toolConfig: Config = {
  timeoutSeconds: 15,
  defaultLimit: 50,
  maxSelectedFields: 8,
  maxFilters: 4,
  maxOrderBy: 4,
  maxInValues: 4,
  maxValueChars: 32,
}

function makeAgent(id: string): Agent {
  const session = Session.create(SessionId(id))
  return { id: session.id, session } as Agent
}

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

function insertTrusted(
  ctx: Context,
  turns: DataAidTurnPrincipalService,
  agent: Agent,
  item: UserMessage,
  authenticated: AuthenticatedPrincipal,
  binding = ids(),
): void {
  turns.withTurn({ principalId: authenticated.gkUserId, ...binding }, () => {
    ctx.emit('agent/inbox/inserted', { agent, message: item })
  })
}

describe('DataAidTurnPrincipalService', () => {
  it('captures only a complete trusted binding and erases it at turn stop', async () => {
    const { ctx, principalService, turns, dispose } = await mounted()
    const agent = makeAgent('data-aid-agent-one')
    const bound = principal('one')
    const item = message('data-aid-message-one')
    insertTrusted(ctx, turns, agent, item, bound)

    expect(principalService.current()).toBeUndefined()
    expect(() => turns.require(agent)).toThrow('authenticated active turn')

    ctx.emit('agent/inbox/claimed', { agent, message: item, turn: 7 })
    expect(turns.require(agent)).toEqual({ principalId: bound.gkUserId, ...ids() })

    ctx.emit('agent/turn-stopping', { agent, turn: 7, signal: new AbortController().signal })
    expect(() => turns.require(agent)).toThrow('authenticated active turn')
    await dispose()
  })

  it('does not invent business ids when only a Principal is present', async () => {
    const { ctx, principalService, turns, dispose } = await mounted()
    const agent = makeAgent('data-aid-agent-unbound')
    const item = message('data-aid-message-unbound')
    principalService.withPrincipal(principal('one'), () => {
      ctx.emit('agent/inbox/inserted', { agent, message: item })
    })
    ctx.emit('agent/inbox/claimed', { agent, message: item, turn: 8 })

    expect(() => turns.require(agent)).toThrow('conflicting trusted bindings')
    await dispose()
  })

  it('fails closed for conflicting Principal, conversation, or turn bindings and clears discarded references', async () => {
    for (const conflict of [
      { authenticated: principal('two'), binding: ids() },
      { authenticated: principal('one'), binding: ids('conversation-two', 'turn-one') },
      { authenticated: principal('one'), binding: ids('conversation-one', 'turn-two') },
    ]) {
      const { ctx, turns, dispose } = await mounted()
      const agent = makeAgent(`data-aid-agent-conflict-${conflict.binding.conversationId}-${conflict.binding.turnId}`)
      const first = message('data-aid-message-first')
      const second = message('data-aid-message-second')
      const discarded = message('data-aid-message-discarded')
      const firstPrincipal = principal('one')
      insertTrusted(ctx, turns, agent, first, firstPrincipal)
      insertTrusted(ctx, turns, agent, second, conflict.authenticated, conflict.binding)
      insertTrusted(ctx, turns, agent, discarded, principal('discarded'), ids('discarded', 'discarded'))

      ctx.emit('agent/inbox/discarded', { agent, message: discarded })
      ctx.emit('agent/inbox/claimed', { agent, message: first, turn: 9 })
      ctx.emit('agent/inbox/claimed', { agent, message: second, turn: 9 })

      expect(() => turns.require(agent)).toThrow('conflicting trusted bindings')
      await dispose()
    }
  })

  it('fails closed when one turn mixes bound and unbound claimed messages', async () => {
    for (const unboundFirst of [false, true]) {
      const { ctx, turns, dispose } = await mounted()
      const agent = makeAgent(`data-aid-agent-mixed-${String(unboundFirst)}`)
      const bound = message(`bound-${String(unboundFirst)}`)
      const unbound = message(`unbound-${String(unboundFirst)}`)
      insertTrusted(ctx, turns, agent, bound, principal('one'))
      ctx.emit('agent/inbox/inserted', { agent, message: unbound })

      const ordered = unboundFirst ? [unbound, bound] : [bound, unbound]
      ctx.emit('agent/inbox/claimed', { agent, message: ordered[0]!, turn: 11 })
      ctx.emit('agent/inbox/claimed', { agent, message: ordered[1]!, turn: 11 })

      expect(() => turns.require(agent)).toThrow('conflicting trusted bindings')
      await dispose()
    }
  })

  it('clears queued and active bindings when the Agent or service is disposed', async () => {
    const { ctx, turns, dispose } = await mounted()
    const agent = makeAgent('data-aid-agent-disposed')
    const active = message('active')
    const queued = message('queued')
    insertTrusted(ctx, turns, agent, active, principal('one'))
    insertTrusted(ctx, turns, agent, queued, principal('one'))
    ctx.emit('agent/inbox/claimed', { agent, message: active, turn: 10 })
    expect(turns.require(agent).turnId).toBe('turn-one')

    ctx.emit('agent/disposed', { agent })
    expect(() => turns.require(agent)).toThrow('authenticated active turn')
    await dispose()
  })
  it('matches the fixed model-visible schema snapshot', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    applyDataAidQueryTool(ctx, toolConfig)
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'data_query')
    expect(schema).toBeDefined()
    expect(`${JSON.stringify(schema, null, 2)}\n`).toBe(await readFile(toolSchemaSnapshot, 'utf8'))
    await ctx.fiber.dispose()
  })


})

describe('data_query semantic request', () => {
  it('maps tool arguments into the strict DIC-BE semantic protocol', () => {
    expect(buildRequest({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: ['team_code'],
      filters: [{ dimension: 'team_code', op: 'eq', value: '1001' }],
      timeRange: { dimension: 'sale_date', start: '2026-08-01', end: '2026-08-02' },
      orderBy: [{ field: 'revenue', direction: 'desc' }],
    }, toolConfig)).toEqual({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: ['team_code'],
      filters: [{ dimensionCode: 'team_code', operator: 'eq', value: ['1001'] }],
      timeRange: {
        dimensionCode: 'sale_date',
        startInclusive: '2026-08-01',
        endExclusive: '2026-08-02',
      },
      orderBy: [{ fieldCode: 'revenue', direction: 'desc' }],
      limit: 50,
    })
  })

  it('enforces closed roots, code uniqueness, arity, finite values, selected ordering, and configured limits', () => {
    const base = { datasetCode: 'sales_daily', metricCodes: ['order_count'] }
    expect(() => buildRequest({ ...base, extra: true } as never, toolConfig)).toThrow('undeclared field')
    expect(() => buildRequest({ ...base, metricCodes: ['order_count', 'order_count'] }, toolConfig)).toThrow('unique')
    expect(() => buildRequest({ ...base, filters: [{ dimension: 'team', op: 'between', value: [1] }] }, toolConfig)).toThrow('exactly two')
    expect(() => buildRequest({ ...base, filters: [{ dimension: 'team', op: 'eq', value: Number.POSITIVE_INFINITY }] }, toolConfig)).toThrow('finite')
    expect(() => buildRequest({ ...base, orderBy: [{ field: 'revenue', direction: 'desc' }] }, toolConfig)).toThrow('must be selected')
    expect(() => buildRequest({ ...base, limit: 101 }, toolConfig)).toThrow('1 to 100')
    expect(() => buildRequest({ ...base, filters: Array.from({ length: 5 }, () => ({ dimension: 'team', op: 'eq' as const, value: 1 })) }, toolConfig)).toThrow('maxFilters')
    expect(() => buildRequest({ ...base, filters: [{ dimension: 'team', op: 'in', value: [1, 2, 3, 4, 5] }] }, toolConfig)).toThrow('bounded')
  })
})

describe('data_query tool execution', () => {
  it('uses only the trusted business binding, exposes five safe fields, and denies after cleanup', async () => {
    const ctx = new Context()
    const principalFiber = ctx.plugin(TestPrincipalService)
    await principalFiber
    const turnFiber = ctx.plugin(DataAidTurnPrincipalService)
    await turnFiber
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(DataQueryRuntime, { provider: 'test' })
    const requests: DataQueryRequest[] = []
    const contexts: DataQueryContext[] = []
    const provider: DataQueryProvider = {
      id: 'test',
      available: () => true,
      async query(request, context) {
        requests.push(request)
        contexts.push(context)
        return {
          columns: ['team_code', 'order_count'],
          rows: [['team-one', 12]],
          rowCount: 1,
          complete: true,
          truncated: false,
        }
      },
    }
    ctx.dataQuery.registerProvider(provider)
    applyDataAidQueryTool(ctx, toolConfig)
    expect(ctx.tools.schemas()[0]?.parameters).toMatchObject({ additionalProperties: false })

    const agent = makeAgent('unrelated-dsh-session-id')
    const item = message('data-query-tool-message')
    const authenticated = principal('one')
    const principalService = ctx.get('authenticatedPrincipal')
    const turns = ctx.get('dataAidTurnPrincipal')
    if (principalService === undefined || turns === undefined) throw new Error('test services were not installed')
    insertTrusted(ctx, turns, agent, item, authenticated, ids('dic-conversation', 'dic-turn'))
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
      value: {
        columns: ['team_code', 'order_count'],
        rows: [['team-one', 12]],
        rowCount: 1,
        complete: true,
        truncated: false,
      },
    })
    expect(requests).toEqual([{
      datasetCode: 'sales_daily',
      metricCodes: ['order_count', 'revenue'],
      dimensionCodes: [],
      filters: [{ dimensionCode: 'team_code', operator: 'eq', value: ['1001'] }],
      limit: 50,
    }])
    expect(contexts).toEqual([{
      principalId: authenticated.gkUserId,
      conversationId: 'dic-conversation',
      turnId: 'dic-turn',
    }])

    const extra = await ctx.tools.execute({
      callId: CallId('data-query-extra'),
      name: 'data_query',
      arguments: { datasetCode: 'sales_daily', metricCodes: ['order_count'], sql: 'SELECT 1' },
      agent,
      signal,
    })
    expect(extra).toMatchObject({ isError: true })
    expect(requests).toHaveLength(1)

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
