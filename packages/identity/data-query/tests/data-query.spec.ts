import { Context } from '@deepseek-ai/cordis'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import DataQueryRuntime, {
  DATA_QUERY_DUPLICATE_PROVIDER,
  DATA_QUERY_PROVIDER_AMBIGUOUS,
  DATA_QUERY_PROVIDER_CONFIGURED_MISSING,
  DATA_QUERY_PROVIDER_CONFIGURED_UNAVAILABLE,
  DATA_QUERY_PROVIDER_UNAVAILABLE,
  DataQueryError,
  type DataQueryContext,
  type DataQueryConversationId,
  type DataQueryProvider,
  type DataQueryRequest,
  type DataQueryResult,
  type DataQueryTurnId,
} from '@deepseek-ai/dsh-data-query'
import type { GkUserId } from '@deepseek-ai/dsh-authenticated-principal'

const request: DataQueryRequest = {
  datasetCode: 'order_summary',
  metricCodes: ['pay_amount'],
  dimensionCodes: ['family_name'],
  filters: [{ dimensionCode: 'country_code', operator: 'in', value: ['US', 'CA'] }],
  timeRange: {
    dimensionCode: 'pay_date',
    startInclusive: '2026-08-14',
    endExclusive: '2026-08-21',
  },
  orderBy: [{ fieldCode: 'pay_amount', direction: 'desc' }],
  limit: 100,
}

const callContext: DataQueryContext = {
  principalId: 'gk-user' as GkUserId,
  conversationId: 'conversation-1' as DataQueryConversationId,
  turnId: 'turn-1' as DataQueryTurnId,
}

const result: DataQueryResult = {
  columns: ['family_name', 'pay_amount'],
  rows: [['A', 1200.5]],
  rowCount: 1,
  complete: true,
  truncated: false,
}


// These assignments are compiled by tsconfig.host.json; each directive must suppress a real error.
// @ts-expect-error -- roles are resolved by the backend, never supplied in semantic requests.
void ({ ...request, roles: ['reader'] } satisfies DataQueryRequest)
// @ts-expect-error -- authorization scope is trusted backend state.
void ({ ...request, scope: { team: 'one' } } satisfies DataQueryRequest)
// @ts-expect-error -- physical projects are absent from the semantic request.
void ({ ...request, project: 'warehouse' } satisfies DataQueryRequest)
// @ts-expect-error -- physical tables are absent from the semantic request.
void ({ ...request, table: 'orders' } satisfies DataQueryRequest)
// @ts-expect-error -- physical fields are absent from the semantic request.
void ({ ...request, physicalField: 'pay_amount' } satisfies DataQueryRequest)
// @ts-expect-error -- service endpoints are provider configuration.
void ({ ...request, endpoint: 'https://query.invalid' } satisfies DataQueryRequest)
// @ts-expect-error -- base URLs are provider configuration.
void ({ ...request, baseURL: 'https://query.invalid' } satisfies DataQueryRequest)
// @ts-expect-error -- execution timeouts are deployment configuration.
void ({ ...request, timeout: 30 } satisfies DataQueryRequest)
// @ts-expect-error -- credentials never enter semantic requests.
void ({ ...request, credential: 'secret' } satisfies DataQueryRequest)
// @ts-expect-error -- provider selection belongs to DataQueryRuntime configuration.
void ({ ...request, provider: 'dic-be' } satisfies DataQueryRequest)

// @ts-expect-error -- conversation and turn identifiers have distinct opaque brands.
const turnFromConversation: DataQueryTurnId = callContext.conversationId
// @ts-expect-error -- conversation and turn identifiers have distinct opaque brands.
const conversationFromTurn: DataQueryConversationId = callContext.turnId
void turnFromConversation
void conversationFromTurn

function provider(id: string, available = true): DataQueryProvider {
  return {
    id,
    available: () => available,
    query: () => Promise.resolve(result),
  }
}

function expectDataQueryError(run: () => unknown, code: string): void {
  try {
    run()
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DataQueryError)
    expect((error as DataQueryError).code).toBe(code)
    return
  }
  throw new Error(`expected DataQueryError ${code}`)
}

describe('DataQueryRuntime', () => {
  it('keeps trusted and transport fields outside the semantic request and safe result', () => {
    expectTypeOf<DataQueryRequest>().not.toHaveProperty('principal')
    expectTypeOf<DataQueryRequest>().not.toHaveProperty('conversationId')
    expectTypeOf<DataQueryRequest>().not.toHaveProperty('turnId')
    expectTypeOf<DataQueryRequest>().not.toHaveProperty('assertion')
    expectTypeOf<DataQueryRequest>().not.toHaveProperty('sql')
    expectTypeOf<DataQueryRequest>().not.toHaveProperty('jobId')
    expectTypeOf<DataQueryContext>().toHaveProperty('principalId')
    expectTypeOf<DataQueryContext>().toHaveProperty('conversationId')
    expectTypeOf<DataQueryContext>().toHaveProperty('turnId')
    expectTypeOf<DataQueryResult>().toHaveProperty('columns')
    expectTypeOf<DataQueryResult>().toHaveProperty('rows')
    expectTypeOf<DataQueryResult>().toHaveProperty('rowCount')
    expectTypeOf<DataQueryResult>().toHaveProperty('complete')
    expectTypeOf<DataQueryResult>().toHaveProperty('truncated')
    expectTypeOf<DataQueryResult>().not.toHaveProperty('sql')
    expectTypeOf<DataQueryResult>().not.toHaveProperty('jobId')
  })

  it('dispatches to an explicitly selected available provider and forwards trusted context and cancellation', async () => {
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, { provider: 'selected' })
    const signal = new AbortController().signal
    const query = vi.fn<DataQueryProvider['query']>().mockResolvedValue(result)
    ctx.dataQuery.registerProvider(provider('other'))
    ctx.dataQuery.registerProvider({ id: 'selected', available: () => true, query })

    await expect(ctx.dataQuery.query(request, callContext, signal)).resolves.toEqual(result)
    expect(query).toHaveBeenCalledWith(request, callContext, signal)
    expect(Object.keys(request).sort()).toEqual([
      'datasetCode',
      'dimensionCodes',
      'filters',
      'limit',
      'metricCodes',
      'orderBy',
      'timeRange',
    ])
    expect(Object.keys(result).sort()).toEqual(['columns', 'complete', 'rowCount', 'rows', 'truncated'])
    await ctx.fiber.dispose()
  })

  it('auto-selects the sole available provider without depending on registration order', async () => {
    for (const providers of [
      [provider('unavailable', false), provider('available')],
      [provider('available'), provider('unavailable', false)],
    ]) {
      const ctx = new Context()
      await ctx.plugin(DataQueryRuntime, {})
      const query = vi.fn<DataQueryProvider['query']>().mockResolvedValue(result)
      for (const candidate of providers) {
        ctx.dataQuery.registerProvider(candidate.id === 'available' ? { ...candidate, query } : candidate)
      }

      await expect(ctx.dataQuery.query(request, callContext)).resolves.toEqual(result)
      expect(query).toHaveBeenCalledOnce()
      await ctx.fiber.dispose()
    }
  })

  it('reports configured missing and configured unavailable providers with stable codes', async () => {
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, { provider: 'selected' })

    expectDataQueryError(
      () => ctx.dataQuery.query(request, callContext),
      DATA_QUERY_PROVIDER_CONFIGURED_MISSING,
    )
    ctx.dataQuery.registerProvider(provider('selected', false))
    expectDataQueryError(
      () => ctx.dataQuery.query(request, callContext),
      DATA_QUERY_PROVIDER_CONFIGURED_UNAVAILABLE,
    )
    await ctx.fiber.dispose()
  })

  it('reports zero and multiple available auto-selection candidates with stable codes', async () => {
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, {})
    ctx.dataQuery.registerProvider(provider('disabled', false))
    expectDataQueryError(() => ctx.dataQuery.query(request, callContext), DATA_QUERY_PROVIDER_UNAVAILABLE)

    ctx.dataQuery.registerProvider(provider('z-provider'))
    ctx.dataQuery.registerProvider(provider('a-provider'))
    try {
      void ctx.dataQuery.query(request, callContext)
      throw new Error('expected ambiguous provider selection to fail')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(DataQueryError)
      expect((error as DataQueryError).code).toBe(DATA_QUERY_PROVIDER_AMBIGUOUS)
      expect((error as Error).message).toContain('a-provider, z-provider')
    }
    await ctx.fiber.dispose()
  })

  it('rejects duplicate and non-normalized provider ids', async () => {
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, {})
    ctx.dataQuery.registerProvider(provider('primary'))
    expectDataQueryError(() => ctx.dataQuery.registerProvider(provider('primary')), DATA_QUERY_DUPLICATE_PROVIDER)
    expect(() => ctx.dataQuery.registerProvider(provider(''))).toThrow(TypeError)
    expect(() => ctx.dataQuery.registerProvider(provider(' padded '))).toThrow('non-empty normalized')
    await ctx.fiber.dispose()
  })

  it('removes a provider through the returned disposer', async () => {
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, {})
    const dispose = ctx.dataQuery.registerProvider(provider('only'))
    await expect(ctx.dataQuery.query(request, callContext)).resolves.toEqual(result)

    dispose()
    expectDataQueryError(() => ctx.dataQuery.query(request, callContext), DATA_QUERY_PROVIDER_UNAVAILABLE)
    await ctx.fiber.dispose()
  })

  it('removes a contribution when its plugin fiber is hot-reloaded', async () => {
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, {})
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.dataQuery.registerProvider(provider('hmr-provider'))
    }, { inject: ['dataQuery'] }))
    await expect(ctx.dataQuery.query(request, callContext)).resolves.toEqual(result)

    await fiber.dispose()
    expectDataQueryError(() => ctx.dataQuery.query(request, callContext), DATA_QUERY_PROVIDER_UNAVAILABLE)
    await ctx.fiber.dispose()
  })

  it('rejects invalid explicit provider config at service construction', () => {
    const ctx = new Context()
    expect(() => new DataQueryRuntime(ctx, { provider: '' })).toThrow('non-empty normalized')
    expect(() => new DataQueryRuntime(ctx, { provider: ' padded ' })).toThrow('non-empty normalized')
  })
})
