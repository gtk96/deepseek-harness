/**
 * Service Definition and provider runtime for controlled semantic data queries.
 * @module @deepseek-ai/dsh-data-query
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DATA_QUERY_DUPLICATE_PROVIDER,
  DATA_QUERY_PROVIDER_AMBIGUOUS,
  DATA_QUERY_PROVIDER_CONFIGURED_MISSING,
  DATA_QUERY_PROVIDER_CONFIGURED_UNAVAILABLE,
  DATA_QUERY_PROVIDER_UNAVAILABLE,
  DataQueryError,
} from './error.ts'
import type { DataQueryContext, DataQueryProvider, DataQueryRequest, DataQueryResult } from './types.ts'

export {
  DATA_QUERY_DUPLICATE_PROVIDER,
  DATA_QUERY_PROVIDER_AMBIGUOUS,
  DATA_QUERY_PROVIDER_CONFIGURED_MISSING,
  DATA_QUERY_PROVIDER_CONFIGURED_UNAVAILABLE,
  DATA_QUERY_PROVIDER_UNAVAILABLE,
  DataQueryError,
} from './error.ts'
export type {
  DataQueryContext,
  DataQueryConversationId,
  DataQueryFilter,
  DataQueryOrderBy,
  DataQueryProvider,
  DataQueryRequest,
  DataQueryResult,
  DataQueryTimeRange,
  DataQueryTurnId,
  DataQueryValue,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Controlled semantic-query runtime. */
    dataQuery: DataQueryRuntime
  }
}

/** Provider-selection config for the data-query runtime. */
export interface Config {
  /** Explicit provider id; omitted auto-selects only when exactly one available provider exists. */
  readonly provider?: string
}

/** Loader validation for provider selection. */
export const Config: z<Config> = z.object({
  provider: z.string(),
})

/**
 * Runtime that owns data-query provider registration, deterministic selection, and dispatch.
 *
 * A configured provider must be registered and available. Without a configured id, the runtime
 * selects exactly one available provider and rejects zero or multiple candidates. Resolution occurs
 * for every call so provider disposal and availability changes take effect without stale caching.
 */
export class DataQueryRuntime extends Service {
  static Config = Config

  private readonly providers = new Map<string, DataQueryProvider>()
  private readonly providerId: string | undefined

  /**
   * Register the runtime under `ctx.dataQuery`.
   * @param ctx - owning Cordis context.
   * @param config - optional explicit provider selection.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(validateConfigBeforeRegistration(ctx, config), 'dataQuery')
    this.providerId = config.provider
  }

  /**
   * Register one provider for the contributing fiber's lifetime.
   * @param provider - backend implementation with a unique normalized id.
   * @returns disposer that removes the provider; the contributing fiber also disposes it automatically.
   * @throws {@link DataQueryError} with `DATA_QUERY_DUPLICATE_PROVIDER` when the id already exists.
   */
  registerProvider(provider: DataQueryProvider): () => void {
    assertProviderId(provider.id, 'provider id')
    if (this.providers.has(provider.id)) {
      throw new DataQueryError(
        `a data-query provider with id "${provider.id}" is already registered`,
        DATA_QUERY_DUPLICATE_PROVIDER,
      )
    }
    const dispose = this.ctx.effect(function* (this: DataQueryRuntime) {
      this.providers.set(provider.id, provider)
      yield () => this.providers.delete(provider.id)
    }.bind(this), 'dataQuery.registerProvider()')
    return () => void dispose()
  }

  /**
   * Execute one semantic query through the provider resolved at call time.
   * @param request - semantic query fields, never trusted identity or transport data.
   * @param context - trusted Principal and turn binding obtained outside model JSON.
   * @param signal - optional cancellation signal forwarded unchanged.
   * @returns the provider's complete, untruncated five-field result.
   * @throws {@link DataQueryError} when provider selection is missing, unavailable, or ambiguous.
   */
  query(request: DataQueryRequest, context: DataQueryContext, signal?: AbortSignal): Promise<DataQueryResult> {
    return this.resolveProvider().query(request, context, signal)
  }

  /** Resolve the configured provider or the sole available provider. */
  private resolveProvider(): DataQueryProvider {
    if (this.providerId !== undefined) {
      const provider = this.providers.get(this.providerId)
      if (provider === undefined) {
        throw new DataQueryError(
          `configured data-query provider "${this.providerId}" is not registered`,
          DATA_QUERY_PROVIDER_CONFIGURED_MISSING,
        )
      }
      if (!provider.available()) {
        throw new DataQueryError(
          `configured data-query provider "${this.providerId}" is unavailable`,
          DATA_QUERY_PROVIDER_CONFIGURED_UNAVAILABLE,
        )
      }
      return provider
    }

    const available = [...this.providers.values()].filter(provider => provider.available())
    const [provider] = available
    if (provider === undefined) {
      throw new DataQueryError('no available data-query provider is registered', DATA_QUERY_PROVIDER_UNAVAILABLE)
    }
    if (available.length > 1) {
      const ids = available.map(candidate => candidate.id).sort().join(', ')
      throw new DataQueryError(
        `multiple available data-query providers are registered (${ids}); configure one explicitly`,
        DATA_QUERY_PROVIDER_AMBIGUOUS,
      )
    }
    return provider
  }
}

/** Validate config before the Service constructor can publish `ctx.dataQuery`. */
function validateConfigBeforeRegistration(ctx: Context, config: Config): Context {
  if (config.provider !== undefined) assertProviderId(config.provider, 'configured provider')
  return ctx
}

/** Reject ids whose spelling would make config matching ambiguous. */
function assertProviderId(id: string, subject: string): void {
  if (id.length === 0 || id !== id.trim()) {
    throw new TypeError(`data-query: ${subject} must be a non-empty normalized string`)
  }
}

export default DataQueryRuntime
