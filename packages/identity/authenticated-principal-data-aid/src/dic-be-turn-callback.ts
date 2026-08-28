/**
 * Model-hidden DIC-BE turn lifecycle callback protocol.
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid/dic-be-turn-callback
 */

import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { DataAidTrustedTurnBinding } from './types.ts'

const CALLBACK_RESPONSE_KEYS = ['accepted'] as const
const RESULT_KEYS = ['columns', 'complete', 'rowCount', 'rows', 'truncated'] as const
const encoder = new TextEncoder()
const DENIED_CODES = new Set(['DQ_POLICY_DENIED', 'DQ_SEMANTIC_INVALID', 'DQ_TURN_BINDING_MISMATCH'])
const SENSITIVE_PATTERNS = [
  /\bLTAI[A-Za-z0-9]{12,}\b/u,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]/iu,
  /\bbearer\s+[A-Z0-9._~+/=-]+/iu,
  /\b(?:access[_-]?key[_-]?(?:id|secret)|secret[_-]?access[_-]?key|ak|sk)\s*[:=]\s*['"]?[A-Z0-9/+_.=-]{8,}/iu,
  /\bselect\b.{0,512}\bfrom\b/isu,
  /\binsert\s+into\b/iu,
  /\bupdate\b.{0,256}\bset\b/isu,
  /\bdelete\s+from\b/iu,
  /\b(?:create|alter|drop|truncate)\s+(?:table|view|database)\b/iu,
]

/** Callback settings retained by the ingress lifecycle owner. */
export interface TurnCallbackConfig {
  /** Fixed broker callback URL on the trusted service network. */
  readonly callbackURL: string
  /** Fixed DSH workload identity required by DIC-BE. */
  readonly callbackServiceIdentity: string
  /** Bearer credential supplied by the deployment secret store. */
  readonly callbackServiceToken: string
  /** Per-attempt callback deadline in milliseconds. */
  readonly callbackTimeoutMs: number
  /** Number of sequential delivery attempts. */
  readonly callbackMaxAttempts: number
  /** Delay between callback attempts in milliseconds. */
  readonly callbackRetryDelayMs: number
  /** Maximum complete callback JSON bytes. */
  readonly callbackMaxBodyBytes: number
  /** Maximum answer characters sent to DIC-BE. */
  readonly callbackMaxAnswerChars: number
}

/** Complete trusted dispatch retained only in process memory. */
export interface TrackedDicBeTurn {
  readonly binding: DataAidTrustedTurnBinding
  readonly question: string
  /** Trusted semantic catalog projection supplied only by DIC-BE dispatch. */
  readonly semanticCatalog?: string
}

/** Strict DIC-BE lifecycle callback body. */
export type TurnCallbackBody = {
  readonly principal: string
  readonly conversationId: string
  readonly turnId: string
} & (
  | { readonly status: 'running' }
  | { readonly status: 'succeeded'; readonly answer?: string; readonly result?: ControlledResult }
  | { readonly status: 'denied' | 'failed' | 'timed_out'; readonly answer?: string; readonly errorCode: string }
)

/** Browser-safe result subset persisted by DIC-BE. */
export interface ControlledResult {
  readonly columns: string[]
  readonly rows: Array<Array<string | number | boolean | null>>
  readonly rowCount: number
}

/** Fixed-auth callback sender with bounded retry and no response reflection. */
export class DicBeTurnCallbackClient {
  private readonly endpoint: URL
  private readonly controllers = new Set<AbortController>()
  private readonly pending = new Set<Promise<void>>()
  private disposed = false

  /**
   * Validate and retain deployment-owned callback settings.
   * @param config - fixed endpoint, identity, credential, deadlines, and bounds.
   */
  constructor(private readonly config: TurnCallbackConfig) {
    this.endpoint = validateCallbackConfig(config)
  }

  /**
   * Deliver one strict callback and require the exact acknowledgement.
   * @param body - model-hidden trusted binding plus lifecycle projection.
   * @returns after DIC-BE durably accepts the state.
   */
  send(body: TurnCallbackBody): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('data-aid turn callback client is disposed'))
    const operation = this.deliver(body)
    this.pending.add(operation)
    void operation.finally(() => { this.pending.delete(operation) }).catch(() => {})
    return operation
  }

  /** Abort active HTTP attempts and wait for all retry loops to settle. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
    await Promise.allSettled(this.pending)
  }

  /** Deliver one bounded callback with sequential retries. */
  private async deliver(body: TurnCallbackBody): Promise<void> {
    const json = JSON.stringify(body)
    if (encoder.encode(json).byteLength > this.config.callbackMaxBodyBytes) {
      throw new Error('data-aid turn callback body exceeds configured limit')
    }
    let lastFailure: unknown
    for (let attempt = 1; attempt <= this.config.callbackMaxAttempts; attempt++) {
      try {
        await this.sendOnce(json)
        return
      } catch (error: unknown) {
        lastFailure = error
        if (this.disposed) break
        if (attempt < this.config.callbackMaxAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.config.callbackRetryDelayMs))
        }
      }
    }
    throw new Error('data-aid turn callback was not accepted', { cause: lastFailure })
  }

  /** Deliver one callback attempt under an independent deadline. */
  private async sendOnce(json: string): Promise<void> {
    const timeout = new AbortController()
    this.controllers.add(timeout)
    const timer = setTimeout(() => { timeout.abort() }, this.config.callbackTimeoutMs)
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.config.callbackServiceToken}`,
          'content-type': 'application/json',
          'x-dsh-service-identity': this.config.callbackServiceIdentity,
        },
        body: json,
        signal: timeout.signal,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('data-aid turn callback received a rejection')
      }
      const text = await response.text()
      if (encoder.encode(text).byteLength > 64) throw new Error('data-aid turn callback acknowledgement is oversized')
      let raw: unknown
      try {
        raw = JSON.parse(text) as unknown
      } catch (error: unknown) {
        throw new Error('data-aid turn callback acknowledgement is invalid', { cause: error })
      }
      if (!isRecord(raw) || !sameKeys(raw, CALLBACK_RESPONSE_KEYS) || raw.accepted !== true) {
        throw new Error('data-aid turn callback acknowledgement is invalid')
      }
    } finally {
      clearTimeout(timer)
      this.controllers.delete(timeout)
    }
  }
}

/**
 * Reject a question that would place a business id or credential/SQL pattern in Session/model input.
 * @param turn - trusted binding and proposed model-visible question.
 * @returns after the question passes the model-input safety gate.
 */
export function assertSafeTurnInput(turn: TrackedDicBeTurn): void {
  if (containsSensitiveText(turn.question)
    || [turn.binding.principalId, turn.binding.conversationId, turn.binding.turnId]
      .some(value => turn.question.includes(value))) {
    throw new TypeError('data-aid turn question contains forbidden service or business data')
  }
}

/**
 * Build the terminal callback only from one bound DSH turn's durable events.
 * @param turn - process-memory binding never read from the Session.
 * @param session - exact Agent Session that emitted the ending.
 * @param turnNumber - internal DSH turn number.
 * @param reason - durable ending reason.
 * @param maxAnswerChars - deployment answer bound.
 * @returns strict terminal body without Session or transport metadata.
 */
export function buildTerminalCallback(
  turn: TrackedDicBeTurn,
  session: Session,
  turnNumber: number,
  reason: TurnEndReason,
  maxAnswerChars: number,
): TurnCallbackBody {
  const prefix = callbackPrefix(turn.binding)
  const answer = extractAnswer(session.events, turnNumber, maxAnswerChars)
  const query = extractQueryOutcome(session.events, turnNumber)
  if ((answer !== undefined && !safeProjection(answer, turn.binding))
    || (query.result !== undefined && !safeProjection(query.result, turn.binding))) {
    return { ...prefix, status: 'failed', errorCode: 'DQ_AGENT_FAILED' }
  }
  if (reason.kind === 'blocked') return { ...prefix, status: 'denied', ...(answer === undefined ? {} : { answer }), errorCode: 'DQ_POLICY_DENIED' }
  if (query.errorCode !== undefined) {
    if (DENIED_CODES.has(query.errorCode)) {
      return { ...prefix, status: 'denied', ...(answer === undefined ? {} : { answer }), errorCode: query.errorCode }
    }
    if (query.errorCode.includes('TIMEOUT')) {
      return { ...prefix, status: 'timed_out', ...(answer === undefined ? {} : { answer }), errorCode: 'DQ_QUERY_TIMEOUT' }
    }
    return { ...prefix, status: 'failed', ...(answer === undefined ? {} : { answer }), errorCode: 'DQ_AGENT_FAILED' }
  }
  if (reason.kind !== 'completed') {
    return { ...prefix, status: 'failed', ...(answer === undefined ? {} : { answer }), errorCode: 'DQ_AGENT_FAILED' }
  }
  return {
    ...prefix,
    status: 'succeeded',
    ...(answer === undefined ? {} : { answer }),
    ...(query.result === undefined ? {} : { result: query.result }),
  }
}

/**
 * Build one running callback from process-memory binding only.
 * @param binding - trusted Principal and external turn identity.
 * @returns callback body reporting that the accepted turn is running.
 */
export function buildRunningCallback(binding: DataAidTrustedTurnBinding): TurnCallbackBody {
  return { ...callbackPrefix(binding), status: 'running' }
}

/** Build the identity prefix without reading Session data. */
function callbackPrefix(binding: DataAidTrustedTurnBinding): Pick<TurnCallbackBody, 'principal' | 'conversationId' | 'turnId'> {
  return {
    principal: binding.principalId,
    conversationId: binding.conversationId,
    turnId: binding.turnId,
  }
}

/** Extract the final assistant text only, excluding reasoning and tool calls. */
function extractAnswer(events: readonly SessionEvent[], turn: number, maxChars: number): string | undefined {
  const message = events.findLast(event => event.type === 'assistant/message' && event.data.turn === turn)
  if (message?.type !== 'assistant/message') return undefined
  const text = message.data.message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  return normalizedText(text, maxChars) ? text : undefined
}

/** Extract only a successful data_query table or its stable internal error code. */
function extractQueryOutcome(
  events: readonly SessionEvent[],
  turn: number,
): { readonly result?: ControlledResult; readonly errorCode?: string } {
  const calls = new Set(events
    .filter(event => event.type === 'tool/call' && event.data.turn === turn && event.data.name === 'data_query')
    .map(event => event.type === 'tool/call' ? String(event.data.callId) : ''))
  const event = events.findLast(candidate => candidate.type === 'tool/result'
    && candidate.data.turn === turn
    && calls.has(String(candidate.data.message.source.callId)))
  if (event?.type !== 'tool/result') return {}
  if (event.data.error !== undefined) return { errorCode: stableErrorCode(event.data.error.code) }
  const block = event.data.message.content[0]
  if (block.isError || block.content.length !== 1 || block.content[0]?.type !== 'text') {
    return { errorCode: 'DQ_AGENT_FAILED' }
  }
  try {
    const result = parseControlledResult(JSON.parse(block.content[0].text) as unknown)
    return result === undefined ? { errorCode: 'DQ_AGENT_FAILED' } : { result }
  } catch {
    return { errorCode: 'DQ_AGENT_FAILED' }
  }
}

/** Preserve only bounded stable error identifiers; unknown diagnostics become generic. */
function stableErrorCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) ? value : 'DQ_AGENT_FAILED'
}

/** Normalize the five-field tool result into the three-field browser projection. */
function parseControlledResult(raw: unknown): ControlledResult | undefined {
  if (!isRecord(raw) || !sameKeys(raw, RESULT_KEYS) || raw.complete !== true || raw.truncated !== false
    || !Array.isArray(raw.columns) || !Array.isArray(raw.rows) || !Number.isSafeInteger(raw.rowCount)
    || raw.rowCount !== raw.rows.length || raw.columns.length === 0) return undefined
  const columns: string[] = []
  for (const column of raw.columns) {
    if (typeof column !== 'string' || !normalizedText(column, 64)) return undefined
    columns.push(column)
  }
  if (new Set(columns).size !== columns.length) return undefined
  const rows: ControlledResult['rows'] = []
  for (const row of raw.rows) {
    if (!Array.isArray(row) || row.length !== columns.length) return undefined
    const cells: ControlledResult['rows'][number] = []
    for (const cell of row) {
      if (!isScalar(cell)) return undefined
      cells.push(cell)
    }
    rows.push(cells)
  }
  return { columns, rows, rowCount: raw.rowCount }
}

/** Require a callback value to contain neither known secret patterns nor exact binding values. */
function safeProjection(value: unknown, binding: DataAidTrustedTurnBinding): boolean {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return !containsSensitiveText(text)
    && ![binding.principalId, binding.conversationId, binding.turnId].some(id => text.includes(id))
}

/** Detect high-confidence credentials, authentication material, and raw SQL. */
function containsSensitiveText(value: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(value))
}

/** Validate one callback endpoint and all deployment tunables. */
function validateCallbackConfig(config: TurnCallbackConfig): URL {
  let endpoint: URL
  try {
    endpoint = new URL(config.callbackURL)
  } catch (error: unknown) {
    throw new TypeError('data-aid turn callback URL must be absolute HTTP(S)', { cause: error })
  }
  if ((endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
    || endpoint.username.length > 0 || endpoint.password.length > 0
    || endpoint.search.length > 0 || endpoint.hash.length > 0) {
    throw new TypeError('data-aid turn callback URL must not contain credentials, query, or fragment')
  }
  if (!normalizedText(config.callbackServiceIdentity, 128) || !strongSecret(config.callbackServiceToken)
    || !Number.isSafeInteger(config.callbackTimeoutMs) || config.callbackTimeoutMs < 1 || config.callbackTimeoutMs > 30_000
    || !Number.isSafeInteger(config.callbackMaxAttempts) || config.callbackMaxAttempts < 1 || config.callbackMaxAttempts > 5
    || !Number.isSafeInteger(config.callbackRetryDelayMs) || config.callbackRetryDelayMs < 1 || config.callbackRetryDelayMs > 5_000
    || !Number.isSafeInteger(config.callbackMaxBodyBytes)
    || config.callbackMaxBodyBytes < 1 || config.callbackMaxBodyBytes > 16_777_216
    || !Number.isSafeInteger(config.callbackMaxAnswerChars)
    || config.callbackMaxAnswerChars < 1 || config.callbackMaxAnswerChars > 16_384) {
    throw new TypeError('data-aid turn callback configuration is invalid')
  }
  return endpoint
}

/** Require normalized control-free text within one character limit. */
function normalizedText(value: unknown, maxChars: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxChars
    && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)
}

/** Require a non-placeholder service credential with at least 32 UTF-8 bytes. */
function strongSecret(value: string): boolean {
  if (typeof value !== 'string' || value !== value.trim() || encoder.encode(value).byteLength < 32) return false
  const lowered = value.toLowerCase()
  return new Set(value).size >= 8 && !value.includes('<')
    && !/(?:change[-_ ]?me|placeholder|replace[-_ ]?with|example[-_ ]?only|dummy[-_ ]?secret)/u.test(lowered)
}

/** Accept only JSON scalar result cells. */
function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
}

/** Accept only a parsed JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require exactly the declared object keys. */
function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key))
}
