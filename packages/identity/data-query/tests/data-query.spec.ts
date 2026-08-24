import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DataQueryRuntime, { type DataQueryProvider, type DataQueryRequest } from '@deepseek-ai/dsh-data-query'
import { freezeAuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'

const request: DataQueryRequest = {
  datasetCode: 'sales',
  metricCodes: ['order_count'],
  dimensionCodes: ['team_code'],
  limit: 10,
  principal: freezeAuthenticatedPrincipal({
    ddUserId: 'dd-user' as AuthenticatedPrincipal['ddUserId'],
    gkUserId: 'gk-user' as AuthenticatedPrincipal['gkUserId'],
    gimpStaffId: 'staff-user' as AuthenticatedPrincipal['gimpStaffId'],
    dataRole: 'reader' as AuthenticatedPrincipal['dataRole'],
    teamCodes: [] as unknown as AuthenticatedPrincipal['teamCodes'],
    dataOrgCodes: [] as unknown as AuthenticatedPrincipal['dataOrgCodes'],
  }),
}

function provider(id: string, available = true): DataQueryProvider {
  return {
    id,
    available: () => available,
    query: () => Promise.resolve({ columns: ['value'], rows: [[1]] }),
  }
}

describe('DataQueryRuntime', () => {
  it('dispatches only to the explicitly selected provider and forwards cancellation', async () => {
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, { provider: 'selected' })
    const signal = new AbortController().signal
    const seen: unknown[] = []
    ctx.dataQuery.registerProvider(provider('other'))
    ctx.dataQuery.registerProvider({
      id: 'selected',
      available: () => true,
      query: (input, forwarded) => {
        seen.push(input, forwarded)
        return Promise.resolve({ columns: ['value'], rows: [[1]] })
      },
    })

    await expect(ctx.dataQuery.query(request, signal)).resolves.toEqual({ columns: ['value'], rows: [[1]] })
    expect(seen).toEqual([request, signal])
    await ctx.fiber.dispose()
  })

  it('fails for a missing, unavailable, duplicate, or invalid provider', async () => {
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, { provider: 'selected' })
    expect(() => ctx.dataQuery.query(request)).toThrow('not registered')
    ctx.dataQuery.registerProvider(provider('selected', false))
    expect(() => ctx.dataQuery.query(request)).toThrow('unavailable')
    expect(() => ctx.dataQuery.registerProvider(provider('selected'))).toThrow('already registered')
    expect(() => ctx.dataQuery.registerProvider(provider(''))).toThrow('non-empty normalized')
    await ctx.fiber.dispose()
  })

  it('removes a contributing provider when its fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(DataQueryRuntime, { provider: 'selected' })
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.dataQuery.registerProvider(provider('selected'))
    }, { inject: ['dataQuery'] }))
    await expect(ctx.dataQuery.query(request)).resolves.toMatchObject({ columns: ['value'] })
    await fiber.dispose()
    expect(() => ctx.dataQuery.query(request)).toThrow('not registered')
    await ctx.fiber.dispose()
  })
})
