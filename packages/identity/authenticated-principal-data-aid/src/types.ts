/** Data-aid gateway and existing permission-resolver contracts. */

import type {
  AuthenticatedPrincipalScope,
  DataAidClientId,
  DataOrgCode,
  DataRole,
  DdUserId,
  GimpStaffId,
  GkUserId,
  TeamCode,
} from '@deepseek-ai/dsh-authenticated-principal'
import type { DataQueryConversationId, DataQueryTurnId } from '@deepseek-ai/dsh-data-query'

/** Identity parsed from the trusted MSE/data-aid gateway visitor headers. */
export interface DataAidGatewayVisitor {
  /** Decoded `gk-service-user.id`, exposed to DSH as `ddUserId`. */
  readonly ddUserId: DdUserId
  /** Optional decoded `gk-service-app.clientId`. */
  readonly clientId?: DataAidClientId
}

/** Permission and mapped identity facts returned by the existing data-aid authority. */
export interface DataAidPrincipalResolution {
  /** Existing mapping result `gk_userid`. */
  readonly gkUserId: GkUserId
  /** Existing mapping result `gimp_staff_id`. */
  readonly gimpStaffId: GimpStaffId
  /** Existing `data_role` value. */
  readonly dataRole: DataRole
  /** Existing `team_codes` values. */
  readonly teamCodes: readonly TeamCode[]
  /** Existing `data_org_code` values. */
  readonly dataOrgCodes: readonly DataOrgCode[]
  /** Optional opaque scope returned by the deployment authority. */
  readonly authorizedScope?: AuthenticatedPrincipalScope
}

/** Input supplied to the deployment-owned resolver without copying wire arguments. */
export interface DataAidPrincipalResolutionInput {
  /** Parsed gateway identity. */
  readonly visitor: DataAidGatewayVisitor
  /** Original Fetch request, available only to the provider/resolver boundary. */
  readonly request: Request
  /** Request cancellation signal. */
  readonly signal: AbortSignal
}

/** One explicit MaxCompute partition used by the identity and authority snapshots. */
export interface DataAidAuthorityPartition {
  /** Calendar date partition in `YYYYMMDD` form. */
  readonly dt: string
  /** Hour partition in `HH` form. */
  readonly ht: string
}

/**
 * Query transport supplied by the deployment for the fixed authority SQL.
 * It must return the complete result set, including both rows when the SQL limit is reached.
 */
export type DataAidAuthorityQuery = (
  sql: string,
  signal: AbortSignal,
) => Promise<readonly unknown[]>

/** Select the identity and authority snapshot partition for one request. */
export type DataAidAuthorityPartitionResolver = (
  input: DataAidPrincipalResolutionInput,
) => DataAidAuthorityPartition | Promise<DataAidAuthorityPartition>

/** Deployment settings for the direct synchronous MaxCompute MCP SELECT call. */
export interface DataAidMaxComputeMcpQueryOptions {
  /** Connected MCP registry namespace for the MaxCompute server. */
  readonly serverName: string
  /** Raw MCP tool name for the synchronous MaxCompute SELECT operation. */
  readonly toolName: string
  /** MaxCompute project that owns the confirmed authority tables. */
  readonly project: string
  /** Maximum compute-unit budget submitted with the SELECT operation. */
  readonly maxCU: number
  /** Synchronous tool-call timeout in seconds. */
  readonly timeoutSeconds: number
}

/** Hooks required by the concrete MaxCompute table-backed resolver. */
export interface DataAidTablePrincipalResolverOptions {
  /** Execute the supplied read-only SQL and return its raw result rows. */
  readonly query: DataAidAuthorityQuery
  /** Select an explicit `dt`/`ht` snapshot without an implicit table scan. */
  readonly resolvePartition: DataAidAuthorityPartitionResolver
}

/** Resolver seam for the existing data-aid identity and authority SQL/service. */
export interface DataAidPrincipalResolver {
  /**
   * Resolve the complete existing data-aid permission result.
   * @param input - trusted visitor plus transport-local request metadata.
   * @returns resolved facts, or `undefined` when mapping/authority is unavailable.
   */
  resolve(input: DataAidPrincipalResolutionInput): DataAidPrincipalResolution | undefined | Promise<DataAidPrincipalResolution | undefined>
}

/** Deployment-owned proof that the Fetch request came through the trusted gateway. */
export type DataAidGatewayVerifier = (
  request: Request,
  signal: AbortSignal,
) => boolean | Promise<boolean>

/** Required hooks for the data-aid Principal provider. */
export interface DataAidGatewayAuthenticatorOptions {
  /** Verify the network/proxy boundary before reading identity headers. */
  readonly verifyGatewayRequest: DataAidGatewayVerifier
  /** Call the existing identity mapping and permission authority. */
  readonly resolver: DataAidPrincipalResolver
}

/** Principal and business identifiers supplied only by a trusted DSH turn-ingress adapter. */
export interface DataAidTrustedTurnBinding {
  /** Stable authenticated user id supplied by dic-be after service authentication. */
  readonly principalId: GkUserId
  /** Opaque dic-be conversation id. */
  readonly conversationId: DataQueryConversationId
  /** Opaque dic-be turn id. */
  readonly turnId: DataQueryTurnId
}

/** Business ids paired with a request-local Principal by legacy authenticated transports. */
export type DataAidTrustedTurnIds = Omit<DataAidTrustedTurnBinding, 'principalId'>
