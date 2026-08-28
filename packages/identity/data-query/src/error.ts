/** Provider-neutral errors raised by the controlled data-query runtime. */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** A provider id was registered more than once in one runtime. */
export const DATA_QUERY_DUPLICATE_PROVIDER = 'DATA_QUERY_DUPLICATE_PROVIDER'
/** The explicitly configured provider is not registered. */
export const DATA_QUERY_PROVIDER_CONFIGURED_MISSING = 'DATA_QUERY_PROVIDER_CONFIGURED_MISSING'
/** The explicitly configured provider is registered but locally unavailable. */
export const DATA_QUERY_PROVIDER_CONFIGURED_UNAVAILABLE = 'DATA_QUERY_PROVIDER_CONFIGURED_UNAVAILABLE'
/** No provider was configured and no registered provider is locally available. */
export const DATA_QUERY_PROVIDER_UNAVAILABLE = 'DATA_QUERY_PROVIDER_UNAVAILABLE'
/** No provider was configured and more than one registered provider is locally available. */
export const DATA_QUERY_PROVIDER_AMBIGUOUS = 'DATA_QUERY_PROVIDER_AMBIGUOUS'

/**
 * Typed data-query failure with a stable machine-routable code and optional cause.
 *
 * Runtime selection uses the exported provider-neutral codes. Service Providers may use additional
 * codes for their own transport and Query Broker failures, so Consumers must tolerate unknown codes.
 */
export class DataQueryError extends HarnessError {}
