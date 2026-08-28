import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  PrincipalAuthenticationError,
  type AuthenticatedPrincipal,
} from '@deepseek-ai/dsh-authenticated-principal'
import { McpClientRegistry } from '@deepseek-ai/dsh-mcp-client/mcp-clients'
import { bridge } from '@deepseek-ai/dsh-client-connection/src/http-bridge.ts'
import { DataAidMseGatewayAuthenticator } from '../src/mse-gateway.ts'
import type { DataAidMseGatewayAuthenticatorOptions } from '../src/mse-gateway.ts'

const options: DataAidMseGatewayAuthenticatorOptions = {
  trustedProxyAddresses: ['10.0.0.8'],
  partition: { dt: '20260819', ht: '14' },
  serverName: 'maxcompute-authority',
  toolName: 'execute_sql',
  project: 'giikin',
  maxCU: 10,
  timeoutSeconds: 30,
}

function visitorHeaders(userId = 'dd-001'): Record<string, string> {
  return {
    'gk-service-user': Buffer.from(JSON.stringify({ id: userId }), 'utf8').toString('base64'),
    'gk-service-app': Buffer.from(JSON.stringify({ clientId: 'data-aid-web' }), 'utf8').toString('base64'),
  }
}

function authorityRow(userId = 'dd-001'): Record<string, string> {
  return {
    gk_userid: 'gk-001',
    gimp_staff_id: 'gk-001',
    dd_userid: userId,
    dd_staff_id: userId,
    data_role: '0',
    team_codes: 'team-a',
    data_org_code: 'org-a',
  }
}

async function bridged(
  peerAddress: string | undefined,
  headers: Record<string, string>,
  fetch: (request: Request) => Promise<Response>,
): Promise<void> {
  const request = Readable.from([]) as unknown as IncomingMessage
  Object.assign(request, {
    url: '/api/pluginInventory/list',
    method: 'POST',
    headers,
    socket: { remoteAddress: peerAddress },
  })
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead() { return this },
    write() { return true },
    end() { this.writableEnded = true; return this },
  }) as unknown as ServerResponse
  await bridge(request, response, { fetch })
}

async function mounted(): Promise<{
  readonly service: DataAidMseGatewayAuthenticator
  readonly calls: unknown[]
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const registryFiber = ctx.plugin(McpClientRegistry)
  await registryFiber
  const registry = ctx.get('mcpClients')
  if (registry === undefined) throw new Error('MCP client registry was not installed')
  const calls: unknown[] = []
  const unregister = registry.register('maxcompute-authority', async (request) => {
    calls.push(request)
    return {
      structuredContent: {
        success: true,
        truncated: false,
        rowCount: 1,
        rowsReturned: 1,
        data: [authorityRow()],
      },
    }
  })
  const authenticatorFiber = ctx.plugin(DataAidMseGatewayAuthenticator, options)
  await authenticatorFiber
  const service = ctx.get('authenticatedPrincipal')
  if (!(service instanceof DataAidMseGatewayAuthenticator)) {
    throw new Error('MSE data-aid authenticator was not installed')
  }
  return {
    service,
    calls,
    dispose: async () => {
      await authenticatorFiber.dispose()
      unregister()
      await registryFiber.dispose()
    },
  }
}

describe('DataAidMseGatewayAuthenticator', () => {
  it.each([
    { ...options, trustedProxyAddresses: [] },
    { ...options, trustedProxyAddresses: ['mse.internal'] },
    { ...options, trustedProxyAddresses: ['10.0.0.8', '::ffff:10.0.0.8'] },
    { ...options, partition: { dt: '2026081', ht: '14' } },
    { ...options, partition: { dt: '20260819', ht: '4' } },
  ])('rejects an incomplete trusted-proxy deployment %#', (invalidOptions) => {
    expect(() => new DataAidMseGatewayAuthenticator(new Context(), invalidOptions))
      .toThrow('data-aid MSE authenticator')
  })

  it('accepts MSE headers only from the configured bridge-recorded TCP peer and resolves authority', async () => {
    const { service, calls, dispose } = await mounted()
    let principal: AuthenticatedPrincipal | undefined

    await bridged('::ffff:10.0.0.8', visitorHeaders(), async (request) => {
      principal = await service.authenticate(request, new AbortController().signal)
      return new Response()
    })

    expect(principal).toMatchObject({
      ddUserId: 'dd-001',
      clientId: 'data-aid-web',
      gkUserId: 'gk-001',
      gimpStaffId: 'gk-001',
      dataRole: '0',
      teamCodes: ['team-a'],
      dataOrgCodes: ['org-a'],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      toolName: 'execute_sql',
      arguments: {
        project: 'giikin',
        async: false,
        maxCU: 10,
        timeout: 30,
      },
    })
    await dispose()
  })

  it('fails closed before the authority query for untrusted or synthetic requests', async () => {
    const { service, calls, dispose } = await mounted()

    await expect(bridged('10.0.0.9', visitorHeaders(), async (request) => {
      await service.authenticate(request, new AbortController().signal)
      return new Response()
    })).rejects.toBeInstanceOf(PrincipalAuthenticationError)
    await expect(service.authenticate(
      new Request('http://dsh.internal/api/pluginInventory/list', { headers: visitorHeaders() }),
      new AbortController().signal,
    )).rejects.toBeInstanceOf(PrincipalAuthenticationError)
    expect(calls).toHaveLength(0)
    await dispose()
  })
})
