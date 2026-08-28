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
  /** Shared HS256 keys indexed by JWT `kid`; retained keys support coordinated rotation. */
  readonly assertionKeyRing: Readonly<Record<string, string>>
  /** Key id used to sign new assertions. */
  readonly assertionActiveKid: string
  /** Assertion lifetime in whole seconds, at most 60. */
  readonly assertionTtlSeconds: number
  /** Complete request deadline in seconds, at most 30. */
  readonly timeoutSeconds: number
  /** Maximum complete result rows accepted from DIC-BE, at most 100. */
  readonly maxRows: number
  /** Maximum UTF-8 bytes in both the HTTP JSON document and normalized result. */
  readonly maxResultBytes: number
}
