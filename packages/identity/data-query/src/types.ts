/** Public vocabulary for controlled semantic data queries. */

import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'

/** A JSON value returned in one query result cell. */
export type DataQueryValue = null | boolean | number | string | readonly DataQueryValue[] | { readonly [key: string]: DataQueryValue }

/** One semantic filter on an authorized dimension, value shape validated by the provider. */
export interface DataQueryFilter {
  /** Governed dimension the filter constrains. */
  readonly dimension: string
  /** Filter operation with the value arity it implies. */
  readonly op: 'eq' | 'in' | 'between' | 'gte' | 'lte'
  /** Operand: one value for `eq`/`gte`/`lte`, a non-empty list for `in`, two values for `between`. */
  readonly value: DataQueryValue | readonly DataQueryValue[]
}

/** Inclusive start / exclusive end on one governed date or time dimension. */
export interface DataQueryTimeRange {
  /** Governed date or time dimension the range constrains. */
  readonly dimension: string
  /** Inclusive lower bound; omitted means unbounded below. */
  readonly start?: string | number
  /** Exclusive upper bound; omitted means unbounded above. */
  readonly end?: string | number
}

/** Sort by one already-selected metric or dimension. */
export interface DataQueryOrderBy {
  /** Selected metric or dimension code. */
  readonly field: string
  /** Sort direction. */
  readonly direction: 'asc' | 'desc'
}

/** Host-owned request sent through the data-query capability. */
export interface DataQueryRequest {
  /** Dataset selected from the server-owned semantic catalog. */
  readonly datasetCode: string
  /** Metrics requested from that dataset. */
  readonly metricCodes: readonly string[]
  /** Dimensions requested from that dataset. */
  readonly dimensionCodes: readonly string[]
  /** Semantic filters on authorized dimensions, applied with the server-side row scope. */
  readonly filters?: readonly DataQueryFilter[]
  /** Inclusive/exclusive bound on one governed date or time dimension. */
  readonly timeRange?: DataQueryTimeRange
  /** Sort on already-selected metrics or dimensions. */
  readonly orderBy?: readonly DataQueryOrderBy[]
  /** Requested row count, still subject to the provider's deployment ceiling. */
  readonly limit: number
  /** Immutable authenticated Principal supplied by the host, never by model arguments. */
  readonly principal: AuthenticatedPrincipal
}

/** Complete normalized tabular result returned to a Consumer. */
export interface DataQueryResult {
  /** Column names in row order. */
  readonly columns: readonly string[]
  /** Complete rectangular rows. */
  readonly rows: readonly (readonly DataQueryValue[])[]
}

/** One controlled-query backend registered with {@link DataQueryRuntime}. */
export interface DataQueryProvider {
  /** Stable registry id selected explicitly by deployment configuration. */
  readonly id: string
  /** Cheap local availability check that makes no network request. */
  available(): boolean
  /** Execute one request and honor cancellation for the complete operation. */
  query(request: DataQueryRequest, signal?: AbortSignal): Promise<DataQueryResult>
}
