import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import McpClientRegistry from '@deepseek-ai/dsh-mcp-client/src/mcp-clients.ts'

describe('McpClientRegistry', () => {
  it('forwards a raw request to the named live caller', async () => {
    const ctx = new Context()
    await ctx.plugin(McpClientRegistry)
    const signal = new AbortController().signal
    const caller = vi.fn(async () => ({ content: [{ type: 'text', text: 'raw' }] }))
    ctx.mcpClients.register('fixture', caller)

    await expect(ctx.mcpClients.call({
      serverName: 'fixture', toolName: 'admin.reset', arguments: { force: true }, signal,
    })).resolves.toEqual({ content: [{ type: 'text', text: 'raw' }] })
    expect(caller).toHaveBeenCalledWith({ toolName: 'admin.reset', arguments: { force: true }, signal })
  })

  it('rejects unavailable callers and removes a caller when its disposer runs', async () => {
    const ctx = new Context()
    await ctx.plugin(McpClientRegistry)
    const request = {
      serverName: 'fixture', toolName: 'read', arguments: {}, signal: new AbortController().signal,
    }

    await expect(ctx.mcpClients.call(request)).rejects.toThrow('mcp client "fixture" is unavailable')
    const dispose = ctx.mcpClients.register('fixture', async () => ({ content: [] }))
    dispose()
    await expect(ctx.mcpClients.call(request)).rejects.toThrow('mcp client "fixture" is unavailable')
  })

  it('does not let a stale disposer remove a replacement caller', async () => {
    const ctx = new Context()
    await ctx.plugin(McpClientRegistry)
    const first = ctx.mcpClients.register('fixture', async () => ({ content: ['first'] }))
    first()
    ctx.mcpClients.register('fixture', async () => ({ content: ['second'] }))
    first()

    await expect(ctx.mcpClients.call({
      serverName: 'fixture', toolName: 'read', arguments: {}, signal: new AbortController().signal,
    })).resolves.toEqual({ content: ['second'] })
  })
})
