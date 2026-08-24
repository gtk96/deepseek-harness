/**
 * Live raw MCP tool-call registry for non-model consumers.
 * @module @deepseek-ai/dsh-mcp-client/mcp-clients
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** Raw result returned by an MCP server's `tools/call` request. */
export type McpToolCallResult = Record<string, unknown>

/** Request forwarded to the connected caller for one raw MCP tool invocation. */
export interface McpToolCallerRequest {
  /** The MCP server's unmodified wire tool name. */
  toolName: string
  /** Arguments sent as the MCP `arguments` object. */
  arguments: Record<string, unknown>
  /** Caller cancellation forwarded to the MCP request. */
  signal: AbortSignal
}

/** Live connected-client function that invokes one raw MCP tool. */
export type McpToolCaller = (request: McpToolCallerRequest) => Promise<McpToolCallResult>

/** Request selecting one configured MCP server and raw MCP tool. */
export interface McpToolCallRequest extends McpToolCallerRequest {
  /** Configured MCP server namespace. */
  serverName: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpClients: McpClientRegistry
  }
}

/**
 * Registry of currently connected MCP clients for direct, non-model raw tool calls.
 * Registrations are disposer-owned: a removed client becomes unavailable immediately.
 */
export class McpClientRegistry extends Service {
  private readonly callers = new Map<string, McpToolCaller>()

  constructor(ctx: Context) {
    super(ctx, 'mcpClients')
  }

  /**
   * Publish one currently connected caller under its configured server name.
   * @param serverName - configured MCP server namespace.
   * @param caller - raw invocation function for the connected client.
   * @returns disposer that removes this exact caller.
   * @throws when another live caller already owns the server name.
   */
  register(serverName: string, caller: McpToolCaller): () => void {
    if (this.callers.has(serverName)) {
      throw new Error(`mcp client "${serverName}" is already registered`)
    }
    this.callers.set(serverName, caller)
    return () => {
      if (this.callers.get(serverName) === caller) this.callers.delete(serverName)
    }
  }

  /**
   * Invoke a raw tool on the current connected client for one configured server.
   * @param request - server selection, raw tool name, arguments, and cancellation signal.
   * @returns unvalidated raw MCP tool result for the consumer to validate.
   * @throws when the selected server has no live caller.
   */
  call({ serverName, toolName, arguments: args, signal }: McpToolCallRequest): Promise<McpToolCallResult> {
    const caller = this.callers.get(serverName)
    if (caller === undefined) {
      return Promise.reject(new Error(`mcp client "${serverName}" is unavailable`))
    }
    return caller({ toolName, arguments: args, signal })
  }
}

export default McpClientRegistry
