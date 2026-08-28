/** Credentialed native-fetch DIC-BE provider for `ctx.dataQuery`. */

import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import {
  DataQueryError,
  type DataQueryContext,
  DataQueryProvider,
  DataQueryRequest,
  DataQueryResult,
  DataQueryValue,
} from '@deepseek-ai/dsh-data-query'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { DicBeDataQueryProviderOptions } from './types.ts'

/** Stable provider id selected by `DataQueryRuntime`. */
export const DIC_BE_DATA_QUERY_PROVIDER_ID = 'dic-be'
const TIMEOUT_CODE = 'DATA_QUERY_DIC_BE_TIMEOUT'
const MAX_ASSERTION_TTL_SECONDS = 60
const MAX_TIMEOUT_SECONDS = 30
const MAX_ROWS = 100
const MAX_RESULT_BYTES = 16_777_216
const MAX_COLUMN_CHARS = 64
const MAX_CELL_STRING_CHARS = 4_096
const MAX_CELL_DEPTH = 64
const MAX_CELL_NODES = 100_000
const ERROR_RESPONSE_KEYS = ['bizCode', 'code', 'data', 'msg'] as const

const KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u
const RESPONSE_KEYS = ['columns', 'complete', 'rowCount', 'rows', 'truncated'] as const
const encoder = new TextEncoder()

/** DIC-BE implementation of the controlled data-query capability. */
export class DicBeDataQueryProvider implements DataQueryProvider {
  readonly id = DIC_BE_DATA_QUERY_PROVIDER_ID
  private readonly endpoint: URL
  private readonly secret: Uint8Array

  /**
   * Retain validated deployment configuration.
   * @param options - endpoint, assertion key ring, deadline, and result limits.
   */
  constructor(private readonly options: DicBeDataQueryProviderOptions) {
    validateOptions(options)
    this.endpoint = resolveEndpoint(options.baseURL, options.path)
    const activeSecret = options.assertionKeyRing[options.assertionActiveKid]
    if (activeSecret === undefined) throw new TypeError('data-query-dic-be: assertionKeyRing must contain assertionActiveKid')
    this.secret = encoder.encode(activeSecret)
  }

  /** Validated configuration always makes this provider locally available. */
  available(): boolean {
    return true
  }

  /** Execute one credentialed semantic query without following redirects. */
  async query(
    request: DataQueryRequest,
    context: DataQueryContext,
    signal?: AbortSignal,
  ): Promise<DataQueryResult> {
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > this.options.maxRows) {
      throw new Error('data-query-dic-be: request limit violates maxRows')
    }
    using requestDeadline = deadline(signal, this.options.timeoutSeconds * 1000, TIMEOUT_CODE)
    if (requestDeadline.signal.aborted) throw translateFailure(requestDeadline.signal.reason, requestDeadline.signal)

    const assertion = await this.createAssertion(context)
    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'x-dsh-principal-assertion': assertion,
        },
        body: JSON.stringify({
          datasetCode: request.datasetCode,
          metricCodes: request.metricCodes,
          dimensionCodes: request.dimensionCodes,
          ...(request.filters === undefined ? {} : { filters: request.filters }),
          ...(request.timeRange === undefined ? {} : { timeRange: request.timeRange }),
          ...(request.orderBy === undefined ? {} : { orderBy: request.orderBy }),
          limit: request.limit,
        }),
        signal: requestDeadline.signal,
      })
    } catch (error: unknown) {
      throw translateFailure(error, requestDeadline.signal)
    }

    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`data-query-dic-be: request failed with HTTP ${response.status}`)
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
      await response.body?.cancel()
      throw new Error('data-query-dic-be: response must be application/json')
    }

    let raw: unknown
    try {
      raw = JSON.parse(await readCappedText(response, this.options.maxResultBytes)) as unknown
    } catch (error: unknown) {
      const cancellation = cancellationFailure(error, requestDeadline.signal)
      if (cancellation !== undefined) throw cancellation
      if (error instanceof Error && error.message.startsWith('data-query-dic-be:')) throw error
      throw new Error('data-query-dic-be: response is not valid JSON', { cause: error })
    }
    const rejectionCode = brokerRejectionCode(raw)
    if (rejectionCode !== undefined) {
      throw new DataQueryError('data-query-dic-be: broker rejected request', rejectionCode)
    }
    return validateResponse(raw, this.options)
  }

  /** Sign the exact short-lived claims accepted by the DIC-BE verifier. */
  private createAssertion(context: DataQueryContext): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({
      conversationId: context.conversationId,
      turnId: context.turnId,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: this.options.assertionActiveKid })
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setSubject(context.principalId)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + this.options.assertionTtlSeconds)
      .sign(this.secret)
  }
}

/**
 * Validate every deployment value and enforce protocol security ceilings.
 * @param options - untrusted direct-constructor or Loader configuration.
 * @returns by narrowing `options` to complete validated Provider configuration.
 */
function validateOptions(options: unknown): asserts options is DicBeDataQueryProviderOptions {
  if (!isRecord(options)) {
    throw new TypeError('data-query-dic-be: options are required')
  }
  const candidate = options as Partial<DicBeDataQueryProviderOptions>
  if (!validText(candidate.issuer, 128) || !validText(candidate.audience, 128)) {
    throw new TypeError('data-query-dic-be: issuer and audience must be normalized non-empty strings')
  }
  if (typeof candidate.assertionActiveKid !== 'string' || !KID_PATTERN.test(candidate.assertionActiveKid)) {
    throw new TypeError('data-query-dic-be: assertionActiveKid is invalid')
  }
  if (!isRecord(candidate.assertionKeyRing)) {
    throw new TypeError('data-query-dic-be: assertionKeyRing must contain assertionActiveKid')
  }
  const entries = Object.entries(candidate.assertionKeyRing)
  if (entries.length === 0 || !Object.hasOwn(candidate.assertionKeyRing, candidate.assertionActiveKid)) {
    throw new TypeError('data-query-dic-be: assertionKeyRing must contain assertionActiveKid')
  }
  for (const [kid, secret] of entries) {
    if (!KID_PATTERN.test(kid) || !strongSecret(secret)) {
      throw new TypeError('data-query-dic-be: assertionKeyRing contains an invalid key id or weak secret')
    }
  }
  if (!Number.isSafeInteger(candidate.assertionTtlSeconds)
    || (candidate.assertionTtlSeconds as number) < 1
    || (candidate.assertionTtlSeconds as number) > MAX_ASSERTION_TTL_SECONDS) {
    throw new TypeError(`data-query-dic-be: assertionTtlSeconds must be an integer from 1 to ${MAX_ASSERTION_TTL_SECONDS}`)
  }
  if (!Number.isFinite(candidate.timeoutSeconds)
    || (candidate.timeoutSeconds as number) <= 0
    || (candidate.timeoutSeconds as number) > MAX_TIMEOUT_SECONDS) {
    throw new TypeError(`data-query-dic-be: timeoutSeconds must be finite and no greater than ${MAX_TIMEOUT_SECONDS}`)
  }
  if (!Number.isSafeInteger(candidate.maxRows)
    || (candidate.maxRows as number) < 1
    || (candidate.maxRows as number) > MAX_ROWS) {
    throw new TypeError(`data-query-dic-be: maxRows must be an integer from 1 to ${MAX_ROWS}`)
  }
  if (!Number.isSafeInteger(candidate.maxResultBytes)
    || (candidate.maxResultBytes as number) < 1
    || (candidate.maxResultBytes as number) > MAX_RESULT_BYTES) {
    throw new TypeError(`data-query-dic-be: maxResultBytes must be an integer from 1 to ${MAX_RESULT_BYTES}`)
  }
  if (typeof candidate.baseURL !== 'string' || typeof candidate.path !== 'string') {
    throw new TypeError('data-query-dic-be: baseURL and path are required')
  }
  resolveEndpoint(candidate.baseURL, candidate.path)
}

/**
 * Resolve one fixed HTTP(S) endpoint without credentials, query, or fragment.
 * @param baseURL - configured HTTP(S) origin or base path.
 * @param path - absolute endpoint path on the same origin.
 * @returns fixed validated endpoint URL.
 */
function resolveEndpoint(baseURL: string, path: string): URL {
  let base: URL
  try {
    base = new URL(baseURL)
  } catch (error: unknown) {
    throw new TypeError('data-query-dic-be: baseURL must be an absolute HTTP(S) URL', { cause: error })
  }
  if ((base.protocol !== 'http:' && base.protocol !== 'https:')
    || base.username.length > 0
    || base.password.length > 0
    || base.search.length > 0
    || base.hash.length > 0) {
    throw new TypeError('data-query-dic-be: baseURL must be an absolute HTTP(S) URL without credentials, query, or fragment')
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('?') || path.includes('#')) {
    throw new TypeError('data-query-dic-be: path must be an absolute URL path without query or fragment')
  }
  const endpoint = new URL(path, base)
  if (endpoint.origin !== base.origin) throw new TypeError('data-query-dic-be: path must stay on the configured origin')
  return endpoint
}

/**
 * Read a complete UTF-8 response while rejecting documents beyond the byte limit.
 * @param response - successful JSON HTTP response.
 * @param maxBytes - maximum complete encoded body bytes.
 * @returns decoded complete response text.
 */
async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const chunks: string[] = []
  let totalBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) throw new Error(`data-query-dic-be: response exceeds ${maxBytes} UTF-8 bytes`)
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join('')
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/**
 * Validate the exact five-field DIC-BE response, finite cells, matrix, and complete bounds.
 * @param raw - parsed untrusted response JSON.
 * @param options - row and complete-result byte limits.
 * @returns detached complete data-query result.
 */
function validateResponse(
  raw: unknown,
  options: Pick<DicBeDataQueryProviderOptions, 'maxRows' | 'maxResultBytes'>,
): DataQueryResult {
  if (!isRecord(raw) || !sameKeys(raw, RESPONSE_KEYS)
    || raw.complete !== true
    || raw.truncated !== false
    || !Number.isSafeInteger(raw.rowCount)
    || !Array.isArray(raw.columns)
    || !Array.isArray(raw.rows)) {
    throw new Error('data-query-dic-be: incomplete or malformed response')
  }
  const columns: string[] = []
  for (const column of raw.columns) {
    if (!validText(column, MAX_COLUMN_CHARS)) throw new Error('data-query-dic-be: response violates result bounds')
    columns.push(column)
  }
  if (columns.length < 1 || columns.length > 64 || new Set(columns).size !== columns.length
    || raw.rowCount !== raw.rows.length || raw.rows.length > options.maxRows) {
    throw new Error('data-query-dic-be: response violates result bounds')
  }
  const rows: DataQueryValue[][] = []
  for (const rawRow of raw.rows) {
    if (!Array.isArray(rawRow) || rawRow.length !== columns.length || !rawRow.every(isFiniteJsonValue)) {
      throw new Error('data-query-dic-be: response violates result bounds')
    }
    rows.push(rawRow.map(cell => cell))
  }
  const result: DataQueryResult = {
    columns,
    rows,
    rowCount: raw.rowCount,
    complete: true,
    truncated: false,
  }
  if (encoder.encode(JSON.stringify(result)).byteLength > options.maxResultBytes) {
    throw new Error('data-query-dic-be: normalized result exceeds maxResultBytes')
  }
  return result
}

/** Translate caller cancellation, provider timeout, redirect refusal, and network failures. */
function translateFailure(error: unknown, signal: AbortSignal): Error {
  if (timeoutOf(signal, TIMEOUT_CODE) !== undefined) return new Error('data-query-dic-be: request timed out', { cause: error })
  if (signal.aborted) return new Error('data-query-dic-be: request aborted', { cause: error })
  return new Error('data-query-dic-be: request failed', { cause: error })
}

/** Return a translated cancellation only when the operation signal aborted. */
function cancellationFailure(error: unknown, signal: AbortSignal): Error | undefined {
  return signal.aborted ? translateFailure(error, signal) : undefined
}

/** Accept one bounded recursive finite JSON value from the strict DIC-BE result DTO. */
function isFiniteJsonValue(root: unknown): root is DataQueryValue {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: root, depth: 0 }]
  let nodes = 0
  try {
    for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
      nodes++
      if (nodes > MAX_CELL_NODES || item.depth > MAX_CELL_DEPTH) return false
      const value = item.value
      if (value === null || typeof value === 'boolean') continue
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0)) return false
        continue
      }
      if (typeof value === 'string') {
        if (value.length > MAX_CELL_STRING_CHARS) return false
        continue
      }
      if (Array.isArray(value)) {
        const keys = Reflect.ownKeys(value)
        if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') return false
        for (let index = value.length - 1; index >= 0; index--) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
          if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) return false
          pending.push({ value: descriptor.value, depth: item.depth + 1 })
        }
        continue
      }
      if (!isRecord(value)) return false
      const prototype = Reflect.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) return false
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const keys = Reflect.ownKeys(value)
      if (!keys.every(key => typeof key === 'string')) return false
      for (const key of keys) {
        const descriptor = descriptors[key]
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) return false
        pending.push({ value: descriptor.value, depth: item.depth + 1 })
      }
    }
  } catch {
    return false
  }
  return true
}

/** Require normalized non-control text within the protocol's character limit. */
function validText(value: unknown, maxChars: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxChars
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

/** Require a non-placeholder HS256 secret with at least 32 UTF-8 bytes. */
function strongSecret(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || encoder.encode(value).byteLength < 32) return false
  const lowered = value.toLowerCase()
  return new Set(value).size >= 8
    && !value.includes('<')
    && !/(?:change[-_ ]?me|placeholder|replace[-_ ]?with|example[-_ ]?only|dummy[-_ ]?secret)/u.test(lowered)
}

/** Accept only plain JSON objects, not arrays or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require exactly the declared own keys, independent of input order. */
function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key))
}

export { readCappedText, resolveEndpoint, validateOptions, validateResponse }

/** Return one stable DIC-BE business rejection code from its exact unified envelope. */
function brokerRejectionCode(raw: unknown): string | undefined {
  if (!isRecord(raw) || !sameKeys(raw, ERROR_RESPONSE_KEYS)
    || raw.code !== 200
    || typeof raw.bizCode !== 'string'
    || !/^DQ_[A-Z0-9_]{1,61}$/u.test(raw.bizCode)
    || typeof raw.msg !== 'string'
    || !isRecord(raw.data)
    || Object.keys(raw.data).length !== 0) return undefined
  return raw.bizCode
}
