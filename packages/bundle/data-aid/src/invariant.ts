/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-data-aid`.
 * @module @deepseek-ai/dsh-data-aid/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-data-aid'

/** Cordis companion plugin name. */
export const name = 'data-aid-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: this package is a static patch-list carrier. Each row's
// owning package checks its service, event, and registry relationships.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
