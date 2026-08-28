#!/usr/bin/env node
/** Run one allowed and one policy-denied trusted Data Aid turn through a real Loader tree. */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GkUserId } from '@deepseek-ai/dsh-authenticated-principal'
import type { DataQueryConversationId, DataQueryTurnId } from '@deepseek-ai/dsh-data-query'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-authenticated-principal-data-aid/turn-principal'

const NAME = 'data-aid-snapshot-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

interface Transcript {
  readonly scenario: 'success' | 'rejection'
  readonly tools: string[]
  readonly call: { readonly name: string; readonly arguments: unknown }
  readonly result: { readonly isError: boolean; readonly text: string }
  readonly assistant: string
}

function onlyAgent(ctx: Context): Agent {
  const agents = ctx.get('agents')?.roots() ?? []
  if (agents.length !== 1 || agents[0] === undefined) throw new Error(`${NAME}: expected one root agent`)
  return agents[0]
}

function textOf(event: Extract<SessionEvent, { type: 'assistant/message' }>): string {
  return event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

async function runTurn(ctx: Context, scenario: Transcript['scenario']): Promise<Transcript> {
  const agent = onlyAgent(ctx)
  await agent.whenIdle()
  const message = createUserMessage({
    content: [{ type: 'text', text: scenario === 'success' ? 'Query governed order count.' : 'Query a governed metric without policy access.' }],
    source: { kind: 'user' },
  })
  const events: SessionEvent[] = []
  const dispose = ctx.on('session/event', (session, event) => {
    if (session === agent.session) events.push(event)
  })
  try {
    ctx.dataAidTurnPrincipal.withTurn({
      principalId: (scenario === 'success' ? 'gk-snapshot-user' : 'gk-policy-denied-user') as GkUserId,
      conversationId: 'snapshot-conversation' as DataQueryConversationId,
      turnId: (scenario === 'success' ? 'snapshot-turn' : 'snapshot-denied-turn') as DataQueryTurnId,
    }, () => { agent.followup(message) })
    await agent.whenIdle()
  } finally {
    dispose()
  }

  const call = events.find((event): event is Extract<SessionEvent, { type: 'tool/call' }> => event.type === 'tool/call')
  const result = events.find((event): event is Extract<SessionEvent, { type: 'tool/result' }> => event.type === 'tool/result')
  const assistant = events.findLast((event): event is Extract<SessionEvent, { type: 'assistant/message' }> => (
    event.type === 'assistant/message' && textOf(event).length > 0
  ))
  const block = result?.data.message.content.find(content => content.type === 'tool-result')
  if (call === undefined || block === undefined || assistant === undefined) throw new Error(`${NAME}: incomplete ${scenario} transcript`)
  return {
    scenario,
    tools: ctx.tools.schemas(agent).map(schema => schema.name),
    call: { name: call.data.name, arguments: JSON.parse(call.data.arguments) as unknown },
    result: {
      isError: block.isError === true,
      text: block.content.filter(content => content.type === 'text').map(content => content.text).join(''),
    },
    assistant: textOf(assistant),
  }
}

function assertionSubject(assertion: string): string | undefined {
  const payload = assertion.split('.')[1]
  if (payload === undefined) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const subject = (parsed as Record<string, unknown>).sub
    return typeof subject === 'string' ? subject : undefined
  } catch {
    return undefined
  }
}

const server = createServer((request, response) => {
  const assertion = request.headers['x-dsh-principal-assertion']
  if (request.method !== 'POST' || request.url !== '/v1/internal/data-query/query'
    || typeof assertion !== 'string') {
    response.writeHead(401).end()
    return
  }
  request.resume()
  request.on('end', () => {
    if (assertionSubject(assertion) === 'gk-policy-denied-user') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 200, bizCode: 'DQ_POLICY_DENIED', msg: 'policy denied', data: {} }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      columns: ['order_count'],
      rows: [[42]],
      rowCount: 1,
      complete: true,
      truncated: false,
    }))
  })
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address() as AddressInfo
process.env.DATA_AID_SNAPSHOT_BASE_URL = `http://127.0.0.1:${address.port}`

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  process.stdout.write(`${JSON.stringify(await runTurn(ctx, 'success'))}\n`)
  process.stdout.write(`${JSON.stringify(await runTurn(ctx, 'rejection'))}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
  uninstallFailLoud()
}
