/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-authenticated-principal-data-aid`.
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-authenticated-principal-data-aid'

/** Cordis companion plugin name. */
export const name = 'authenticated-principal-data-aid-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: this provider delegates authority facts and owns no independent durable relation. */
const install: InvariantInstaller = () => {}

/**
 * Register the data-aid Principal provider invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
