/** Package-owned invariant companion for `@deepseek-ai/dsh-data-query-dic-be`. @module @deepseek-ai/dsh-data-query-dic-be/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-data-query-dic-be'

/** Cordis companion plugin name. */
export const name = 'data-query-dic-be-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: HTTP exchanges are operation-local and provider registration is owned by the data-query runtime. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
