/** Real Loader composition for the shipped closed data-aid profile and preset. */

import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, loadProfile } from '@deepseek-ai/dsh-app-boot'
import AgentRuntime, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as Persona from '@deepseek-ai/dsh-persona'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime, {
  CallId,
  LlmAdapter,
  MessageId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import DataQueryRuntime from '@deepseek-ai/dsh-data-query'
import type { DataQueryConversationId, DataQueryTurnId } from '@deepseek-ai/dsh-data-query'
import * as dicBePlugin from '@deepseek-ai/dsh-data-query-dic-be'
import SessionRuntime, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { GkUserId } from '@deepseek-ai/dsh-authenticated-principal'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import * as dataAidHealth from '../src/data-aid-health.ts'
import * as dataQueryTool from '../src/data-query-tool.ts'
import * as dicBeTurnIngress from '../src/dic-be-turn-ingress.ts'
import DataAidTurnPrincipalService from '../src/turn-principal.ts'
import type { DataAidTrustedTurnBinding } from '../src/types.ts'
import { sensitiveContentKinds } from './sensitive-content.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const installAnchor = join(repoRoot, 'apps/cli/package.json')
const presetRoot = join(repoRoot, 'apps/cli/config/agent-presets')
let root: string | undefined
const loaderTurnCallbacks: unknown[] = []

let context: Context | undefined
let agentScope: Scope | undefined
let compositionAgent: Agent | undefined
const servers: Server[] = []
const importedModules: string[] = []
const savedEnvironment = new Map<string, string | undefined>()

function message(id: string): UserMessage {
  return { id: MessageId(id), content: [{ type: 'text', text: id }], source: { kind: 'user' } } as UserMessage
}

function setEnvironment(values: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!savedEnvironment.has(key)) savedEnvironment.set(key, process.env[key])
    process.env[key] = value
  }
}

async function listen(): Promise<string> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += String(chunk) })
    request.on('end', () => {
      if (request.url === '/v1/internal/data-query/turn-state') {
        expect(request.headers.authorization).toBe('Bearer test-callback-service-token-32-bytes-minimum')
        expect(request.headers['x-dsh-service-identity']).toBe('dsh-test')
        loaderTurnCallbacks.push(JSON.parse(body) as unknown)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ accepted: true }))
        return
      }
      expect(JSON.parse(body)).toEqual({
        datasetCode: 'sales_daily',
        metricCodes: ['order_count'],
        dimensionCodes: [],
        limit: 50,
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        columns: ['team_code', 'order_count'],
        rows: [['team-one', 12]],
        rowCount: 1,
        complete: true,
        truncated: false,
      }))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}


const loaderModelRequests: GenerateOptions[] = []

class LoaderRecordingAdapter extends LlmAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    loaderModelRequests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'accepted' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'accepted' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const LoaderLlmPlugin = {
  name: 'loader-test-llm',
  inject: ['llm'],
  apply(ctx: Context): void {
    ctx.llm.registerAdapter(['deepseek-official'], new LoaderRecordingAdapter())
  },
}

async function loadComposition(baseURL: string): Promise<Context> {
  setEnvironment({
    DATA_AID_QUERY_BASE_URL: baseURL,
    DATA_AID_QUERY_PATH: '/v1/internal/data-query/query',
    DATA_AID_QUERY_ISSUER: 'dsh',
    DATA_AID_QUERY_AUDIENCE: 'dic-be:data-query',
    DATA_AID_QUERY_ASSERTION_KEY_RING: JSON.stringify({ active: 'test-active-assertion-secret-32-bytes-minimum' }),
    DATA_AID_QUERY_ASSERTION_ACTIVE_KID: 'active',
    DATA_AID_QUERY_ASSERTION_TTL_SECONDS: '30',
    DATA_AID_QUERY_TIMEOUT_SECONDS: '5',
    DATA_AID_QUERY_MAX_ROWS: '100',
    DATA_AID_QUERY_MAX_RESULT_BYTES: '4096',
    DATA_AID_QUERY_DEFAULT_LIMIT: '50',
    DATA_AID_QUERY_MAX_SELECTED_FIELDS: '8',
    DATA_AID_QUERY_MAX_FILTERS: '4',
    DATA_AID_QUERY_MAX_ORDER_BY: '4',
    DATA_AID_QUERY_MAX_IN_VALUES: '4',
    DATA_AID_QUERY_MAX_VALUE_CHARS: '32',
    DATA_AID_INGRESS_HOST: '127.0.0.1',
    DATA_AID_INGRESS_PORT: '0',
    DATA_AID_INGRESS_PATH: '/v1/internal/data-query/turns',
    DATA_AID_INGRESS_SERVICE_IDENTITY: 'dic-be-test',
    DATA_AID_INGRESS_SERVICE_TOKEN: 'test-ingress-service-token-32-bytes-minimum',
    DATA_AID_INGRESS_MAX_BODY_BYTES: '4096',
    DATA_AID_INGRESS_MAX_QUESTION_CHARS: '256',
    DATA_AID_INGRESS_MAX_SEMANTIC_CATALOG_CHARS: '512',
    DATA_AID_INGRESS_MAX_TRACKED_TURNS: '100',
    DATA_AID_TURN_CALLBACK_URL: `${baseURL}/v1/internal/data-query/turn-state`,
    DATA_AID_TURN_CALLBACK_SERVICE_IDENTITY: 'dsh-test',
    DATA_AID_TURN_CALLBACK_SERVICE_TOKEN: 'test-callback-service-token-32-bytes-minimum',
    DATA_AID_TURN_CALLBACK_TIMEOUT_SECONDS: '5',
    DATA_AID_TURN_CALLBACK_MAX_ATTEMPTS: '2',
    DATA_AID_TURN_CALLBACK_RETRY_DELAY_MS: '10',
    DATA_AID_TURN_CALLBACK_MAX_BODY_BYTES: '4096',
    DATA_AID_TURN_CALLBACK_MAX_ANSWER_CHARS: '256',
  })
  root = await mkdtemp(join(tmpdir(), 'dsh-data-aid-loader-'))
  const profile = loadProfile('data-aid composition test', 'data-aid', installAnchor, root)
  expect(profile.layers.map(layer => layer.packageName)).toEqual(['@deepseek-ai/dsh-data-aid'])
  const configPath = join(profile.dir, 'cordis.yml')
  await writeFile(configPath, '[]\n')
  const profilePatches: PatchOptions[] = [
    ...profile.layers.flatMap(layer => layer.patches),
    ...profile.patches,
    {
      id: 'agent-presets',
      config: {
        default: 'data-aid',
        includeUserRoot: false,
        roots: [{ path: presetRoot, trust: 'system' }],
      },
    },
  ]
  const composedNames = composeEntries([profilePatches]).map(entry => entry.name)
  expect(composedNames.some(name => name.includes('mcp'))).toBe(false)
  expect(composedNames.some(name => /(?:direct-query|mse-gateway|maxcompute|hologres)/u.test(name))).toBe(false)

  context = new Context()
  context.baseUrl = pathToFileURL(profile.dir).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionRuntime],
    ['@deepseek-ai/dsh-agent', AgentRuntime],
    ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModel],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-persona', Persona],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-credentials-local', CredentialsLocal],
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-llm-deepseek', LoaderLlmPlugin],
    ['@deepseek-ai/dsh-agent-presets', AgentPresets],
    ['@deepseek-ai/dsh-authenticated-principal-data-aid/turn-principal', DataAidTurnPrincipalService],
    ['@deepseek-ai/dsh-data-query', DataQueryRuntime],
    ['@deepseek-ai/dsh-data-query-dic-be', dicBePlugin],
    ['@deepseek-ai/dsh-authenticated-principal-data-aid/data-query-tool', dataQueryTool],
    ['@deepseek-ai/dsh-authenticated-principal-data-aid/data-aid-health', dataAidHealth],
    [
      '@deepseek-ai/dsh-authenticated-principal-data-aid/dic-be-turn-ingress',
      dicBeTurnIngress,
    ],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      importedModules.push(specifier)
      if (!modules.has(specifier)) throw new Error(`dedicated data-aid profile must not import ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: {
      path: pathToFileURL(configPath).href,
      patches: profilePatches,
    },
  })
  await context.loader.await()
  const session = Session.create(SessionId('loader-session-not-a-business-id'))
  const agent = { id: session.id, session } as Agent
  agentScope = createScope(context, agent)
  Object.assign(agent, { ctx: agentScope.ctx })
  await context.agentPresets.mount(agentScope.ctx)
  compositionAgent = agent
  return context
}

function entries(ctx: Context) {
  return [...ctx.loader.entries()]
}

afterEach(async () => {
  await agentScope?.dispose()
  agentScope = undefined
  compositionAgent = undefined
  await context?.fiber.dispose()
  context = undefined
  importedModules.length = 0
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => { resolve() })
  })))
  loaderModelRequests.length = 0
  loaderTurnCallbacks.length = 0

  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  savedEnvironment.clear()
})

describe.sequential('dedicated data-aid real Loader composition', () => {
  it('accepts only strict service-authenticated HTTP turns without exposing business ids to the model', async () => {
    const ctx = await loadComposition(await listen())
    const createdAgents: Agent[] = []
    const disposeCreatedObserver = ctx.on('agent/created', ({ agent }) => { createdAgents.push(agent) })
    const url = `http://127.0.0.1:${String(ctx.webServer.port)}/v1/internal/data-query/turns`
    const body = {
      principal: 'gk-ingress-user',
      conversationId: 'dic-ingress-conversation',
      turnId: 'dic-ingress-turn',
      question: 'Show the bounded sales summary.',
    }
    const dispatch = async (
      serviceIdentity: string,
      value: Record<string, unknown>,
      token = 'test-ingress-service-token-32-bytes-minimum',
    ): Promise<Response> => await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-dsh-service-identity': serviceIdentity,
      },
      body: JSON.stringify(value),
    })

    const rejectedIdentity = await dispatch('untrusted-service', body)
    expect(rejectedIdentity.status).toBe(401)
    expect(await rejectedIdentity.json()).toEqual({ accepted: false })
    expect(loaderModelRequests).toEqual([])
    expect(createdAgents).toEqual([])

    const rejectedToken = await dispatch('dic-be-test', body, 'wrong-service-token-32-bytes-minimum')
    expect(rejectedToken.status).toBe(401)
    expect(await rejectedToken.json()).toEqual({ accepted: false })
    expect(loaderModelRequests).toEqual([])
    expect(createdAgents).toEqual([])

    const rejectedExtra = await dispatch('dic-be-test', { ...body, identityOverride: 'gk-other' })
    expect(rejectedExtra.status).toBe(400)
    expect(await rejectedExtra.json()).toEqual({ accepted: false })
    expect(loaderModelRequests).toEqual([])
    expect(createdAgents).toEqual([])

    const rejectedCredential = await dispatch('dic-be-test', {
      ...body,
      turnId: 'dic-sensitive-turn',
      question: 'Authorization: Bearer private-service-value',
    })
    expect(rejectedCredential.status).toBe(400)
    expect(await rejectedCredential.json()).toEqual({ accepted: false })
    expect(loaderModelRequests).toEqual([])
    expect(createdAgents).toEqual([])

    let ingressAgent: Agent | undefined
    let activeBinding: DataAidTrustedTurnBinding | undefined
    const disposeObserver = ctx.on('agent/pre-step', ({ agent }, next) => {
      ingressAgent = agent
      activeBinding = ctx.dataAidTurnPrincipal.require(agent)
      return next()
    })
    const accepted = await dispatch('dic-be-test', body)
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({ accepted: true })
    await expect.poll(() => ingressAgent).toBeDefined()
    if (ingressAgent === undefined) throw new Error('ingress did not create an Agent')
    const acceptedAgent = ingressAgent
    await acceptedAgent.whenIdle()
    await expect.poll(() => loaderTurnCallbacks.length).toBe(2)
    expect(loaderTurnCallbacks).toEqual([
      {
        principal: body.principal,
        conversationId: body.conversationId,
        turnId: body.turnId,
        status: 'running',
      },
      {
        principal: body.principal,
        conversationId: body.conversationId,
        turnId: body.turnId,
        status: 'succeeded',
        answer: 'accepted',
      },
    ])

    const duplicate = await dispatch('dic-be-test', body)
    expect(duplicate.status).toBe(202)
    expect(await duplicate.json()).toEqual({ accepted: true })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(loaderTurnCallbacks).toHaveLength(2)
    expect(createdAgents).toEqual([acceptedAgent])

    const conflict = await dispatch('dic-be-test', { ...body, principal: 'gk-conflict' })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ accepted: false })

    disposeObserver()
    expect(createdAgents).toEqual([acceptedAgent])
    disposeCreatedObserver()

    expect(activeBinding).toEqual({
      principalId: 'gk-ingress-user',
      conversationId: 'dic-ingress-conversation',
      turnId: 'dic-ingress-turn',
    })
    expect(loaderModelRequests).toHaveLength(1)
    expect(loaderModelRequests[0]?.tools?.map(tool => tool.name)).toEqual(['data_query'])
    expect(loaderModelRequests[0]?.messages.some(item =>
      item.content.some(block => block.type === 'text' && block.text === body.question),
    )).toBe(true)
    const modelInput = JSON.stringify(loaderModelRequests[0])
    const sessionEvents = JSON.stringify(acceptedAgent.session.events)
    expect(sensitiveContentKinds(modelInput)).toEqual([])
    expect(sensitiveContentKinds(sessionEvents)).toEqual([])
    for (const secretValue of [body.principal, body.conversationId, body.turnId]) {
      expect(modelInput).not.toContain(secretValue)
      expect(sessionEvents).not.toContain(secretValue)
    }
    expect(sessionEvents).toContain(body.question)

    const ingressEntry = entries(ctx).find(entry => entry.options.id === 'data-aid-dic-be-turn-ingress')
    if (ingressEntry?.fiber === undefined) throw new Error('missing turn ingress Loader fiber')
    await ingressEntry.fiber.dispose()
    await expect.poll(() => ctx.agents.get(acceptedAgent.id)).toBeUndefined()
    const removedRoute = await dispatch('dic-be-test', body)
    expect(removedRoute.status).toBe(404)
  })

  it('projects trusted semantic catalog ahead of the user question in model input', async () => {
    const ctx = await loadComposition(await listen())
    const createdAgents: Agent[] = []
    const disposeCreatedObserver = ctx.on('agent/created', ({ agent }) => { createdAgents.push(agent) })
    const url = `http://127.0.0.1:${String(ctx.webServer.port)}/v1/internal/data-query/turns`
    const catalog = '- dataset currency_snapshot\n    metrics: currency_count\n    dimensions:\n    - snapshot_partition (operators: eq)'
    const body = {
      principal: 'gk-catalog-user',
      conversationId: 'dic-catalog-conversation',
      turnId: 'dic-catalog-turn',
      semanticCatalog: catalog,
      question: '有多少种货币？',
    }
    const dispatch = async (value: Record<string, unknown>): Promise<Response> => await fetch(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-ingress-service-token-32-bytes-minimum',
        'content-type': 'application/json',
        'x-dsh-service-identity': 'dic-be-test',
      },
      body: JSON.stringify(value),
    })

    const rejectedCatalog = await dispatch({ ...body, semanticCatalog: 'x'.repeat(513) })
    expect(rejectedCatalog.status).toBe(400)
    expect(await rejectedCatalog.json()).toEqual({ accepted: false })
    expect(loaderModelRequests).toEqual([])

    loaderModelRequests.length = 0
    loaderTurnCallbacks.length = 0
    let ingressAgent: Agent | undefined
    const disposeObserver = ctx.on('agent/pre-step', ({ agent }, next) => {
      ingressAgent = agent
      return next()
    })
    const accepted = await dispatch(body)
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({ accepted: true })
    await expect.poll(() => ingressAgent).toBeDefined()
    if (ingressAgent === undefined) throw new Error('ingress did not create an Agent')
    const acceptedAgent = ingressAgent
    await acceptedAgent.whenIdle()
    const composedInput = `${catalog}\n\n---\n\n${body.question}`
    const userTexts = acceptedAgent.session.events.flatMap((event) => {
      if (event.type !== 'agent/inbox/spliced') return []
      return event.data.inserted.flatMap(message =>
        message.content.filter(block => block.type === 'text').map(block => block.text),
      )
    })
    expect(userTexts[0]).toBe(composedInput)
    expect(userTexts[0]).toContain(body.question)
    expect(userTexts[0]).toContain('currency_snapshot')
    const conflictCatalog = await dispatch({ ...body, semanticCatalog: catalog + '\n- dataset other' })
    expect(conflictCatalog.status).toBe(409)
    disposeObserver()
    disposeCreatedObserver()
    const ingressEntry = entries(ctx).find(entry => entry.options.id === 'data-aid-dic-be-turn-ingress')
    if (ingressEntry?.fiber === undefined) throw new Error('missing turn ingress Loader fiber')
    await ingressEntry.fiber.dispose()
  })

  it('loads the shipped sources without MCP, exposes only data_query, and disposes registrations', async () => {
    const ctx = await loadComposition(await listen())
    const loadedEntries = entries(ctx)
    const unloaded = loadedEntries
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(loadedEntries.map(entry => entry.options.name).some(name => name.includes('mcp'))).toBe(false)
    expect(importedModules.some(name => name.includes('mcp'))).toBe(false)
    expect(importedModules.some(name => /(?:direct-query|mse-gateway|maxcompute|hologres)/u.test(name))).toBe(false)
    expect(importedModules).toContain('@deepseek-ai/dsh-authenticated-principal-data-aid/data-query-tool')

    if (compositionAgent === undefined) throw new Error('missing mounted data-aid agent')
    const agent = compositionAgent
    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(['data_query'])
    const item = message('composition-message')
    const principalId = 'gk-one' as GkUserId
    ctx.dataAidTurnPrincipal.withTurn({
      principalId,
      conversationId: 'dic-conversation' as DataQueryConversationId,
      turnId: 'dic-turn' as DataQueryTurnId,
    }, () => {
      ctx.emit('agent/inbox/inserted', { agent, message: item })
    })
    ctx.emit('agent/inbox/claimed', { agent, message: item, turn: 1 })

    const result = await ctx.tools.execute({
      callId: CallId('composition-call'),
      name: 'data_query',
      arguments: { datasetCode: 'sales_daily', metricCodes: ['order_count'] },
      agent,
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({
      isError: false,
      value: { rowCount: 1, complete: true, truncated: false },
    })

    if (agentScope === undefined) throw new Error('missing mounted data-aid agent scope')
    await agentScope.dispose()
    agentScope = undefined
    const presetEntry = entries(ctx).find(entry => entry.options.id === 'agent-presets')
    if (presetEntry?.fiber === undefined) throw new Error('missing agent-presets Loader fiber')
    await presetEntry.fiber.dispose()
    expect(ctx.tools.schemas(agent)).toEqual([])

    const providerEntry = entries(ctx).find(entry => entry.options.id === 'data-query-dic-be')
    if (providerEntry?.fiber === undefined) throw new Error('missing data-query provider Loader fiber')
    await providerEntry.fiber.dispose()
    expect(() => ctx.dataQuery.query({
      datasetCode: 'sales_daily',
      metricCodes: ['order_count'],
      dimensionCodes: [],
      limit: 1,
    }, {
      principalId,
      conversationId: 'dic-conversation' as DataQueryConversationId,
      turnId: 'dic-turn' as DataQueryTurnId,
    })).toThrow('not registered')
  })
})
