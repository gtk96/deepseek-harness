/**
 * Model-facing local direct query tools for pre-authorization Data Aid testing.
 *
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid/direct-query-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-mcp-client/mcp-clients'

/** Model-visible local MaxCompute query capability name. */
export const DATA_QUERY_MAXCOMPUTE_TOOL_NAME = 'data_query_maxcompute'

/** Model-visible local Hologres query capability name. */
export const DATA_QUERY_HOLOGRES_TOOL_NAME = 'data_query_hologres'

/** Deployment-selected MaxCompute read-query limits. */
interface MaxComputeConfig {
  /** Connected raw MaxCompute MCP client namespace. */
  readonly serverName: string
  /** MaxCompute project fixed by this deployment. */
  readonly project: string
  /** Compute-unit ceiling forwarded to MaxCompute. */
  readonly maxCU: number
  /** End-to-end query timeout in seconds. */
  readonly timeoutSeconds: number
}

/** Deployment-selected Hologres read-query limits. */
interface HologresConfig {
  /** Connected raw Hologres MCP client namespace. */
  readonly serverName: string
  /** End-to-end query timeout in seconds. */
  readonly timeoutSeconds: number
}

/** Configuration for the local direct-data query capability. */
export interface Config {
  /** MaxCompute MCP route and limits. */
  readonly maxcompute: MaxComputeConfig
  /** Hologres MCP route and limits. */
  readonly hologres: HologresConfig
  /** Maximum serialized MCP result characters exposed to the model. */
  readonly maxResultChars: number
}

/** Loader validation for local direct-data query configuration. */
export const Config: z<Config> = z.object({
  maxcompute: z.object({
    serverName: z.string(),
    project: z.string(),
    maxCU: z.number(),
    timeoutSeconds: z.number(),
  }),
  hologres: z.object({
    serverName: z.string(),
    timeoutSeconds: z.number(),
  }),
  maxResultChars: z.number(),
})

/** Cordis loader name used in diagnostics. */
export const name = 'data-aid-direct-query-tools'

/** Services required to query the connected local MCP servers. */
export const inject = ['tools', 'mcpClients']

/**
 * Register local direct MaxCompute and Hologres read-query tools.
 * @param ctx - Cordis context carrying the tool and raw MCP-client registries.
 * @param config - local MCP server selection and result limits.
 */
export function apply(ctx: Context, config: Config): void {
  assertConfig(config)
  ctx.effect(() => ctx.tools.register(createMaxComputeTool(ctx, config)), 'data-aid-direct-query-tools: maxcompute')
  ctx.effect(() => ctx.tools.register(createHologresTool(ctx, config)), 'data-aid-direct-query-tools: hologres')
}

/** Create the local MaxCompute tool that reaches only its read-only MCP entry point. */
function createMaxComputeTool(ctx: Context, config: Config) {
  return defineTool({
    name: DATA_QUERY_MAXCOMPUTE_TOOL_NAME,
    description: 'Query local MaxCompute business data. Supply one read-only SELECT or WITH query. This local test tool uses the configured service identity and does not apply end-user data permissions.',
    parameters: {
      sql: { type: 'string', required: true, description: 'One read-only SELECT or WITH query.' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          result: { type: 'json', required: true },
        },
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    timeoutMs: config.maxcompute.timeoutSeconds * 1000,
    async execute({ sql }, exec) {
      const result = await ctx.mcpClients.call({
        serverName: config.maxcompute.serverName,
        toolName: 'execute_sql',
        arguments: {
          project: config.maxcompute.project,
          sql: validateReadOnlySql(sql),
          async: false,
          maxCU: config.maxcompute.maxCU,
          timeout: config.maxcompute.timeoutSeconds,
        },
        signal: exec.signal,
      })
      return { result: serializeResult(result, config.maxResultChars, 'MaxCompute') }
    },
    presentCall() {
      return { card: 'generic', title: 'Querying MaxCompute data', kind: 'search' }
    },
    presentResult(_args, result) {
      return { card: 'generic', title: result.isError ? 'MaxCompute query failed' : 'MaxCompute query completed', content: result.content }
    },
  })
}

/** Create the local Hologres tool that reaches only its SELECT MCP entry point. */
function createHologresTool(ctx: Context, config: Config) {
  return defineTool({
    name: DATA_QUERY_HOLOGRES_TOOL_NAME,
    description: 'Query local Hologres business data. Supply one read-only SELECT or WITH query. This local test tool uses the configured service identity and does not apply end-user data permissions.',
    parameters: {
      sql: { type: 'string', required: true, description: 'One read-only SELECT or WITH query.' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          result: { type: 'json', required: true },
        },
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    timeoutMs: config.hologres.timeoutSeconds * 1000,
    async execute({ sql }, exec) {
      const result = await ctx.mcpClients.call({
        serverName: config.hologres.serverName,
        toolName: 'execute_hg_select_sql',
        arguments: { query: validateReadOnlySql(sql) },
        signal: exec.signal,
      })
      return { result: serializeResult(result, config.maxResultChars, 'Hologres') }
    },
    presentCall() {
      return { card: 'generic', title: 'Querying Hologres data', kind: 'search' }
    },
    presentResult(_args, result) {
      return { card: 'generic', title: result.isError ? 'Hologres query failed' : 'Hologres query completed', content: result.content }
    },
  })
}

/** Reject incomplete or nonsensical deployment limits at plugin load. */
function assertConfig(config: Config): void {
  for (const [name, value] of Object.entries({
    maxCU: config.maxcompute.maxCU,
    maxcomputeTimeoutSeconds: config.maxcompute.timeoutSeconds,
    hologresTimeoutSeconds: config.hologres.timeoutSeconds,
    maxResultChars: config.maxResultChars,
  })) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`data-aid-direct-query-tools: ${name} must be a positive integer`)
  }
  for (const [name, value] of Object.entries({
    maxcomputeServerName: config.maxcompute.serverName,
    project: config.maxcompute.project,
    hologresServerName: config.hologres.serverName,
  })) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`data-aid-direct-query-tools: ${name} must be a non-empty string`)
  }
}

/** Validate the single-statement read-query input shared by both local MCP servers. */
function validateReadOnlySql(sql: string): string {
  const query = sql.trim()
  if (query.length === 0 || query.includes(';') || !/^(?:select|with)\b/i.test(query)) {
    throw new Error('data query SQL must be one SELECT or WITH statement without a semicolon')
  }
  return query
}

/** Serialize a successful and complete raw MCP response to a model-safe bounded JSON value. */
function serializeResult(raw: Record<string, unknown>, maxResultChars: number, source: string): JsonValue {
  if (raw.isError === true) throw new Error(`${source} MCP rejected the query`)
  const structured = raw.structuredContent
  if (isRecord(structured) && (structured.truncated === true || structured.complete === false)) {
    throw new Error(`${source} MCP returned an incomplete result`)
  }
  const serialized = JSON.stringify(raw)
  if (serialized === undefined || serialized.length > maxResultChars) {
    throw new Error(`${source} MCP result exceeded the configured result size`)
  }
  try {
    return JSON.parse(serialized) as JsonValue
  } catch {
    throw new Error(`${source} MCP returned a non-JSON result`)
  }
}

/** Narrow an untrusted MCP JSON value to a string-keyed object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export { serializeResult, validateReadOnlySql }
