/** Credentialed native-fetch DIC-BE provider for `ctx.dataQuery`. */

import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import type { DataQueryProvider, DataQueryRequest, DataQueryResult, DataQueryValue } from '@deepseek-ai/dsh-data-query'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { DicBeDataQueryProviderOptions } from './types.ts'

/** Stable provider id selected by `DataQueryRuntime`. */
export const DIC_BE_DATA_QUERY_PROVIDER_ID = 'dic-be'
const TIMEOUT_CODE = 'DATA_QUERY_DIC_BE_TIMEOUT'

/** HTTP response required from DIC-BE before normalization. */
interface DicBeResponse {
  readonly success: true
  readonly complete: true
  readonly truncated: false
  readonly rowCount: number
  readonly rowsReturned: number
  readonly columns: string[]
  readonly rows: DataQueryValue[][]
}

/** DIC-BE implementation of the controlled data-query capability. */
export class DicBeDataQueryProvider implements DataQueryProvider {
  readonly id = DIC_BE_DATA_QUERY_PROVIDER_ID
  private readonly endpoint: URL
  private readonly secret: Uint8Array

  /**
   * Retain validated deployment configuration.
   * @param options - endpoint, assertion, deadline, and result limits.
   */
  constructor(private readonly options: DicBeDataQueryProviderOptions) {
    this.endpoint = resolveEndpoint(options.baseURL, options.path)
    this.secret = new TextEncoder().encode(options.assertionSecret)
  }

  /** Validated configuration always makes this provider locally available. */
  available(): boolean {
    return true
  }

  /** Execute one credentialed semantic query without following redirects. */
  async query(request: DataQueryRequest, signal?: AbortSignal): Promise<DataQueryResult> {
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > this.options.maxRows) {
      throw new Error('data-query-dic-be: request limit violates maxRows')
    }
    using requestDeadline = deadline(signal, this.options.timeoutSeconds * 1000, TIMEOUT_CODE)
    if (requestDeadline.signal.aborted) throw translateFailure(requestDeadline.signal.reason, requestDeadline.signal)

    const assertion = await this.createAssertion(request)
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
      raw = JSON.parse(await readCappedText(response, this.options.maxResultChars)) as unknown
    } catch (error: unknown) {
      if (requestDeadline.signal.aborted) throw translateFailure(error, requestDeadline.signal)
      if (error instanceof Error && error.message.startsWith('data-query-dic-be:')) throw error
      throw new Error('data-query-dic-be: response is not valid JSON', { cause: error })
    }
    return validateResponse(raw, this.options)
  }

  /** Sign one short-lived assertion over host-owned Principal facts. */
  private createAssertion(request: DataQueryRequest): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({ dataRoles: [request.principal.dataRole] })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setSubject(request.principal.gkUserId)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + this.options.assertionTtlSeconds)
      .sign(this.secret)
  }
}

/** Resolve one fixed HTTP(S) endpoint without accepting credentials or an absolute path override. */
function resolveEndpoint(baseURL: string, path: string): URL {
  let base: URL
  try {
    base = new URL(baseURL)
  } catch (error: unknown) {
    throw new TypeError('data-query-dic-be: baseURL must be an absolute HTTP(S) URL', { cause: error })
  }
  if ((base.protocol !== 'http:' && base.protocol !== 'https:') || base.username.length > 0 || base.password.length > 0) {
    throw new TypeError('data-query-dic-be: baseURL must be an absolute HTTP(S) URL without credentials')
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new TypeError('data-query-dic-be: path must be an absolute URL path')
  }
  return new URL(path, base)
}

/** Read a complete UTF-8 response while rejecting documents beyond the configured character limit. */
async function readCappedText(response: Response, maxChars: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const chunks: string[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const decoded = decoder.decode(value, { stream: true })
      total += decoded.length
      if (total > maxChars) throw new Error(`data-query-dic-be: response exceeds ${maxChars} characters`)
      chunks.push(decoded)
    }
    const tail = decoder.decode()
    total += tail.length
    if (total > maxChars) throw new Error(`data-query-dic-be: response exceeds ${maxChars} characters`)
    chunks.push(tail)
    return chunks.join('')
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Validate complete DIC-BE metadata, rectangular rows, and deployment bounds. */
function validateResponse(raw: unknown, options: Pick<DicBeDataQueryProviderOptions, 'maxRows' | 'maxResultChars'>): DataQueryResult {
  if (!isRecord(raw)
    || raw.success !== true
    || raw.complete !== true
    || raw.truncated !== false
    || !Number.isSafeInteger(raw.rowCount)
    || !Number.isSafeInteger(raw.rowsReturned)
    || !Array.isArray(raw.columns)
    || !Array.isArray(raw.rows)) {
    throw new Error('data-query-dic-be: incomplete or malformed response')
  }
  const response = raw as unknown as DicBeResponse
  if (!response.columns.every(column => typeof column === 'string')
    || response.rowCount !== response.rows.length
    || response.rowsReturned !== response.rows.length
    || response.rows.length > options.maxRows
    || !response.rows.every(row => Array.isArray(row) && row.length === response.columns.length)) {
    throw new Error('data-query-dic-be: response violates result bounds')
  }
  const result: DataQueryResult = { columns: response.columns, rows: response.rows }
  if (JSON.stringify(result).length > options.maxResultChars) {
    throw new Error('data-query-dic-be: normalized result exceeds maxResultChars')
  }
  return result
}

/** Translate caller cancellation, provider timeout, redirect refusal, and network failures without credentials. */
function translateFailure(error: unknown, signal: AbortSignal): Error {
  if (timeoutOf(signal, TIMEOUT_CODE) !== undefined) return new Error('data-query-dic-be: request timed out', { cause: error })
  if (signal.aborted) return new Error('data-query-dic-be: request aborted', { cause: error })
  return new Error('data-query-dic-be: request failed', { cause: error })
}

/** Narrow an untrusted JSON document to an object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export { readCappedText, resolveEndpoint, validateResponse }
