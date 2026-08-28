/**
 * Service-authenticated DIC-BE turn ingress for the closed data-aid profile.
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid/dic-be-turn-ingress
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { GkUserId } from '@deepseek-ai/dsh-authenticated-principal'
import type { DataQueryConversationId, DataQueryTurnId } from '@deepseek-ai/dsh-data-query'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  assertSafeTurnInput,
  buildRunningCallback,
  buildTerminalCallback,
  DicBeTurnCallbackClient,
} from './dic-be-turn-callback.ts'
import type { TrackedDicBeTurn } from './dic-be-turn-callback.ts'
import { assertDataAidTrustedTurnBinding } from './turn-binding.ts'
import type { DataAidTrustedTurnBinding } from './types.ts'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from './turn-principal.ts'

const REQUIRED_BODY_KEYS = ['conversationId', 'principal', 'question', 'turnId'] as const
const OPTIONAL_BODY_KEYS = ['semanticCatalog'] as const
const ALLOWED_BODY_KEYS = [...REQUIRED_BODY_KEYS, ...OPTIONAL_BODY_KEYS] as const
const MODEL_INPUT_SEPARATOR = '\n\n---\n\n'
const encoder = new TextEncoder()

/** Deployment configuration for the fixed DIC-BE workload ingress. */
export interface Config {
  /** Exact internal HTTP path owned by this ingress. */
  readonly path: string
  /** Fixed workload identity expected from DIC-BE. */
  readonly serviceIdentity: string
  /** Bearer credential supplied only by the deployment secret store. */
  readonly serviceToken: string
  /** Maximum complete request body bytes buffered before parsing. */
  readonly maxBodyBytes: number
  /** Maximum question characters accepted from the trusted dispatch. */
  readonly maxQuestionChars: number
  /** Maximum semantic catalog characters accepted from the trusted dispatch. */
  readonly maxSemanticCatalogChars: number
  /** Maximum process-memory turn records retained for ingress idempotency. */
  readonly maxTrackedTurns: number
  /** Fixed DIC-BE broker callback URL on the trusted service network. */
  readonly callbackURL: string
  /** Fixed DSH workload name authenticated by the callback receiver. */
  readonly callbackServiceIdentity: string
  /** Callback bearer credential supplied only by the deployment secret store. */
  readonly callbackServiceToken: string
  /** Per-attempt callback timeout in seconds. */
  readonly callbackTimeoutSeconds: number
  /** Number of sequential callback attempts. */
  readonly callbackMaxAttempts: number
  /** Delay between callback attempts in milliseconds. */
  readonly callbackRetryDelayMs: number
  /** Maximum complete callback JSON bytes. */
  readonly callbackMaxBodyBytes: number
  /** Maximum answer characters projected back to DIC-BE. */
  readonly callbackMaxAnswerChars: number
}

/** Loader schema for strict turn ingress deployment settings. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  serviceIdentity: z.string().required(),
  serviceToken: z.string().required(),
  maxBodyBytes: z.number().step(1).min(1).max(65_536).required(),
  maxQuestionChars: z.number().step(1).min(1).max(16_384).required(),
  maxSemanticCatalogChars: z.number().step(1).min(1).max(16_384).required(),
  maxTrackedTurns: z.number().step(1).min(1).max(1_000_000).required(),
  callbackURL: z.string().required(),
  callbackServiceIdentity: z.string().required(),
  callbackServiceToken: z.string().required(),
  callbackTimeoutSeconds: z.number().step(1).min(1).max(30).required(),
  callbackMaxAttempts: z.number().step(1).min(1).max(5).required(),
  callbackRetryDelayMs: z.number().step(1).min(1).max(5_000).required(),
  callbackMaxBodyBytes: z.number().step(1).min(1).max(16_777_216).required(),
  callbackMaxAnswerChars: z.number().step(1).min(1).max(16_384).required(),
})

/** Cordis loader name. */
export const name = 'data-aid-dic-be-turn-ingress'

/** Host services required to authenticate, create, compose, and drive one turn. */
export const inject = ['agentDefaultModel', 'agentPresets', 'agents', 'dataAidTurnPrincipal', 'webServer']

/** Validated request fields after service authentication. */
interface DispatchBody {
  readonly principal: GkUserId
  readonly conversationId: DataQueryConversationId
  readonly turnId: DataQueryTurnId
  readonly question: string
  readonly semanticCatalog?: string
}


/** One accepted ingress retained only for idempotency and callback correlation. */
interface IngressTurnRecord extends TrackedDicBeTurn {
  readonly agent: Agent
  readonly messageId: MessageId
  callback: Promise<void>
}


/** HTTP failure whose message is safe and contains no request values. */
class IngressHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'IngressHttpError'
  }
}

/**
 * Register the strict service-authenticated turn route for the plugin lifetime.
 * @param ctx - closed data-aid host context.
 * @param config - workload identity, credential, route, and request limits.
 */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  const callback = new DicBeTurnCallbackClient({
    callbackURL: config.callbackURL,
    callbackServiceIdentity: config.callbackServiceIdentity,
    callbackServiceToken: config.callbackServiceToken,
    callbackTimeoutMs: config.callbackTimeoutSeconds * 1000,
    callbackMaxAttempts: config.callbackMaxAttempts,
    callbackRetryDelayMs: config.callbackRetryDelayMs,
    callbackMaxBodyBytes: config.callbackMaxBodyBytes,
    callbackMaxAnswerChars: config.callbackMaxAnswerChars,
  })
  const handles = new Map<DataQueryConversationId, AgentHandle>()
  const pending = new Map<DataQueryConversationId, Promise<Agent>>()
  const conversations = new Map<Agent, DataQueryConversationId>()
  const sessionAgents = new Map<Session, Agent>()
  const turns = new Map<DataQueryTurnId, IngressTurnRecord>()
  const messages = new Map<MessageId, IngressTurnRecord>()
  const active = new Map<Agent, Map<number, IngressTurnRecord>>()
  const inflight = new Set<Promise<void>>()

  const enqueue = (record: IngressTurnRecord, body: Parameters<DicBeTurnCallbackClient['send']>[0]): void => {
    const operation = record.callback.catch(() => {}).then(() => callback.send(body))
    record.callback = operation
    const observed = operation.catch(() => {
      ctx.logger.warn('data-aid turn lifecycle callback was not accepted')
    })
    inflight.add(observed)
    void observed.finally(() => { inflight.delete(observed) })
  }

  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const record = messages.get(message.id)
    if (record === undefined || record.agent !== agent) return
    messages.delete(message.id)
    let byTurn = active.get(agent)
    if (byTurn === undefined) {
      byTurn = new Map()
      active.set(agent, byTurn)
    }
    byTurn.set(turn, record)
    enqueue(record, buildRunningCallback(record.binding))
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const agent = sessionAgents.get(session)
    if (agent === undefined) return
    const byTurn = active.get(agent)
    const record = byTurn?.get(event.data.turn)
    if (record === undefined) return
    byTurn?.delete(event.data.turn)
    if (byTurn?.size === 0) active.delete(agent)
    enqueue(record, buildTerminalCallback(
      record,
      session,
      event.data.turn,
      event.data.reason,
      config.callbackMaxAnswerChars,
    ))
  })
  ctx.on('agent/disposed', ({ agent }) => {
    const conversationId = conversations.get(agent)
    if (conversationId === undefined) return
    conversations.delete(agent)
    sessionAgents.delete(agent.session)
    active.delete(agent)
    handles.delete(conversationId)
  })
  ctx.effect(() => async () => {
    await callback.dispose()
    await Promise.allSettled(inflight)
  }, 'data-aid-turn-ingress: callback lifecycle')

  const agentFor = async (conversationId: DataQueryConversationId): Promise<Agent> => {
    const owned = handles.get(conversationId)
    if (owned !== undefined) return owned.agent
    const inFlight = pending.get(conversationId)
    if (inFlight !== undefined) return await inFlight
    const creation = (async (): Promise<Agent> => {
      const selection = ctx.agentDefaultModel.currentSelection()
      const presetId = ctx.agentPresets.defaultId
      const handle = await ctx.agents.create({
        sessionId: SessionId(`data-aid-${randomUUID()}`),
        agentOptions: selection,
        meta: { agentPreset: presetId },
        setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, presetId),
      })
      handles.set(conversationId, handle)
      conversations.set(handle.agent, conversationId)
      sessionAgents.set(handle.agent.session, handle.agent)
      return handle.agent
    })().finally(() => { pending.delete(conversationId) })
    pending.set(conversationId, creation)
    return await creation
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: config.path,
    async handler(request, response) {
      try {
        if (request.method !== 'POST') {
          response.setHeader('allow', 'POST')
          throw new IngressHttpError(405, 'method not allowed')
        }
        authenticateService(request, config)
        const body = await readDispatchBody(request, config)
        const binding: DataAidTrustedTurnBinding = {
          principalId: body.principal,
          conversationId: body.conversationId,
          turnId: body.turnId,
        }
        const accepted = turns.get(body.turnId)
        if (accepted !== undefined) {
          if (sameAcceptedTurn(accepted, binding, body)) {
            sendJson(response, 202, { accepted: true })
            return
          }
          throw new IngressHttpError(409, 'turn id conflicts with an accepted dispatch')
        }
        if (turns.size >= config.maxTrackedTurns) {
          throw new IngressHttpError(503, 'turn ingress idempotency capacity is exhausted')
        }
        const tracked: TrackedDicBeTurn = {
          binding,
          question: body.question,
          ...(body.semanticCatalog === undefined ? {} : { semanticCatalog: body.semanticCatalog }),
        }
        try {
          assertSafeTurnInput(tracked)
        } catch (error: unknown) {
          if (error instanceof TypeError) {
            throw new IngressHttpError(400, 'turn question contains forbidden service data')
          }
          throw error
        }
        const agent = await agentFor(body.conversationId)
        const message = createUserMessage({
          content: [{ type: 'text', text: buildIngressModelInput(body) }],
          source: { kind: 'user' },
        })
        const record: IngressTurnRecord = {
          ...tracked,
          agent,
          messageId: message.id,
          callback: Promise.resolve(),
        }
        turns.set(body.turnId, record)
        messages.set(message.id, record)
        try {
          ctx.dataAidTurnPrincipal.withTurn(binding, () => { agent.followup(message) })
        } catch (error: unknown) {
          turns.delete(body.turnId)
          messages.delete(message.id)
          throw error
        }
        sendJson(response, 202, { accepted: true })
      } catch (error: unknown) {
        if (error instanceof IngressHttpError) {
          sendJson(response, error.status, { accepted: false })
          return
        }
        ctx.logger.warn('data-aid turn ingress rejected an internal dispatch failure')
        sendJson(response, 503, { accepted: false })
      }
    },
  }), 'data-aid-turn-ingress: route')
}

/** Fail startup for unsafe or incomplete ingress deployment settings. */
function validateConfig(config: Config): void {
  if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/')
    || config.path.includes('?') || config.path.includes('#') || config.path.includes('\\')) {
    throw new TypeError('data-aid turn ingress path must be one absolute non-root path without query or fragment')
  }
  if (!normalizedText(config.serviceIdentity, 128)) {
    throw new TypeError('data-aid turn ingress serviceIdentity must be a normalized non-empty string')
  }
  if (!strongSecret(config.serviceToken)) {
    throw new TypeError('data-aid turn ingress serviceToken must be a non-placeholder secret of at least 32 UTF-8 bytes')
  }
  if (!Number.isSafeInteger(config.maxTrackedTurns) || config.maxTrackedTurns < 1 || config.maxTrackedTurns > 1_000_000) {
    throw new TypeError('data-aid turn ingress maxTrackedTurns must be an integer from 1 to 1000000')
  }
}

/** Authenticate both the fixed workload name and its bearer credential before reading the body. */
function authenticateService(request: IncomingMessage, config: Config): void {
  const identity = request.headers['x-dsh-service-identity']
  const authorization = request.headers.authorization
  if (identity !== config.serviceIdentity
    || typeof authorization !== 'string'
    || !authorization.startsWith('Bearer ')
    || !secretEquals(authorization.slice('Bearer '.length), config.serviceToken)) {
    throw new IngressHttpError(401, 'service authentication failed')
  }
}

/** Read, byte-cap, decode, parse, and strictly validate one dispatch body. */
async function readDispatchBody(request: IncomingMessage, config: Config): Promise<DispatchBody> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new IngressHttpError(415, 'content type must be application/json')
  const declared = request.headers['content-length']
  if (declared !== undefined
    && (!/^\d+$/u.test(declared) || Number(declared) > config.maxBodyBytes)) {
    throw new IngressHttpError(Number(declared) > config.maxBodyBytes ? 413 : 400, 'invalid request length')
  }
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array)
    bytes += buffer.byteLength
    if (bytes > config.maxBodyBytes) throw new IngressHttpError(413, 'request body is too large')
    chunks.push(buffer)
  }
  let raw: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    raw = JSON.parse(text) as unknown
  } catch {
    throw new IngressHttpError(400, 'request body must be valid UTF-8 JSON')
  }
  if (!isRecord(raw) || !allowedBodyKeys(raw)
    || typeof raw.principal !== 'string'
    || typeof raw.conversationId !== 'string'
    || typeof raw.turnId !== 'string'
    || typeof raw.question !== 'string'
    || (Object.hasOwn(raw, 'semanticCatalog') && typeof raw.semanticCatalog !== 'string')) {
    throw new IngressHttpError(400, 'request body must contain exactly the dispatch fields')
  }
  const binding = {
    principalId: raw.principal as GkUserId,
    conversationId: raw.conversationId as DataQueryConversationId,
    turnId: raw.turnId as DataQueryTurnId,
  }
  try {
    assertDataAidTrustedTurnBinding(binding)
  } catch {
    throw new IngressHttpError(400, 'request body contains an invalid opaque identifier')
  }
  if (!normalizedText(raw.question, config.maxQuestionChars)) {
    throw new IngressHttpError(400, 'question must be normalized non-empty text')
  }
  if (Object.hasOwn(raw, 'semanticCatalog')
    && !catalogProjectionText(raw.semanticCatalog as string, config.maxSemanticCatalogChars)) {
    throw new IngressHttpError(400, 'semantic catalog must be normalized non-empty text')
  }
  return {
    principal: binding.principalId,
    conversationId: binding.conversationId,
    turnId: binding.turnId,
    question: raw.question,
    ...(Object.hasOwn(raw, 'semanticCatalog') ? { semanticCatalog: raw.semanticCatalog as string } : {}),
  }
}

/** Compare one duplicate dispatch against its process-memory accepted record. */
function sameAcceptedTurn(
  record: TrackedDicBeTurn,
  binding: DataAidTrustedTurnBinding,
  body: DispatchBody,
): boolean {
  return record.binding.principalId === binding.principalId
    && record.binding.conversationId === binding.conversationId
    && record.binding.turnId === binding.turnId
    && record.question === body.question
    && record.semanticCatalog === body.semanticCatalog
}

/** Compose trusted catalog projection and user question into one model-visible turn input. */
function buildIngressModelInput(body: DispatchBody): string {
  if (body.semanticCatalog === undefined) return body.question
  return `${body.semanticCatalog}${MODEL_INPUT_SEPARATOR}${body.question}`
}

/** Constant-time compare for equal-length service credentials. */
function secretEquals(actual: string, expected: string): boolean {
  const actualBytes = encoder.encode(actual)
  const expectedBytes = encoder.encode(expected)
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

/** Require normalized control-free text within one character limit. */
function normalizedText(value: string, maxChars: number): boolean {
  return value.length > 0 && value.length <= maxChars && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)
}

/** Require bounded semantic catalog projection text with only newline line breaks. */
function catalogProjectionText(value: string, maxChars: number): boolean {
  if (value.length === 0 || value.length > maxChars || value !== value.trim()) return false
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code === 10) continue
    if (code < 32 || code === 127) return false
  }
  return true
}

/** Require a non-placeholder secret with enough entropy-bearing bytes for deployment use. */
function strongSecret(value: string): boolean {
  if (typeof value !== 'string' || value !== value.trim() || encoder.encode(value).byteLength < 32) return false
  const lowered = value.toLowerCase()
  return new Set(value).size >= 8
    && !value.includes('<')
    && !/(?:change[-_ ]?me|placeholder|replace[-_ ]?with|example[-_ ]?only|dummy[-_ ]?secret)/u.test(lowered)
}

/** Accept only a parsed JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require the fixed dispatch fields and only the optional semantic catalog projection. */
function allowedBodyKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  if (keys.length < REQUIRED_BODY_KEYS.length || keys.length > ALLOWED_BODY_KEYS.length) return false
  return REQUIRED_BODY_KEYS.every(key => Object.hasOwn(value, key))
    && keys.every(key => ALLOWED_BODY_KEYS.includes(key as typeof ALLOWED_BODY_KEYS[number]))
}

/** Write one small JSON response without reflecting request data. */
function sendJson(response: ServerResponse, status: number, body: { readonly accepted: boolean }): void {
  if (response.headersSent) return
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}
