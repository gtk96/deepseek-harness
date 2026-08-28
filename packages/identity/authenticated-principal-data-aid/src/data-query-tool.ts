/**
 * Model-facing Data Aid query tool: one semantic request through `ctx.dataQuery`.
 *
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid/data-query-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type {
  DataQueryContext,
  DataQueryFilter,
  DataQueryOrderBy,
  DataQueryRequest,
  DataQueryTimeRange,
  DataQueryValue,
} from '@deepseek-ai/dsh-data-query'
import type { DataAidTrustedTurnBinding } from './types.ts'
import type {} from '@deepseek-ai/dsh-data-query'
import type {} from '@deepseek-ai/dsh-authenticated-principal'
import type {} from './turn-principal.ts'

/** Dedicated model-visible capability name. */
export const DATA_QUERY_TOOL_NAME = 'data_query'
const CODE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u
const ROOT_KEYS = ['datasetCode', 'metricCodes', 'dimensionCodes', 'filters', 'timeRange', 'orderBy', 'limit'] as const

/** Tool-level execution, default, and semantic input limits. */
export interface Config {
  /** End-to-end tool execution timeout in seconds. */
  readonly timeoutSeconds: number
  /** Row count used when the model omits `limit`. */
  readonly defaultLimit: number
  /** Shared maximum number of selected metrics plus dimensions. */
  readonly maxSelectedFields: number
  /** Maximum semantic filters per call. */
  readonly maxFilters: number
  /** Maximum ordering entries per call. */
  readonly maxOrderBy: number
  /** Maximum scalar operands accepted by one `in` filter. */
  readonly maxInValues: number
  /** Maximum characters in one filter or time-range string value. */
  readonly maxValueChars: number
}

/** Loader validation, including the fixed dic-be protocol ceilings. */
export const Config: z<Config> = z.object({
  timeoutSeconds: z.number().step(1).min(1).max(30).required(),
  defaultLimit: z.number().step(1).min(1).max(100).required(),
  maxSelectedFields: z.number().step(1).min(1).max(32).required(),
  maxFilters: z.number().step(1).min(1).max(32).required(),
  maxOrderBy: z.number().step(1).min(1).max(32).required(),
  maxInValues: z.number().step(1).min(1).max(32).required(),
  maxValueChars: z.number().step(1).min(1).max(256).required(),
})

/** Cordis loader name used in diagnostics. */
export const name = 'data-aid-query-tool'

/** Services required to resolve the authenticated turn and dispatch a semantic query. */
export const inject = ['tools', 'dataQuery', 'dataAidTurnPrincipal']

/**
 * Register the model-facing semantic query tool in the current preset scope.
 * @param ctx - context carrying the tool registry, data-query runtime, and trusted turn binding.
 * @param config - execution, row, and semantic-input limits.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: DATA_QUERY_TOOL_NAME,
    description: 'Query authorized business data by semantic catalog codes. Supply one dataset, at least one metric, optional dimensions, filters, one time range, sorting, and a row limit. Physical tables, SQL, identity, permissions, endpoints, and credentials are never accepted.',
    parameterRoot: { additionalProperties: false },
    parameters: {
      datasetCode: {
        type: 'string',
        required: true,
        minLength: 1,
        maxLength: 64,
        pattern: CODE.source,
        description: 'Dataset code from the server-owned semantic catalog; 1–64 safe code characters.',
      },
      metricCodes: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 64, pattern: CODE.source },
        minItems: 1,
        maxItems: config.maxSelectedFields,
        uniqueItems: true,
        required: true,
        description: 'Unique metric codes to aggregate; at least one.',
      },
      dimensionCodes: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 64, pattern: CODE.source },
        maxItems: config.maxSelectedFields,
        uniqueItems: true,
        description: 'Unique dimension codes to group by; omitted means no grouping.',
      },
      filters: {
        type: 'array',
        maxItems: config.maxFilters,
        items: {
          type: 'object',
          properties: {
            dimension: {
              type: 'string',
              minLength: 1,
              maxLength: 64,
              pattern: CODE.source,
              required: true,
              description: 'Authorized dimension code.',
            },
            op: { type: 'string', enum: ['eq', 'in', 'between', 'gte', 'lte'], required: true, description: 'Filter operation.' },
            value: {
              oneOf: [
                { type: 'string', minLength: 1, maxLength: config.maxValueChars },
                { type: 'number' },
                {
                  type: 'array',
                  minItems: 1,
                  maxItems: config.maxInValues,
                  items: {
                    oneOf: [
                      { type: 'string', minLength: 1, maxLength: config.maxValueChars },
                      { type: 'number' },
                    ],
                  },
                },
              ],
              required: true,
              description: 'One finite string/number for eq/gte/lte, a non-empty list for in, or exactly two values for between.',
            },
          },
          additionalProperties: false,
        },
        description: 'Semantic filters; server-owned row scope is always applied separately.',
      },
      timeRange: {
        type: 'object',
        properties: {
          dimension: { type: 'string', minLength: 1, maxLength: 64, pattern: CODE.source, required: true, description: 'Governed date or time dimension code.' },
          start: { type: 'string', minLength: 1, maxLength: Math.min(config.maxValueChars, 64), required: true, description: 'Inclusive lower bound.' },
          end: { type: 'string', minLength: 1, maxLength: Math.min(config.maxValueChars, 64), required: true, description: 'Exclusive upper bound.' },
        },
        additionalProperties: false,
        description: 'Inclusive start and exclusive end on one governed date or time dimension.',
      },
      orderBy: {
        type: 'array',
        maxItems: config.maxOrderBy,
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              minLength: 1,
              maxLength: 64,
              pattern: CODE.source,
              required: true,
              description: 'Already-selected metric or dimension code.',
            },
            direction: { type: 'string', enum: ['asc', 'desc'], required: true, description: 'Sort direction.' },
          },
          additionalProperties: false,
        },
        description: 'Unique sorts on already-selected metrics or dimensions.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Requested rows from 1 to 100; omitted uses the deployment default.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          columns: { type: 'array', items: { type: 'string' }, required: true },
          rows: { type: 'array', items: { type: 'array', items: { type: 'json' } }, required: true },
          rowCount: { type: 'integer', required: true },
          complete: { type: 'boolean', const: true, required: true },
          truncated: { type: 'boolean', const: false, required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    timeoutMs: config.timeoutSeconds * 1000,
    async execute(args, exec) {
      const binding = ctx.dataAidTurnPrincipal.require(exec.agent)
      const request = buildRequest(args, config)
      const result = await ctx.dataQuery.query(request, buildContext(binding), exec.signal)
      return {
        columns: [...result.columns],
        rows: result.rows.map(row => row.map(dataQueryValueToJson)),
        rowCount: result.rowCount,
        complete: result.complete,
        truncated: result.truncated,
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

/**
 * Build provider context only from the complete trusted turn binding.
 * @param binding - service-authenticated principal and business turn ids.
 * @returns provider context containing only the trusted binding values.
 */
function buildContext(binding: DataAidTrustedTurnBinding): DataQueryContext {
  return {
    principalId: binding.principalId,
    conversationId: binding.conversationId,
    turnId: binding.turnId,
  }
}

/**
 * Build and validate one host-owned semantic request from model arguments.
 * @param args - closed model argument object.
 * @param limits - deployment semantic-count and value limits.
 * @returns normalized provider request without identity or physical execution fields.
 */
function buildRequest(
  args: {
    datasetCode: string
    metricCodes: string[]
    dimensionCodes?: string[]
    filters?: { dimension: string; op: 'eq' | 'in' | 'between' | 'gte' | 'lte'; value: JsonValue }[]
    timeRange?: { dimension: string; start: string; end: string }
    orderBy?: { field: string; direction: 'asc' | 'desc' }[]
    limit?: number
  },
  limits: Pick<Config, 'defaultLimit' | 'maxSelectedFields' | 'maxFilters' | 'maxOrderBy' | 'maxInValues' | 'maxValueChars'>,
): DataQueryRequest {
  assertExactKeys(args, ROOT_KEYS, 'data_query')
  assertCode(args.datasetCode, 'datasetCode')
  const metricCodes = validateCodes(args.metricCodes, 'metricCodes', true)
  const dimensionCodes = validateCodes(args.dimensionCodes ?? [], 'dimensionCodes', false)
  if (metricCodes.length + dimensionCodes.length > limits.maxSelectedFields) {
    throw new Error('data_query selected fields exceed maxSelectedFields')
  }
  if (args.filters !== undefined && args.filters.length > limits.maxFilters) {
    throw new Error('data_query filters exceed maxFilters')
  }
  if (args.orderBy !== undefined && args.orderBy.length > limits.maxOrderBy) {
    throw new Error('data_query orderBy exceeds maxOrderBy')
  }
  const limit = args.limit ?? limits.defaultLimit
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('data_query limit must be an integer from 1 to 100')
  }
  const selected = new Set([...metricCodes, ...dimensionCodes])
  const filters = args.filters?.map(filter => normalizeFilter(filter, limits))
  const orderBy = args.orderBy?.map(entry => normalizeOrderBy(entry, selected))
  if (orderBy !== undefined && new Set(orderBy.map(entry => entry.fieldCode)).size !== orderBy.length) {
    throw new Error('data_query orderBy fields must be unique')
  }
  return {
    datasetCode: args.datasetCode,
    metricCodes,
    dimensionCodes,
    ...(filters === undefined ? {} : { filters }),
    ...(args.timeRange === undefined ? {} : { timeRange: normalizeTimeRange(args.timeRange, limits.maxValueChars) }),
    ...(orderBy === undefined ? {} : { orderBy }),
    limit,
  }
}

/** Validate one unique code list. */
function validateCodes(values: unknown, name: string, nonEmpty: boolean): string[] {
  if (!Array.isArray(values) || (nonEmpty && values.length === 0)) {
    throw new Error(`data_query ${name} must be ${nonEmpty ? 'a non-empty' : 'an'} array`)
  }
  const normalized: string[] = []
  for (const value of values as unknown[]) {
    assertCode(value, name)
    normalized.push(value)
  }
  if (new Set(normalized).size !== normalized.length) throw new Error(`data_query ${name} must be unique`)
  return normalized
}

/** Map and validate one model filter into the DIC-BE array-operand protocol. */
function normalizeFilter(
  filter: { dimension: string; op: 'eq' | 'in' | 'between' | 'gte' | 'lte'; value: JsonValue },
  limits: Pick<Config, 'maxInValues' | 'maxValueChars'>,
): DataQueryFilter {
  assertExactKeys(filter, ['dimension', 'op', 'value'], 'data_query filter')
  assertCode(filter.dimension, 'filter dimension')
  let values: DataQueryValue[]
  switch (filter.op) {
    case 'in':
      if (!Array.isArray(filter.value) || filter.value.length === 0 || filter.value.length > limits.maxInValues) {
        throw new Error('data_query in filter requires a bounded non-empty value list')
      }
      values = filter.value.map(value => scalar(value, limits.maxValueChars))
      break
    case 'between':
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        throw new Error('data_query between filter requires exactly two values')
      }
      values = filter.value.map(value => scalar(value, limits.maxValueChars))
      break
    case 'eq':
    case 'gte':
    case 'lte':
      if (Array.isArray(filter.value)) throw new Error(`data_query ${filter.op} filter requires one scalar value`)
      values = [scalar(filter.value, limits.maxValueChars)]
      break
    default:
      throw new Error('data_query filter operation is unsupported')
  }
  return { dimensionCode: filter.dimension, operator: filter.op, value: values }
}

/** Map one complete time range into the Service Definition vocabulary. */
function normalizeTimeRange(
  range: { dimension: string; start: string; end: string },
  maxValueChars: number,
): DataQueryTimeRange {
  assertExactKeys(range, ['dimension', 'start', 'end'], 'data_query timeRange')
  assertCode(range.dimension, 'timeRange dimension')
  return {
    dimensionCode: range.dimension,
    startInclusive: boundedString(range.start, 'timeRange start', Math.min(maxValueChars, 64)),
    endExclusive: boundedString(range.end, 'timeRange end', Math.min(maxValueChars, 64)),
  }
}

/** Map one ordering entry and reject fields that were not selected. */
function normalizeOrderBy(
  entry: { field: string; direction: 'asc' | 'desc' },
  selected: ReadonlySet<string>,
): DataQueryOrderBy {
  assertExactKeys(entry, ['field', 'direction'], 'data_query orderBy')
  assertCode(entry.field, 'orderBy field')
  if (!selected.has(entry.field)) throw new Error('data_query orderBy field must be selected')
  return { fieldCode: entry.field, direction: entry.direction }
}

/** Accept only finite numeric or bounded string filter values, matching DIC-BE. */
function scalar(value: JsonValue, maxValueChars: number): string | number {
  if (typeof value === 'string') return boundedString(value, 'filter value', maxValueChars)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error('data_query filter values must be finite numbers or bounded strings')
}

/** Validate one normalized semantic code. */
function assertCode(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !CODE.test(value)) {
    throw new Error(`data_query ${name} must be a 1–64 character semantic code`)
  }
}

/** Validate one normalized, control-free string. */
function boundedString(value: unknown, name: string, maxChars: number): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > maxChars
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`data_query ${name} must be a normalized string of at most ${maxChars} characters`)
  }
  return value
}

/** Copy provider values into the mutable JSON representation required by tool results. */
function dataQueryValueToJson(value: DataQueryValue): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(dataQueryValueToJson)
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, dataQueryValueToJson(entry)]))
}

/** Reject undeclared keys even when `buildRequest` is called outside the tool registry. */
function assertExactKeys(value: object, allowed: readonly string[], subject: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error(`${subject} contains an undeclared field`)
  }
}

export { buildContext, buildRequest }
