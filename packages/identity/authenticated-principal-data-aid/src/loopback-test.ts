/** Loopback-only MCP-backed authenticator for a local data-aid Gateway smoke test. */

import type { Context } from '@deepseek-ai/cordis'
import {
  DataAidGatewayAuthenticator,
  createDataAidMaxComputeMcpQuery,
  createDataAidTablePrincipalResolver,
} from './index.ts'
import type { DataAidAuthorityPartition, DataAidMaxComputeMcpQueryOptions } from './types.ts'
// Side-effect type import: declaration-merges `ctx.mcpClients` onto Context.
import type {} from '@deepseek-ai/dsh-mcp-client/mcp-clients'

/** Required header carrying the local test secret. This is not a production identity proof. */
export const LOOPBACK_TEST_TOKEN_HEADER = 'x-dsh-data-aid-test-token'

/** Fixed Fetch origin created by DSH Web's HTTP bridge for every RPC request. */
const DSH_WEB_INTERNAL_HOSTNAME = 'dsh.internal'

/** Explicit test-only deployment configuration for the local MaxCompute fixture. */
export interface DataAidLoopbackTestAuthenticatorOptions extends DataAidMaxComputeMcpQueryOptions {
  /** Shared test secret required on every loopback request. */
  readonly testToken: string
  /** Fixed snapshot partition returned to the test resolver. */
  readonly partition: DataAidAuthorityPartition
}

/**
 * Data-aid provider usable only for local smoke tests against a fixture MCP server.
 *
 * It accepts only the DSH Web bridge's fixed internal HTTP origin plus a
 * caller-supplied test secret. The local Web server itself binds to IPv4 loopback.
 * Production deployments must use
 * {@link DataAidGatewayAuthenticator} with their MSE/reverse-proxy verifier.
 */
export class DataAidLoopbackTestAuthenticator extends DataAidGatewayAuthenticator {
  static inject = ['mcpClients']

  /**
   * Validate the explicit local-test settings and compose the MCP-backed resolver.
   * @param ctx - owning Cordis Context with the non-model MCP client registry.
   * @param options - local secret, fixed fixture partition, and raw MCP tool settings.
   */
  constructor(ctx: Context, options: DataAidLoopbackTestAuthenticatorOptions) {
    validateOptions(options)
    super(ctx, {
      verifyGatewayRequest: request => isAuthorizedLoopbackRequest(request, options.testToken),
      resolver: createDataAidTablePrincipalResolver({
        resolvePartition: () => options.partition,
        query: createDataAidMaxComputeMcpQuery(ctx.mcpClients, options),
      }),
    })
  }
}

/** Default Loader export for the explicitly named local test profile row. */
export default DataAidLoopbackTestAuthenticator

/** Reject an incomplete test configuration before the Web Gateway starts. */
function validateOptions(options: unknown): void {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('data-aid loopback test authenticator options are required')
  }
  const record = options as Record<string, unknown>
  if (typeof record.testToken !== 'string' || record.testToken.length < 16) {
    throw new TypeError('data-aid loopback test authenticator testToken must contain at least 16 characters')
  }
  const partition = record.partition
  if (partition === null || typeof partition !== 'object') {
    throw new TypeError('data-aid loopback test authenticator partition is required')
  }
  const partitionRecord = partition as Record<string, unknown>
  if (typeof partitionRecord.dt !== 'string' || !/^\d{8}$/u.test(partitionRecord.dt)) {
    throw new TypeError('data-aid loopback test authenticator partition.dt must be YYYYMMDD')
  }
  if (typeof partitionRecord.ht !== 'string' || !/^\d{2}$/u.test(partitionRecord.ht)) {
    throw new TypeError('data-aid loopback test authenticator partition.ht must be HH')
  }
}

/** Verify the Web bridge's fixed local-test origin and transient test secret. */
function isAuthorizedLoopbackRequest(request: Request, token: string): boolean {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return false
  }
  return url.protocol === 'http:'
    && url.hostname === DSH_WEB_INTERNAL_HOSTNAME
    && request.headers.get(LOOPBACK_TEST_TOKEN_HEADER) === token
}
