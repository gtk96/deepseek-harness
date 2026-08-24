# Agent Note: Direct MCP registry for non-model consumers

Status: implemented

English | [中文](2026-08-19-mcp-direct-consumer-registry.zh.md)

## Problem

Some host operations run before the model loop and need a configured MCP server, but `ctx.tools` only exposes model-facing tools. Routing authentication through ToolRuntime would make identity resolution depend on model execution and publish an authority query to the model.

## Decision

`@deepseek-ai/dsh-mcp-client/mcp-clients` provides `ctx.mcpClients`, a process-local registry of raw connected MCP callers. Each `mcp-client` bridge registers its current MCP client only after connection succeeds and removes that exact registration before the generation disconnects or disposes. `call()` forwards the raw MCP tool name, arguments, cancellation signal, and the bridge's configured timeout; it returns the unvalidated protocol result to the consumer.

A bridge now has `exposeTools`. Its resolved default remains `true` for model-facing MCP servers. A deployment sets `false` for an internal-only server: the bridge connects and publishes its direct caller, but skips tool discovery, tool registration, and tool-list notifications. The data-aid MaxCompute resolver uses this route and validates a complete structured result itself.

## Alternatives considered

- **Call the generated `ctx.tools` definition.** Rejected: ToolRuntime is model-facing, adds tool execution semantics to authentication, and makes the authority query available to the model.
- **Create a second MCP connection in the data-aid package.** Rejected: competing clients would duplicate authentication, transport configuration, reconnect policy, and process lifecycle for one server.
- **Parse MCP text content as query rows.** Rejected: text cannot establish complete-row, truncation, or result-count facts needed by fail-closed authorization.

## Consequences

A non-model consumer can share the existing stdio or Streamable HTTP client, cancellation handling, timeout, and reconnect lifecycle without exposing the server's tools. The deployment must mount the registry before each bridge and use a unique server name. A direct call rejects during connection loss, retry exhaustion, or disposal; consumers must treat that failure according to their own policy. The generic registry does not validate tool-specific inputs or outputs.

## Verification

MCP registry coverage proves duplicate registration rejection, exact-disposer ownership, unavailable-call rejection, raw invocation forwarding, connection-lifetime publication, reconnection replacement, and direct-only mode without tool discovery or registry exposure. Data-aid coverage proves that only complete structured MaxCompute SELECT results reach its table resolver.
