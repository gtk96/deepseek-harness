import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  AuthenticatedPrincipalService,
  PrincipalAuthenticationError,
  freezeAuthenticatedPrincipal,
  type AuthenticatedPrincipal,
} from '../src/index.ts'

class FixturePrincipalService extends AuthenticatedPrincipalService {
  override authenticate(request: Request, signal: AbortSignal): Promise<AuthenticatedPrincipal> {
    void request
    void signal
    return Promise.resolve(principal('authenticated'))
  }
}

function principal(userId: string): AuthenticatedPrincipal {
  return {
    ddUserId: userId as AuthenticatedPrincipal['ddUserId'],
    ...{ clientId: `client:${userId}` as NonNullable<AuthenticatedPrincipal['clientId']> },
    gkUserId: `gk:${userId}` as AuthenticatedPrincipal['gkUserId'],
    gimpStaffId: `staff:${userId}` as AuthenticatedPrincipal['gimpStaffId'],
    dataRole: 'query' as AuthenticatedPrincipal['dataRole'],
    teamCodes: [`team:${userId}`] as unknown as AuthenticatedPrincipal['teamCodes'],
    dataOrgCodes: [`org:${userId}`] as unknown as AuthenticatedPrincipal['dataOrgCodes'],
    authorizedScope: { source: 'fixture', userId },
  }
}

async function mounted(): Promise<{
  readonly ctx: Context
  readonly service: FixturePrincipalService
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin(FixturePrincipalService)
  await fiber
  const service = ctx.get('authenticatedPrincipal')
  if (service === undefined) throw new Error('fixture Principal service was not installed')
  return {
    ctx,
    service,
    dispose: () => fiber.dispose(),
  }
}

describe('AuthenticatedPrincipalService', () => {
  it('freezes the Principal record, permission arrays, and optional scope', () => {
    const value = freezeAuthenticatedPrincipal(principal('alice'))
    expect(value).toMatchObject({
      ddUserId: 'alice',
      clientId: 'client:alice',
      gkUserId: 'gk:alice',
      gimpStaffId: 'staff:alice',
      dataRole: 'query',
      teamCodes: ['team:alice'],
      dataOrgCodes: ['org:alice'],
      authorizedScope: { source: 'fixture', userId: 'alice' },
    })
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.teamCodes)).toBe(true)
    expect(Object.isFrozen(value.dataOrgCodes)).toBe(true)
    expect(Object.isFrozen(value.authorizedScope)).toBe(true)

    const withoutOptionalFields = freezeAuthenticatedPrincipal({
      ...principal('bob'),
      clientId: undefined,
      authorizedScope: undefined,
    } as unknown as AuthenticatedPrincipal)
    expect(withoutOptionalFields).not.toHaveProperty('clientId')
    expect(withoutOptionalFields).not.toHaveProperty('authorizedScope')
  })

  it('reads and clears nested request-local scopes without persistence', async () => {
    const { service, dispose } = await mounted()
    const first = principal('first')
    const second = principal('second')
    expect(service.current()).toBeUndefined()
    expect(() => service.require()).toThrow('no authenticated principal is active')

    await service.withPrincipal(first, async () => {
      expect(service.current()).toBe(first)
      await service.withPrincipal(second, async () => {
        expect(service.require()).toBe(second)
        await Promise.resolve()
        expect(service.current()).toBe(second)
      })
      expect(service.current()).toBe(first)
      service.withoutPrincipal(() => {
        expect(service.current()).toBeUndefined()
        expect(() => service.require()).toThrow('no authenticated principal is active')
      })
      expect(service.current()).toBe(first)
    })
    expect(service.current()).toBeUndefined()
    await dispose()
  })

  it('does not expose a Principal to detached work after its scope settles', async () => {
    const { service, dispose } = await mounted()
    let detached!: Promise<AuthenticatedPrincipal | undefined>
    const current = principal('detached')

    service.withPrincipal(current, () => {
      detached = new Promise((resolve) => {
        queueMicrotask(() => { resolve(service.current()) })
      })
    })

    await expect(detached).resolves.toBeUndefined()
    await dispose()
  })

  it('releases synchronous failures and handles a rejected Promise observer species', async () => {
    const { service, dispose } = await mounted()
    const failure = new Error('synchronous fixture failure')
    expect(() => service.withPrincipal(principal('throws'), () => { throw failure })).toThrow(failure)

    let useValidSpecies = false
    class BrokenSpeciesPromise<T> extends Promise<T> {
      static override get [Symbol.species](): PromiseConstructor {
        return useValidSpecies ? Promise : {} as unknown as PromiseConstructor
      }
    }
    const current = principal('species')
    const returned = service.withPrincipal(current, () => new BrokenSpeciesPromise((resolve) => { resolve(current) }))
    useValidSpecies = true
    await expect(returned).resolves.toBe(current)
    await dispose()
  })

  it('isolates concurrent asynchronous operations and keeps returned values exact', async () => {
    const { service, dispose } = await mounted()
    const first = principal('first')
    const second = principal('second')
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })

    const firstRun = service.withPrincipal(first, async () => {
      await gate
      return service.require()
    })
    const secondRun = service.withPrincipal(second, async () => {
      await gate
      return service.require()
    })
    release()

    expect(await firstRun).toBe(first)
    expect(await secondRun).toBe(second)

    const marker = {}
    expect(service.withPrincipal(first, () => marker)).toBe(marker)
    await dispose()
  })

  it('waits for a returned Promise before disabling its scope', async () => {
    const { service } = await mounted()
    const current = principal('draining')
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let completed = false
    const operation = service.withPrincipal(current, async () => {
      await gate
      expect(service.require()).toBe(current)
      completed = true
    })
    const disposeScopes = (service as unknown as { disposeScopes: () => Promise<void> }).disposeScopes.bind(service)
    const disposal = disposeScopes()
    const repeatedDisposal = disposeScopes()
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(() => { service.withPrincipal(current, () => undefined) }).toThrow('scope is disposed')

    release()
    await operation
    await disposal
    await repeatedDisposal
    expect(completed).toBe(true)
    expect(() => service.current()).toThrow('scope is disposed')
    expect(() => { service.withoutPrincipal(() => undefined) }).toThrow('scope is disposed')
  })

  it('releases active scopes when disposal starts inside the operation', async () => {
    const { service, dispose } = await mounted()
    let disposal!: Promise<void>
    service.withPrincipal(principal('reentrant'), () => {
      disposal = dispose()
    })
    await disposal
    expect(() => service.current()).toThrow('scope is disposed')
  })

  it('drains rejected returned Promises and preserves authentication error identity', async () => {
    const { service, dispose } = await mounted()
    const failure = new Error('fixture failure')
    const operation = service.withPrincipal(principal('rejecting'), async () => {
      await Promise.resolve()
      throw failure
    })
    await expect(operation).rejects.toBe(failure)
    await dispose()

    const authFailure = new PrincipalAuthenticationError({ cause: failure })
    expect(authFailure).toMatchObject({ name: 'PrincipalAuthenticationError', message: 'authentication failed' })
    const genericFailure = new PrincipalAuthenticationError()
    expect(genericFailure.cause).toBeUndefined()
  })
})
