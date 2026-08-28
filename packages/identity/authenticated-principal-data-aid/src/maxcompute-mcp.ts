/** Direct MaxCompute MCP query adapter for pre-model data-aid authentication. */

import type { McpClientRegistry } from '@deepseek-ai/dsh-mcp-client/mcp-clients'
import type { DataAidAuthorityQuery, DataAidMaxComputeMcpQueryOptions } from './types.ts'

/**
 * Create a direct authority-query callback backed by a connected MaxCompute MCP server.
 *
 * Only structured MCP results from the configured synchronous SELECT tool are accepted.
 * Text content is not parsed because it cannot prove the complete row set was returned.
 * @param mcpClients - live MCP client registry owned by the host composition.
 * @param options - selected server, raw SELECT tool, project, and query limits.
 * @returns a query callback for {@link createDataAidTablePrincipalResolver}.
 * @throws when the deployment configuration is incomplete.
 */
export function createDataAidMaxComputeMcpQuery(
  mcpClients: Pick<McpClientRegistry, 'call'>,
  options: DataAidMaxComputeMcpQueryOptions,
): DataAidAuthorityQuery {
  assertMcpClients(mcpClients)
  validateOptions(options)

  return async (sql, signal) => {
    const result = await mcpClients.call({
      serverName: options.serverName,
      toolName: options.toolName,
      arguments: {
        project: options.project,
        sql,
        async: false,
        maxCU: options.maxCU,
        timeout: options.timeoutSeconds,
      },
      signal,
    })
    return rowsFromMcpResult(result)
  }
}

/** Assert the injected MCP client method before capturing it. */
function assertMcpClients(value: unknown): asserts value is Pick<McpClientRegistry, 'call'> {
  if (value === null || typeof value !== 'object' || !('call' in value) || typeof value.call !== 'function') {
    throw new TypeError('data-aid MaxCompute MCP query requires mcpClients.call')
  }
}

/** Validate the fixed deployment configuration before the first authenticated request. */
function validateOptions(options: unknown): asserts options is DataAidMaxComputeMcpQueryOptions {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('data-aid MaxCompute MCP query options are required')
  }
  const record = options as Record<string, unknown>
  for (const [key, value] of Object.entries({
    serverName: record.serverName,
    toolName: record.toolName,
    project: record.project,
  })) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError(`data-aid MaxCompute MCP query ${key} must be a non-empty string`)
    }
  }
  if (typeof record.maxCU !== 'number' || !Number.isFinite(record.maxCU) || record.maxCU <= 0) {
    throw new TypeError('data-aid MaxCompute MCP query maxCU must be positive')
  }
  if (typeof record.timeoutSeconds !== 'number'
    || !Number.isInteger(record.timeoutSeconds)
    || record.timeoutSeconds <= 0) {
    throw new TypeError('data-aid MaxCompute MCP query timeoutSeconds must be a positive integer')
  }
}

/** Accept only the complete structured response emitted by the synchronous MaxCompute SELECT tool. */
function rowsFromMcpResult(result: unknown): readonly unknown[] {
  if (!isRecord(result) || result.isError === true || !isRecord(result.structuredContent)) {
    throw new Error('data-aid MaxCompute MCP query returned no structured success result')
  }
  const structured = result.structuredContent
  if (structured.success !== true || structured.truncated !== false || !Array.isArray(structured.data)) {
    throw new Error('data-aid MaxCompute MCP query returned an incomplete result')
  }
  if (!Number.isSafeInteger(structured.rowCount) || structured.rowCount !== structured.data.length
    || !Number.isSafeInteger(structured.rowsReturned) || structured.rowsReturned !== structured.data.length) {
    throw new Error('data-aid MaxCompute MCP query returned inconsistent row counts')
  }
  return structured.data
}

/** Narrow an external MCP field to a string-keyed record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
