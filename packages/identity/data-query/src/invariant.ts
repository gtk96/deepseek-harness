/** Package-owned invariant companion for `@deepseek-ai/dsh-data-query`. @module @deepseek-ai/dsh-data-query/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-data-query'

/** Cordis companion plugin name. */
export const name = 'data-query-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: provider registrations are private effects with no independent event or
 * projection; each query reads the authoritative map and applies selection before dispatch.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
