/** DIC-BE lifecycle callback projection tests. */

import { describe, expect, it } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { GkUserId } from '@deepseek-ai/dsh-authenticated-principal'
import type { DataQueryConversationId, DataQueryTurnId } from '@deepseek-ai/dsh-data-query'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  assertSafeTurnInput,
  buildTerminalCallback,
} from '../src/dic-be-turn-callback.ts'
import type { TrackedDicBeTurn } from '../src/dic-be-turn-callback.ts'

function tracked(question = 'Show governed sales.'): TrackedDicBeTurn {
  return {
    binding: {
      principalId: 'principal-one' as GkUserId,
      conversationId: 'conversation-one' as DataQueryConversationId,
      turnId: 'turn-one' as DataQueryTurnId,
    },
    question,
  }
}

function session(): Session {
  return Session.create(SessionId(`callback-${crypto.randomUUID()}`))
}

function appendAnswer(value: Session, text: string): void {
  value.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'test', model: 'test' },
    }),
  }, { surfaceOp: 'append' })
}

function appendQueryResult(value: Session, outcome: 'success' | 'timeout' | 'denied'): void {
  const callId = CallId('query-call')
  value.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'data_query',
    arguments: '{}',
  })
  value.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: outcome === 'success'
        ? [{
          type: 'text',
          text: JSON.stringify({
            columns: ['amount'], rows: [[12]], rowCount: 1, complete: true, truncated: false,
          }),
        }]
        : [{ type: 'text', text: 'safe failure' }],
      isError: outcome !== 'success',
    }),
    ...(outcome === 'timeout'
      ? { error: { name: 'Error', code: 'DATA_QUERY_DIC_BE_TIMEOUT' } }
      : outcome === 'denied'
        ? { error: { name: 'Error', code: 'DQ_POLICY_DENIED' } }
        : {}),
  }, { surfaceOp: 'append' })
}

describe('DIC-BE turn lifecycle callback projection', () => {
  it('projects a completed answer and controlled result as succeeded', () => {
    const value = session()
    appendQueryResult(value, 'success')
    appendAnswer(value, 'Sales amount is 12.')

    expect(buildTerminalCallback(tracked(), value, 1, { kind: 'completed' }, 256)).toEqual({
      principal: 'principal-one',
      conversationId: 'conversation-one',
      turnId: 'turn-one',
      status: 'succeeded',
      answer: 'Sales amount is 12.',
      result: { columns: ['amount'], rows: [[12]], rowCount: 1 },
    })
  })

  it('maps a blocked turn to denied without exposing diagnostics', () => {
    expect(buildTerminalCallback(tracked(), session(), 1, { kind: 'blocked' }, 256)).toEqual({
      principal: 'principal-one',
      conversationId: 'conversation-one',
      turnId: 'turn-one',
      status: 'denied',
      errorCode: 'DQ_POLICY_DENIED',
    })
  })

  it('maps structured query timeout to timed_out', () => {
    const value = session()
    appendQueryResult(value, 'timeout')

    expect(buildTerminalCallback(tracked(), value, 1, { kind: 'completed' }, 256)).toMatchObject({
      status: 'timed_out',
      errorCode: 'DQ_QUERY_TIMEOUT',
    })
  })

  it('preserves a stable query denial when the later model step fails', () => {
    const value = session()
    appendQueryResult(value, 'denied')

    expect(buildTerminalCallback(
      tracked(),
      value,
      1,
      { kind: 'error', error: { message: 'provider failed after tool result', code: 'SERVER' } },
      256,
    )).toMatchObject({ status: 'denied', errorCode: 'DQ_POLICY_DENIED' })
  })

  it('maps non-completed Agent reasons to a generic failed result', () => {
    expect(buildTerminalCallback(
      tracked(),
      session(),
      1,
      { kind: 'error', error: { message: 'Authorization: secret', code: 'UNKNOWN' } },
      256,
    )).toMatchObject({ status: 'failed', errorCode: 'DQ_AGENT_FAILED' })
  })

  it('rejects credentials, SQL, and exact business ids before model insertion', () => {
    expect(() => { assertSafeTurnInput(tracked('Authorization: Bearer secret-value')) }).toThrow('forbidden')
    expect(() => { assertSafeTurnInput(tracked('SELECT secret FROM private_table')) }).toThrow('forbidden')
    expect(() => { assertSafeTurnInput(tracked('Explain turn-one')) }).toThrow('forbidden')
    expect(() => { assertSafeTurnInput(tracked()) }).not.toThrow()
  })
})
