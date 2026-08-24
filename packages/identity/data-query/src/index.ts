/**
 * Provider-registry Service Definition for controlled semantic data queries.
 * @module @deepseek-ai/dsh-data-query
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { DataQueryProvider, DataQueryRequest, DataQueryResult } from './types.ts'

export type {
  DataQueryFilter,
  DataQueryOrderBy,
  DataQueryProvider,
  DataQueryRequest,
  DataQueryResult,
  DataQueryTimeRange,
  DataQueryValue,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Controlled semantic-query runtime. */
    dataQuery: DataQueryRuntime
  }
}

/** Explicit provider selection for the data-query runtime. */
export interface Config {
  /** Registered provider id used for every query. */
  readonly provider: string
}

/** Loader validation for explicit provider selection. */
export const Config: z<Config> = z.object({
  provider: z.string().required(),
})

/** Runtime that owns provider registration, selection, and dispatch. */
export class DataQueryRuntime extends Service {
  static Config = Config

  private readonly providers = new Map<string, DataQueryProvider>()
  private readonly providerId: string

  /**
   * Register the runtime under `ctx.dataQuery`.
   * @param ctx - owning Cordis context.
   * @param config - explicit provider selection.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'dataQuery')
    if (config.provider.length === 0 || config.provider !== config.provider.trim()) {
      throw new TypeError('data-query: provider must be a non-empty normalized string')
    }
    this.providerId = config.provider
  }

  /**
   * Register one provider for the contributing fiber's lifetime.
   * @param provider - backend implementation with a unique non-empty id.
   * @returns disposer that removes the provider.
   */
  registerProvider(provider: DataQueryProvider): () => void {
    if (provider.id.length === 0 || provider.id !== provider.id.trim()) {
      throw new TypeError('data-query: provider id must be a non-empty normalized string')
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`data-query: provider "${provider.id}" is already registered`)
    }
    const dispose = this.ctx.effect(function* (this: DataQueryRuntime) {
      this.providers.set(provider.id, provider)
      yield () => this.providers.delete(provider.id)
    }.bind(this), 'dataQuery.registerProvider()')
    return () => void dispose()
  }

  /**
   * Execute through the explicitly selected available provider.
   * @param request - host-owned semantic query and Principal.
   * @param signal - optional cancellation signal forwarded unchanged.
   * @returns complete normalized provider result.
   */
  query(request: DataQueryRequest, signal?: AbortSignal): Promise<DataQueryResult> {
    const provider = this.providers.get(this.providerId)
    if (provider === undefined) {
      throw new Error(`data-query: configured provider "${this.providerId}" is not registered`)
    }
    if (!provider.available()) {
      throw new Error(`data-query: configured provider "${this.providerId}" is unavailable`)
    }
    return provider.query(request, signal)
  }
}

export default DataQueryRuntime
