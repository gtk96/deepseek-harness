/**
 * DIC-BE HTTP Provider for the controlled data-query capability.
 * @module @deepseek-ai/dsh-data-query-dic-be
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-data-query'
import { DIC_BE_DATA_QUERY_PROVIDER_ID, DicBeDataQueryProvider } from './provider.ts'
import type { DicBeDataQueryProviderOptions } from './types.ts'

export { DIC_BE_DATA_QUERY_PROVIDER_ID, DicBeDataQueryProvider } from './provider.ts'
export type { DicBeDataQueryProviderOptions } from './types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'data-query-dic-be'
/** Capability registry receiving this provider. */
export const inject = ['dataQuery']

/** Required DIC-BE endpoint, assertion, deadline, and result-limit configuration. */
export interface Config extends DicBeDataQueryProviderOptions {}

/** Loader validation for the complete provider configuration. */
export const Config: z<Config> = z.object({
  baseURL: z.string().required(),
  path: z.string().required(),
  issuer: z.string().required(),
  audience: z.string().required(),
  assertionSecret: z.string().role('secret').required(),
  assertionTtlSeconds: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  timeoutSeconds: z.number().step(1).min(1).max(2_147_483).required(),
  maxRows: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxResultChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

/** Register the DIC-BE provider with `ctx.dataQuery`. */
export function apply(ctx: Context, config: Config): void {
  assertNonEmpty('issuer', config.issuer)
  assertNonEmpty('audience', config.audience)
  assertNonEmpty('assertionSecret', config.assertionSecret)
  ctx.dataQuery.registerProvider(new DicBeDataQueryProvider(config))
}

/** Reject empty security configuration at plugin load. */
function assertNonEmpty(name: string, value: string): void {
  if (value.length === 0) throw new TypeError(`data-query-dic-be: ${name} must not be empty`)
}

export { DIC_BE_DATA_QUERY_PROVIDER_ID as providerId }
