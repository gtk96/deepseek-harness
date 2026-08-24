/**
 * Model-facing Data Aid query tool: one semantic request through `ctx.dataQuery`.
 *
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid/data-query-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { DataQueryFilter, DataQueryOrderBy, DataQueryRequest, DataQueryTimeRange } from '@deepseek-ai/dsh-data-query'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type {} from '@deepseek-ai/dsh-data-query'
import type {} from '@deepseek-ai/dsh-authenticated-principal'
import type {} from './turn-principal.ts'

/** Dedicated model-visible capability name. */
export const DATA_QUERY_TOOL_NAME = 'data_query'

/** Tool-level execution and default-limit configuration. */
export interface Config {
  /** End-to-end tool execution timeout in seconds. */
  readonly timeoutSeconds: number
  /** Row count used when the model omits `limit`, still bounded by the provider ceiling. */
  readonly defaultLimit: number
}

/** Loader validation for tool-level configuration. */
export const Config: z<Config> = z.object({
  timeoutSeconds: z.number().step(1).min(1).max(2_147_483).required(),
  defaultLimit: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

/** Cordis loader name used in diagnostics. */
export const name = 'data-aid-query-tool'

/** Services required to resolve the authenticated turn and dispatch a semantic query. */
export const inject = ['tools', 'dataQuery', 'dataAidTurnPrincipal']

/**
 * Register the model-facing semantic query tool in the current preset scope.
 * The tool obtains every identity and scope field from the authenticated turn,
 * never from model arguments, and dispatches through the configured provider.
 * @param ctx - Cordis context carrying the tool registry, data-query runtime, and turn binding service.
 * @param config - tool-level timeout and default limit.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: DATA_QUERY_TOOL_NAME,
    description: 'Query authorized business data by semantic catalog codes. Supply the dataset, at least one metric, optional dimensions, filters, a time range, sorting, and a row limit. Physical tables, SQL, and credentials are never accepted; access is limited by the authenticated user and the server-enforced data scope.',
    parameters: {
      datasetCode: { type: 'string', required: true, description: 'Dataset code from the server-owned semantic catalog.' },
      metricCodes: { type: 'array', items: { type: 'string' }, required: true, description: 'Metric codes to aggregate, at least one.' },
      dimensionCodes: { type: 'array', items: { type: 'string' }, description: 'Dimension codes to group by; omitted means no grouping.' },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dimension: { type: 'string', required: true, description: 'Authorized dimension code.' },
            op: { type: 'string', enum: ['eq', 'in', 'between', 'gte', 'lte'], required: true, description: 'Filter operation: eq, in (list), between (two values), gte, lte.' },
            value: { type: 'json', required: true, description: 'Operand: one value for eq/gte/lte, a list for in, two values for between.' },
          },
          additionalProperties: false,
        },
        description: 'Semantic filters on authorized dimensions; the server applies them with the row scope.',
      },
      timeRange: {
        type: 'object',
        properties: {
          dimension: { type: 'string', required: true, description: 'Governed date or time dimension code.' },
          start: { type: 'json', description: 'Inclusive lower bound.' },
          end: { type: 'json', description: 'Exclusive upper bound.' },
        },
        additionalProperties: false,
        description: 'Inclusive/exclusive bound on one governed date or time dimension.',
      },
      orderBy: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', required: true, description: 'Already-selected metric or dimension code.' },
            direction: { type: 'string', enum: ['asc', 'desc'], required: true, description: 'Sort direction.' },
          },
          additionalProperties: false,
        },
        description: 'Sort on already-selected metrics or dimensions.',
      },
      limit: { type: 'integer', description: 'Requested row count; defaults to the configured limit and never exceeds the provider ceiling.' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          columns: { type: 'array', items: { type: 'string' }, required: true },
          rows: { type: 'array', items: { type: 'array', items: { type: 'json' } }, required: true },
        },
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    timeoutMs: config.timeoutSeconds * 1000,
    async execute(args, exec) {
      const principal = ctx.dataAidTurnPrincipal.require(exec.agent)
      const request = buildRequest(args, principal, config.defaultLimit)
      const result = await ctx.dataQuery.query(request, exec.signal)
      return {
        columns: [...result.columns],
        rows: result.rows.map(row => [...row] as JsonValue[]) as JsonValue[][],
      }
    },
    presentCall() {
      return { card: 'generic', title: 'Querying authorized data', kind: 'search' }
    },
    presentResult(_args, result) {
      return { card: 'generic', title: result.isError ? 'Authorized data query failed' : 'Authorized data query completed', content: result.content }
    },
  })), 'data-aid-query-tool: register')
}

/** Build a host-owned semantic request from tool arguments and the authenticated turn. */
function buildRequest(
  args: {
    datasetCode: string
    metricCodes: string[]
    dimensionCodes?: string[]
    filters?: { dimension: string; op: 'eq' | 'in' | 'between' | 'gte' | 'lte'; value: JsonValue }[]
    timeRange?: { dimension: string; start?: JsonValue; end?: JsonValue }
    orderBy?: { field: string; direction: 'asc' | 'desc' }[]
    limit?: number
  },
  principal: AuthenticatedPrincipal,
  defaultLimit: number,
): DataQueryRequest {
  const limit = args.limit === undefined ? defaultLimit : args.limit
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('data_query limit must be a positive integer')
  }
  return {
    datasetCode: args.datasetCode,
    metricCodes: args.metricCodes,
    dimensionCodes: args.dimensionCodes ?? [],
    ...(args.filters === undefined ? {} : { filters: args.filters.map(normalizeFilter) }),
    ...(args.timeRange === undefined ? {} : { timeRange: normalizeTimeRange(args.timeRange) }),
    ...(args.orderBy === undefined ? {} : { orderBy: args.orderBy.map(normalizeOrderBy) }),
    limit,
    principal,
  }
}

/** Narrow a model-supplied filter to the request vocabulary, rejecting a missing operand. */
function normalizeFilter(filter: { dimension: string; op: 'eq' | 'in' | 'between' | 'gte' | 'lte'; value: JsonValue }): DataQueryFilter {
  if (filter.value === undefined) throw new Error('data_query filter requires a value')
  return { dimension: filter.dimension, op: filter.op, value: filter.value }
}

/** Narrow a model-supplied time range to the request vocabulary, rejecting a non-temporal bound. */
function normalizeTimeRange(range: { dimension: string; start?: JsonValue; end?: JsonValue }): DataQueryTimeRange {
  return {
    dimension: range.dimension,
    ...(range.start === undefined ? {} : { start: normalizeBound(range.start, 'start') }),
    ...(range.end === undefined ? {} : { end: normalizeBound(range.end, 'end') }),
  }
}

/** Validate one inclusive/exclusive temporal bound, which must be a date string or number. */
function normalizeBound(value: JsonValue, name: string): string | number {
  if (typeof value === 'string' || typeof value === 'number') return value
  throw new Error(`data_query timeRange ${name} must be a date string or number`)
}

/** Narrow a model-supplied order-by entry to the request vocabulary. */
function normalizeOrderBy(entry: { field: string; direction: 'asc' | 'desc' }): DataQueryOrderBy {
  return { field: entry.field, direction: entry.direction }
}

export { buildRequest }
