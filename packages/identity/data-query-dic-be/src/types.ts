/** Configuration vocabulary for the DIC-BE data-query provider. */

/** Complete validated provider options. */
export interface DicBeDataQueryProviderOptions {
  /** DIC-BE HTTP origin or base path. */
  readonly baseURL: string
  /** Absolute URL path below `baseURL` receiving semantic queries. */
  readonly path: string
  /** JWT assertion issuer. */
  readonly issuer: string
  /** JWT assertion audience. */
  readonly audience: string
  /** Shared HS256 assertion secret. */
  readonly assertionSecret: string
  /** Assertion lifetime in whole seconds. */
  readonly assertionTtlSeconds: number
  /** Complete request deadline in whole seconds. */
  readonly timeoutSeconds: number
  /** Maximum complete result rows accepted from DIC-BE. */
  readonly maxRows: number
  /** Maximum characters in both the HTTP JSON document and normalized result. */
  readonly maxResultChars: number
}
