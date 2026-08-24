/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-authenticated-principal`.
 * @module @deepseek-ai/dsh-authenticated-principal/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-authenticated-principal'

/** Cordis companion plugin name. */
export const name = 'authenticated-principal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the Principal is request-local ALS state, not a durable event or public mutable relation. */
const install: InvariantInstaller = () => {}

/**
 * Register the authenticated Principal invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
