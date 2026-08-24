/** Public Principal vocabulary shared by authentication providers and Consumers. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** DingTalk user id emitted by the trusted gateway's decoded `id` field. */
export type DdUserId = Branded<'DdUserId'>
/** GK user id resolved by the existing data-aid identity mapping. */
export type GkUserId = Branded<'GkUserId'>
/** GIMP staff id resolved by the existing data-aid identity mapping. */
export type GimpStaffId = Branded<'GimpStaffId'>
/** Optional application/client id emitted by the gateway's decoded `clientId` field. */
export type DataAidClientId = Branded<'DataAidClientId'>
/** Existing data-aid role value; the resolver owns its vocabulary and meaning. */
export type DataRole = Branded<'DataRole'>
/** Existing data-aid team scope code. */
export type TeamCode = Branded<'TeamCode'>
/** Existing data-aid organization scope code. */
export type DataOrgCode = Branded<'DataOrgCode'>

/** Opaque provider-owned authorization data retained for future query Consumers. */
export type AuthenticatedPrincipalScope = Readonly<Record<string, unknown>>

/**
 * Immutable request-local account and data-authorization facts.
 *
 * The permission fields are the resolver's existing data-aid result. DSH does
 * not derive, widen, or persist them, and model/tool wire arguments cannot
 * replace them.
 */
export interface AuthenticatedPrincipal {
  /** Original DingTalk id from the trusted gateway visitor record. */
  readonly ddUserId: DdUserId
  /** Optional gateway application id. */
  readonly clientId?: DataAidClientId
  /** Mapped GK user id (`gk_userid` in data-aid). */
  readonly gkUserId: GkUserId
  /** Mapped GIMP staff id (`gimp_staff_id` in data-aid). */
  readonly gimpStaffId: GimpStaffId
  /** Existing `data_role` value, unchanged from the resolver result. */
  readonly dataRole: DataRole
  /** Existing `team_codes` values, unchanged from the resolver result. */
  readonly teamCodes: readonly TeamCode[]
  /** Existing `data_org_code` values, unchanged from the resolver result. */
  readonly dataOrgCodes: readonly DataOrgCode[]
  /** Optional opaque authorized scope supplied by the deployment resolver. */
  readonly authorizedScope?: AuthenticatedPrincipalScope
}

/** Provider contract that authenticates one transport request into a Principal. */
export interface PrincipalAuthenticator {
  /**
   * Authenticate one request without persisting the resulting Principal.
   * @param request - transport request whose trusted identity is being checked.
   * @param signal - request cancellation signal.
   * @returns the fully resolved Principal.
   * @throws {@link PrincipalAuthenticationError} when authentication fails.
   */
  authenticate(request: Request, signal: AbortSignal): Promise<AuthenticatedPrincipal>
}
