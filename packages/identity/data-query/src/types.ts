/** Public types for controlled semantic data queries. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { GkUserId } from '@deepseek-ai/dsh-authenticated-principal'

/** Opaque conversation identifier bound by the trusted turn host. */
export type DataQueryConversationId = Branded<'DataQueryConversationId'>
/** Opaque turn identifier bound by the trusted turn host. */
export type DataQueryTurnId = Branded<'DataQueryTurnId'>

/** A JSON value returned in one query result cell or supplied as a semantic filter operand. */
export type DataQueryValue = null | boolean | number | string | readonly DataQueryValue[] | { readonly [key: string]: DataQueryValue }

/** One semantic filter on a governed dimension; the provider validates operator arity and value types. */
export interface DataQueryFilter {
  /** Governed dimension code. */
  readonly dimensionCode: string
  /** Allowed semantic comparison operation. */
  readonly operator: 'eq' | 'in' | 'between' | 'gte' | 'lte'
  /** Operand: one value for `eq`/`gte`/`lte`, a non-empty list for `in`, or two values for `between`. */
  readonly value: DataQueryValue | readonly DataQueryValue[]
}

/** Inclusive start and exclusive end on one governed date or time dimension. */
export interface DataQueryTimeRange {
  /** Governed date or time dimension code. */
  readonly dimensionCode: string
  /** Inclusive lower bound in the governed dimension's accepted representation. */
  readonly startInclusive: string
  /** Exclusive upper bound in the governed dimension's accepted representation. */
  readonly endExclusive: string
}

/** Sort specification for one selected metric or dimension. */
export interface DataQueryOrderBy {
  /** Already-selected metric or dimension code. */
  readonly fieldCode: string
  /** Sort direction. */
  readonly direction: 'asc' | 'desc'
}

/**
 * Semantic query submitted by a Consumer.
 *
 * The request deliberately excludes Principal facts, conversation/turn ids, assertions, SQL,
 * physical identifiers, service addresses, credentials, and execution controls. A model-facing
 * Consumer may project only these fields into its tool schema.
 */
export interface DataQueryRequest {
  /** Dataset selected from the server-owned semantic catalog. */
  readonly datasetCode: string
  /** One or more governed metrics requested from that dataset. */
  readonly metricCodes: readonly string[]
  /** Governed dimensions requested from that dataset; an empty list means no grouping. */
  readonly dimensionCodes: readonly string[]
  /** Semantic filters combined with server-owned authorization filters. */
  readonly filters?: readonly DataQueryFilter[]
  /** Inclusive/exclusive bound on one governed date or time dimension. */
  readonly timeRange?: DataQueryTimeRange
  /** Sorts restricted to selected metrics or dimensions. */
  readonly orderBy?: readonly DataQueryOrderBy[]
  /** Requested row count, subject to deployment and dataset ceilings. */
  readonly limit: number
}

/**
 * Trusted host context for one provider call.
 *
 * A Consumer obtains these values from authenticated turn state and passes them separately from
 * {@link DataQueryRequest}; model JSON must never supply or override them. Providers may derive a
 * transport assertion from this context, but assertions never enter the request or result types.
 */
export interface DataQueryContext {
  /** Stable authenticated user id used as the Query Broker assertion subject. */
  readonly principalId: GkUserId
  /** Opaque conversation id bound to the authenticated turn. */
  readonly conversationId: DataQueryConversationId
  /** Opaque turn id bound to the authenticated turn. */
  readonly turnId: DataQueryTurnId
}

/**
 * Complete safe result returned by a provider.
 *
 * Successful providers return exactly these five protocol fields. `complete` and `truncated` are
 * literal guarantees; SQL, physical mappings, credentials, assertions, job ids, and diagnostics
 * are not part of this result.
 */
export interface DataQueryResult {
  /** Column names in row order. */
  readonly columns: readonly string[]
  /** Complete rectangular rows. */
  readonly rows: readonly (readonly DataQueryValue[])[]
  /** Number of rows, equal to `rows.length`. */
  readonly rowCount: number
  /** Confirms that the backend read and validated the complete result. */
  readonly complete: true
  /** Confirms that no rows were silently dropped. */
  readonly truncated: false
}

/** One controlled-query backend registered with {@link DataQueryRuntime}. */
export interface DataQueryProvider {
  /** Stable registry id selected by runtime configuration or sole-provider auto-selection. */
  readonly id: string
  /** Cheap local availability check that makes no network request. */
  available(): boolean
  /**
   * Execute one semantic request for trusted turn context and honor cancellation for the complete operation.
   * @param request - semantic fields only.
   * @param context - trusted Principal and turn binding supplied outside model JSON.
   * @param signal - optional cancellation signal.
   * @returns a complete, untruncated five-field result.
   */
  query(request: DataQueryRequest, context: DataQueryContext, signal?: AbortSignal): Promise<DataQueryResult>
}
