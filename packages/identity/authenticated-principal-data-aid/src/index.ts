/**
 * Data-aid gateway provider for the request-local authenticated Principal seam.
 * It verifies a deployment-owned gateway boundary, strictly parses the existing
 * visitor headers, and delegates identity/permission rules to an existing resolver.
 *
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid
 */

import { Context } from '@deepseek-ai/cordis'
import {
  AuthenticatedPrincipalService,
  freezeAuthenticatedPrincipal,
  PrincipalAuthenticationError,
} from '@deepseek-ai/dsh-authenticated-principal'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import { parseDataAidGatewayVisitor, DataAidVisitorError } from './visitor.ts'
import type {
  DataAidGatewayAuthenticatorOptions,
  DataAidGatewayVisitor,
  DataAidPrincipalResolution,
} from './types.ts'

export type {
  DataAidAuthorityPartition,
  DataAidAuthorityPartitionResolver,
  DataAidAuthorityQuery,
  DataAidMaxComputeMcpQueryOptions,
  DataAidGatewayAuthenticatorOptions,
  DataAidGatewayVerifier,
  DataAidGatewayVisitor,
  DataAidPrincipalResolution,
  DataAidPrincipalResolutionInput,
  DataAidPrincipalResolver,
  DataAidTablePrincipalResolverOptions,
} from './types.ts'
export { buildDataAidAuthoritySql, createDataAidTablePrincipalResolver } from './authority.ts'
export { createDataAidMaxComputeMcpQuery } from './maxcompute-mcp.ts'
export { DataAidVisitorError, parseDataAidGatewayVisitor } from './visitor.ts'
export { DataAidTurnPrincipalService } from './turn-principal.ts'
export {
  DATA_QUERY_TOOL_NAME,
  apply as applyDataAidQueryTool,
  buildRequest,
} from './data-query-tool.ts'
export type { Config as DataAidQueryToolConfig } from './data-query-tool.ts'
export {
  DATA_QUERY_HOLOGRES_TOOL_NAME,
  DATA_QUERY_MAXCOMPUTE_TOOL_NAME,
  apply as applyDataAidDirectQueryTools,
  serializeResult,
  validateReadOnlySql,
} from './direct-query-tools.ts'
export type { Config as DataAidDirectQueryToolsConfig } from './direct-query-tools.ts'

/**
 * Authenticated Principal provider backed by existing data-aid gateway and authority hooks.
 * The constructor requires both hooks so a deployment cannot silently trust a
 * caller-supplied forwarded header or accidentally make an unmapped user anonymous.
 */
export class DataAidGatewayAuthenticator extends AuthenticatedPrincipalService {
  private readonly options: DataAidGatewayAuthenticatorOptions

  /**
   * Register the provider and retain its deployment-owned hooks.
   * @param ctx - owning Cordis context.
   * @param options - gateway trust verifier and existing authority resolver.
   * @throws when either required hook is absent or not callable.
   */
  constructor(ctx: Context, options: DataAidGatewayAuthenticatorOptions) {
    super(ctx)
    const resolver = options?.resolver
    if (options === undefined
      || typeof options.verifyGatewayRequest !== 'function'
      || resolver === undefined
      || resolver === null
      || typeof resolver.resolve !== 'function') {
      throw new TypeError('data-aid authenticator requires verifyGatewayRequest and resolver.resolve')
    }
    this.options = options
  }

  /**
   * Authenticate one HTTP request through the supplied trust and authority hooks.
   * @param request - Fetch request carrying the gateway visitor headers.
   * @param signal - request cancellation signal passed to both hooks.
   * @returns immutable request-local Principal.
   * @throws {@link PrincipalAuthenticationError} for every authentication or mapping failure.
   */
  async authenticate(request: Request, signal: AbortSignal): Promise<AuthenticatedPrincipal> {
    let trusted: boolean
    try {
      trusted = await this.options.verifyGatewayRequest(request, signal)
    } catch (cause) {
      throw new PrincipalAuthenticationError({ cause })
    }
    if (!trusted) throw new PrincipalAuthenticationError()

    let visitor: DataAidGatewayVisitor
    try {
      visitor = parseDataAidGatewayVisitor(request)
    } catch (cause) {
      if (cause instanceof DataAidVisitorError) throw new PrincipalAuthenticationError({ cause })
      throw new PrincipalAuthenticationError({ cause })
    }

    let resolved: DataAidPrincipalResolution | undefined
    try {
      resolved = await this.options.resolver.resolve({ visitor, request, signal })
    } catch (cause) {
      throw new PrincipalAuthenticationError({ cause })
    }
    if (resolved === undefined) throw new PrincipalAuthenticationError()

    return freezeAuthenticatedPrincipal({
      ddUserId: visitor.ddUserId,
      ...(visitor.clientId === undefined ? {} : { clientId: visitor.clientId }),
      gkUserId: resolved.gkUserId,
      gimpStaffId: resolved.gimpStaffId,
      dataRole: resolved.dataRole,
      teamCodes: resolved.teamCodes,
      dataOrgCodes: resolved.dataOrgCodes,
      ...(resolved.authorizedScope === undefined ? {} : { authorizedScope: resolved.authorizedScope }),
    })
  }
}

export default DataAidGatewayAuthenticator
