/**
 * Request-local authenticated Principal Service Definition and process-local
 * scope. Providers authenticate a transport request; Consumers read the
 * resolved data-aid account and permission facts from `ctx.authenticatedPrincipal`.
 *
 * @module @deepseek-ai/dsh-authenticated-principal
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { isPromise } from 'node:util/types'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AuthenticatedPrincipal,
  PrincipalAuthenticator,
} from './types.ts'

export type {
  AuthenticatedPrincipal,
  AuthenticatedPrincipalScope,
  DataAidClientId,
  DataOrgCode,
  DataRole,
  DdUserId,
  GimpStaffId,
  GkUserId,
  PrincipalAuthenticator,
  TeamCode,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Request-local authenticated account and authorization facts. */
    authenticatedPrincipal: AuthenticatedPrincipalService
  }
}

/** Constructor options for an internal authentication failure. */
export interface PrincipalAuthenticationErrorOptions {
  /** Provider failure retained for server-side diagnostics only. */
  readonly cause?: unknown
}

/** Stable failure raised when a transport request cannot become a Principal. */
export class PrincipalAuthenticationError extends Error {
  /**
   * Construct an authentication failure without exposing identity or header values.
   * @param options - optional internal cause retained by the Error object.
   */
  constructor(options: PrincipalAuthenticationErrorOptions = {}) {
    super('authentication failed', options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'PrincipalAuthenticationError'
  }
}

/**
 * Make a resolved Principal and its permission arrays shallowly immutable.
 * @param principal - resolved identity and authorization facts.
 * @returns an immutable Principal copy with immutable permission arrays.
 */
export function freezeAuthenticatedPrincipal(principal: AuthenticatedPrincipal): AuthenticatedPrincipal {
  const teamCodes = Object.freeze([...principal.teamCodes])
  const dataOrgCodes = Object.freeze([...principal.dataOrgCodes])
  const authorizedScope = principal.authorizedScope === undefined
    ? undefined
    : Object.freeze({ ...principal.authorizedScope })
  return Object.freeze({
    ddUserId: principal.ddUserId,
    ...(principal.clientId === undefined ? {} : { clientId: principal.clientId }),
    gkUserId: principal.gkUserId,
    gimpStaffId: principal.gimpStaffId,
    dataRole: principal.dataRole,
    teamCodes,
    dataOrgCodes,
    ...(authorizedScope === undefined ? {} : { authorizedScope }),
  })
}

interface PrincipalScopeRun {
  active: boolean
  readonly parent: PrincipalScopeRun | undefined
}

const NO_PRINCIPAL_MESSAGE = 'no authenticated principal is active'
const DISPOSED_SCOPE_MESSAGE = 'authenticated principal scope is disposed'

/**
 * Service Definition and lifecycle owner for authenticated Principal providers.
 * The provider subclass implements {@link authenticate}; this base class owns
 * only request-local scope and never stores a Principal in a session or Agent.
 */
export abstract class AuthenticatedPrincipalService extends Service implements PrincipalAuthenticator {
  private readonly principals = new AsyncLocalStorage<AuthenticatedPrincipal | undefined>()
  private readonly scopeRuns = new AsyncLocalStorage<PrincipalScopeRun>()
  private scopeState: 'active' | 'closing' | 'disposed' = 'active'
  private activeScopes = 0
  private scopeDrain: PromiseWithResolvers<void> | undefined
  private scopeDisposal: Promise<void> | undefined

  constructor(ctx: Context) {
    super(ctx, 'authenticatedPrincipal')
    ctx.effect(
      () => () => this.disposeScopes(),
      'authenticated-principal: scope lifecycle',
    )
  }

  /**
   * Authenticate one transport request into a complete Principal.
   * @param request - standard Fetch request supplied by the transport adapter.
   * @param signal - request cancellation signal.
   * @returns the authenticated Principal.
   */
  abstract authenticate(request: Request, signal: AbortSignal): Promise<AuthenticatedPrincipal>

  /**
   * Read the Principal inherited by the current asynchronous operation.
   * @returns the current Principal, or `undefined` outside an authenticated scope.
   * @throws after this service has been disposed.
   */
  current(): AuthenticatedPrincipal | undefined {
    this.assertReadable()
    const run = this.scopeRuns.getStore()
    return run?.active === true ? this.principals.getStore() : undefined
  }

  /**
   * Read the current Principal and fail when the operation is unauthenticated.
   * @returns the current authenticated Principal.
   * @throws when no Principal is active or this service has been disposed.
   */
  require(): AuthenticatedPrincipal {
    const principal = this.current()
    if (principal === undefined) throw new Error(NO_PRINCIPAL_MESSAGE)
    return principal
  }

  /**
   * Run an operation with one exact request-local Principal.
   * @param principal - Principal to inherit; `undefined` explicitly clears an inherited scope.
   * @param operation - synchronous or asynchronous operation to invoke.
   * @returns the exact value or Promise returned by `operation`.
   * @throws when this service is closing/disposed or when `operation` throws.
   */
  withPrincipal<T>(principal: AuthenticatedPrincipal | undefined, operation: () => T): T {
    if (this.scopeState !== 'active') throw new Error(DISPOSED_SCOPE_MESSAGE)
    const run: PrincipalScopeRun = {
      active: true,
      parent: this.scopeRuns.getStore(),
    }
    this.activeScopes += 1
    let result: T
    try {
      result = this.scopeRuns.run(run, () => this.principals.run(principal, operation))
    } catch (error: unknown) {
      this.releaseScope(run)
      throw error
    }
    if (isPromise(result)) {
      try {
        void Promise.prototype.then.call(
          result,
          () => { this.releaseScope(run) },
          () => { this.releaseScope(run) },
        )
      } catch {
        // A custom Promise species can reject observer setup; the operation's
        // exact return value still wins, so release the bookkeeping directly.
        this.releaseScope(run)
      }
    } else {
      this.releaseScope(run)
    }
    return result
  }

  /**
   * Run an operation without inheriting an ambient Principal.
   * @param operation - synchronous or asynchronous operation to invoke.
   * @returns the exact value or Promise returned by `operation`.
   */
  withoutPrincipal<T>(operation: () => T): T {
    return this.withPrincipal(undefined, operation)
  }

  /** Close new scopes, drain returned operations, and disable the ALS stores. */
  private disposeScopes(): Promise<void> {
    if (this.scopeDisposal !== undefined) return this.scopeDisposal
    this.scopeDisposal = (async () => {
      this.scopeState = 'closing'
      this.releaseReentrantScopes()
      if (this.activeScopes !== 0) {
        this.scopeDrain ??= Promise.withResolvers<void>()
        await this.scopeDrain.promise
      }
      this.scopeState = 'disposed'
      this.principals.disable()
      this.scopeRuns.disable()
    })()
    return this.scopeDisposal
  }

  /** Release the current nested scope chain when teardown starts inside it. */
  private releaseReentrantScopes(): void {
    let run = this.scopeRuns.getStore()
    while (run !== undefined) {
      this.releaseScope(run)
      run = run.parent
    }
  }

  /** Complete one tracked returned operation and resolve teardown when empty. */
  private releaseScope(run: PrincipalScopeRun): void {
    if (!run.active) return
    run.active = false
    this.activeScopes -= 1
    if (this.activeScopes !== 0) return
    this.scopeDrain?.resolve()
    this.scopeDrain = undefined
  }

  /** Keep retained service references readable while an active scope drains. */
  private assertReadable(): void {
    if (this.scopeState === 'disposed') throw new Error(DISPOSED_SCOPE_MESSAGE)
  }
}

export default AuthenticatedPrincipalService
