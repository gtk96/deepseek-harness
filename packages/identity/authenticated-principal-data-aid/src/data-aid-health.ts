/**
 * Health routes for the closed data-aid HTTP carrier.
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid/data-aid-health
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Deployment paths for Kubernetes HTTP probes. */
export interface Config {
  /** Exact process-liveness path. */
  readonly livePath: string
  /** Exact composition-readiness path. */
  readonly readyPath: string
}

/** Loader schema for health route paths. */
export const Config: z<Config> = z.object({
  livePath: z.string().required(),
  readyPath: z.string().required(),
})

/** Cordis loader name. */
export const name = 'data-aid-health'

/** The dedicated WebServer must be listening before health routes register. */
export const inject = ['webServer']

/**
 * Register process and completed-composition health endpoints.
 * @param ctx - closed data-aid host context.
 * @param config - distinct exact health paths.
 */
export function apply(ctx: Context, config: Config): void {
  validatePath(config.livePath, 'livePath')
  validatePath(config.readyPath, 'readyPath')
  if (config.livePath === config.readyPath) throw new TypeError('data-aid health paths must be distinct')

  for (const [path, status] of [[config.livePath, 'live'], [config.readyPath, 'ready']] as const) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler(request, response) {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' })
          response.end()
          return
        }
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/json',
        })
        response.end(JSON.stringify({ status }))
      },
    }), `data-aid-health: ${status}`)
  }
}

function validatePath(value: string, field: string): void {
  if (!value.startsWith('/') || value === '/' || value.endsWith('/')
    || value.includes('?') || value.includes('#') || value.includes('\\')) {
    throw new TypeError(`data-aid health ${field} must be one absolute non-root path`)
  }
}
