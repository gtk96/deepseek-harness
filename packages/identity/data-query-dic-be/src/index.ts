/**
 * DIC-BE HTTP Provider for the controlled data-query capability.
 * @module @deepseek-ai/dsh-data-query-dic-be
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-data-query'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { DIC_BE_DATA_QUERY_PROVIDER_ID, DicBeDataQueryProvider } from './provider.ts'
import type { DicBeDataQueryProviderOptions } from './types.ts'

export {
  DIC_BE_DATA_QUERY_PROVIDER_ID,
  DicBeDataQueryProvider,
  readCappedText,
  resolveEndpoint,
  validateOptions,
  validateResponse,
} from './provider.ts'
export type { DicBeDataQueryProviderOptions } from './types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'data-query-dic-be'
/** Capability registry receiving this provider. */
export const inject = ['dataQuery']

/** Required DIC-BE assertion, deadline, and result-limit configuration. */
export interface Config extends Omit<DicBeDataQueryProviderOptions, 'baseURL'> {
  /** Explicit endpoint override; otherwise `DATA_AID_QUERY_BASE_URL` is read from the launch environment snapshot. */
  readonly baseURL?: string
}

/** Loader validation for the complete provider configuration. */
export const Config: z<Config> = z.object({
  baseURL: z.string(),
  path: z.string().required(),
  issuer: z.string().required(),
  audience: z.string().required(),
  assertionKeyRing: z.dict(z.string().role('secret')).required(),
  assertionActiveKid: z.string().required(),
  assertionTtlSeconds: z.number().step(1).min(1).max(60).required(),
  timeoutSeconds: z.number().step(1).min(1).max(30).required(),
  maxRows: z.number().step(1).min(1).max(100).required(),
  maxResultBytes: z.number().step(1).min(1).max(16_777_216).required(),
})

/** Register the validated DIC-BE provider with `ctx.dataQuery`. */
export function apply(ctx: Context, config: Config): void {
  const baseURL = config.baseURL
    ?? launchEnvironmentOf(ctx).get('DATA_AID_QUERY_BASE_URL')?.value
    ?? ''
  ctx.dataQuery.registerProvider(new DicBeDataQueryProvider({
    baseURL,
    path: config.path,
    issuer: config.issuer,
    audience: config.audience,
    assertionKeyRing: config.assertionKeyRing,
    assertionActiveKid: config.assertionActiveKid,
    assertionTtlSeconds: config.assertionTtlSeconds,
    timeoutSeconds: config.timeoutSeconds,
    maxRows: config.maxRows,
    maxResultBytes: config.maxResultBytes,
  }))
}

export { DIC_BE_DATA_QUERY_PROVIDER_ID as providerId }
