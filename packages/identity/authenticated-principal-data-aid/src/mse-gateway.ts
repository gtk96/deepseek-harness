/** MSE trusted-proxy authenticator for data-aid browser requests. */

import { isIP } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { transportPeerAddressOf } from '@deepseek-ai/dsh-client-connection'
import {
  DataAidGatewayAuthenticator,
  createDataAidMaxComputeMcpQuery,
  createDataAidTablePrincipalResolver,
} from './index.ts'
import type { DataAidAuthorityPartition, DataAidMaxComputeMcpQueryOptions } from './types.ts'
// Side-effect type import: declaration-merges `ctx.mcpClients` onto Context.
import type {} from '@deepseek-ai/dsh-mcp-client/mcp-clients'

/** Deployment settings for the MSE trusted-proxy provider. */
export interface DataAidMseGatewayAuthenticatorOptions extends DataAidMaxComputeMcpQueryOptions {
  /** Direct TCP peers allowed to supply MSE-injected visitor headers. */
  readonly trustedProxyAddresses: readonly string[]
  /** Fixed authority snapshot used for this deployment. */
  readonly partition: DataAidAuthorityPartition
}

/**
 * Data-aid provider for a DSH Web server placed behind an MSE enterprise SSO proxy.
 *
 * The proxy owns DingTalk login, strips browser-controlled identity headers, and
 * injects its visitor headers only after authentication. This provider accepts
 * them only when Connection recorded a configured direct TCP proxy peer.
 */
export class DataAidMseGatewayAuthenticator extends DataAidGatewayAuthenticator {
  static inject = ['mcpClients']

  /**
   * Validate the trusted-proxy deployment settings and compose its authority resolver.
   * @param ctx - owning Context with the direct non-model MCP client registry.
   * @param options - trusted MSE peers, fixed authority partition, and raw MCP tool settings.
   */
  constructor(ctx: Context, options: DataAidMseGatewayAuthenticatorOptions) {
    const trustedProxyAddresses = validateOptions(options)
    super(ctx, {
      verifyGatewayRequest: request => isTrustedProxyRequest(request, trustedProxyAddresses),
      resolver: createDataAidTablePrincipalResolver({
        resolvePartition: () => options.partition,
        query: createDataAidMaxComputeMcpQuery(ctx.mcpClients, options),
      }),
    })
  }
}

/** Default Loader export for MSE-backed data-aid deployments. */
export default DataAidMseGatewayAuthenticator

/** Reject incomplete MSE deployment settings before the provider starts. */
function validateOptions(options: unknown): ReadonlySet<string> {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('data-aid MSE authenticator options are required')
  }
  const record = options as Record<string, unknown>
  if (!Array.isArray(record.trustedProxyAddresses) || record.trustedProxyAddresses.length === 0) {
    throw new TypeError('data-aid MSE authenticator trustedProxyAddresses must contain at least one address')
  }
  const trustedProxyAddresses = new Set<string>()
  for (const value of record.trustedProxyAddresses) {
    if (typeof value !== 'string') throw new TypeError('data-aid MSE authenticator proxy address must be a string')
    const normalized = normalizeAddress(value)
    if (normalized === undefined) throw new TypeError('data-aid MSE authenticator proxy address must be an IP literal')
    if (trustedProxyAddresses.has(normalized)) {
      throw new TypeError(`data-aid MSE authenticator proxy address is duplicated: ${normalized}`)
    }
    trustedProxyAddresses.add(normalized)
  }
  const partition = record.partition
  if (partition === null || typeof partition !== 'object') {
    throw new TypeError('data-aid MSE authenticator partition is required')
  }
  const partitionRecord = partition as Record<string, unknown>
  if (typeof partitionRecord.dt !== 'string' || !/^\d{8}$/u.test(partitionRecord.dt)) {
    throw new TypeError('data-aid MSE authenticator partition.dt must be YYYYMMDD')
  }
  if (typeof partitionRecord.ht !== 'string' || !/^\d{2}$/u.test(partitionRecord.ht)) {
    throw new TypeError('data-aid MSE authenticator partition.ht must be HH')
  }
  return trustedProxyAddresses
}

/** Accept MSE visitor headers only when Connection recorded a configured TCP peer. */
function isTrustedProxyRequest(request: Request, trustedProxyAddresses: ReadonlySet<string>): boolean {
  const peerAddress = transportPeerAddressOf(request)
  const normalized = peerAddress === undefined ? undefined : normalizeAddress(peerAddress)
  return normalized !== undefined && trustedProxyAddresses.has(normalized)
}

/** Normalize an IPv4-mapped IPv6 peer address without accepting hostnames or headers. */
function normalizeAddress(value: string): string | undefined {
  const normalized = value.replace(/^::ffff:/iu, '').trim()
  return isIP(normalized) === 0 ? undefined : normalized
}
