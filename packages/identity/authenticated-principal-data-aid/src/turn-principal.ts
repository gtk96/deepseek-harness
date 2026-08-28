/**
 * Ephemeral authenticated turn binding from trusted dispatch to one Agent turn.
 *
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid/turn-principal
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { DataAidTrustedTurnBinding } from './types.ts'
import { assertDataAidTrustedTurnBinding } from './turn-binding.ts'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-authenticated-principal'

/** One live Agent turn's immutable binding, or a conflict that denies data access. */
interface ActiveTurnBinding {
  readonly turn: number
  readonly binding?: DataAidTrustedTurnBinding
  readonly conflicted: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Ephemeral authenticated Principal and business-id lookup for a live Agent turn. */
    dataAidTurnPrincipal: DataAidTurnPrincipalService
  }
}

/**
 * Carries a trusted dispatch's Principal and business ids into its exact live Agent turn.
 *
 * A transport adapter must authenticate the dic-be workload, strictly parse the three ids, then
 * call {@link withTurn} around synchronous Agent message insertion. The service holds only
 * process-memory references and never writes identity or authorization data to the Session log.
 */
export class DataAidTurnPrincipalService extends Service {
  private readonly incoming = new AsyncLocalStorage<DataAidTrustedTurnBinding>()
  private readonly queued = new Map<Agent, Map<MessageId, DataAidTrustedTurnBinding>>()
  private readonly active = new Map<Agent, ActiveTurnBinding>()

  /** Register lifecycle listeners that retain and erase only live binding references. */
  constructor(ctx: Context) {
    super(ctx, 'dataAidTurnPrincipal')
    ctx.effect(() => {
      const disposers = [
        ctx.on('agent/inbox/inserted', ({ agent, message }) => {
          const binding = this.incoming.getStore()
          if (binding === undefined) return
          let messages = this.queued.get(agent)
          if (messages === undefined) {
            messages = new Map()
            this.queued.set(agent, messages)
          }
          messages.set(message.id, binding)
        }),
        ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
          const binding = this.takeQueued(agent, message.id)
          const previous = this.active.get(agent)
          if (previous === undefined || previous.turn !== turn) {
            this.active.set(agent, {
              turn,
              ...(binding === undefined ? {} : { binding }),
              conflicted: binding === undefined,
            })
            return
          }
          if (binding === undefined
            || previous.conflicted
            || previous.binding === undefined
            || !sameBinding(previous.binding, binding)) {
            this.active.set(agent, { turn, conflicted: true })
          }
        }),
        ctx.on('agent/inbox/discarded', ({ agent, message }) => {
          this.takeQueued(agent, message.id)
        }),
        ctx.on('agent/turn-stopping', ({ agent, turn }) => {
          if (this.active.get(agent)?.turn === turn) this.active.delete(agent)
        }),
        ctx.on('agent/disposed', ({ agent }) => {
          this.queued.delete(agent)
          this.active.delete(agent)
        }),
      ]
      return () => {
        for (const dispose of disposers) dispose()
        this.queued.clear()
        this.active.clear()
        this.incoming.disable()
      }
    }, 'data-aid-turn-principal: lifecycle')
  }

  /**
   * Bind one service-authenticated dic-be dispatch while inserting its Agent message.
   * @param binding - principal and business ids parsed by the trusted transport adapter, never model arguments.
   * @param operation - message insertion operation that emits `agent/inbox/inserted` before returning.
   * @returns the exact value returned by `operation`.
   * @throws when any principal or business id is malformed.
   */
  withTurn<T>(binding: DataAidTrustedTurnBinding, operation: () => T): T {
    assertDataAidTrustedTurnBinding(binding)
    return this.incoming.run(Object.freeze({ ...binding }), operation)
  }

  /**
   * Return the complete binding active for this exact Agent.
   * @param agent - Agent that owns the model tool execution.
   * @returns the immutable Principal and dic-be conversation/turn ids captured at insertion.
   * @throws when the Agent has no bound authenticated turn or the turn has conflicting bindings.
   */
  require(agent: Agent | undefined): DataAidTrustedTurnBinding {
    if (agent === undefined) throw new Error('data query requires an authenticated agent turn')
    const active = this.active.get(agent)
    if (active === undefined) throw new Error('data query requires an authenticated active turn')
    if (active.conflicted || active.binding === undefined) {
      throw new Error('data query is denied because the active turn has conflicting trusted bindings')
    }
    return active.binding
  }

  /** Remove one retained binding after the message leaves its pending inbox. */
  private takeQueued(agent: Agent, messageId: MessageId): DataAidTrustedTurnBinding | undefined {
    const messages = this.queued.get(agent)
    if (messages === undefined) return undefined
    const binding = messages.get(messageId)
    messages.delete(messageId)
    if (messages.size === 0) this.queued.delete(agent)
    return binding
  }
}

/** Treat any Principal object or business-id change inside one Agent turn as a conflict. */
function sameBinding(left: DataAidTrustedTurnBinding, right: DataAidTrustedTurnBinding): boolean {
  return left.principalId === right.principalId
    && left.conversationId === right.conversationId
    && left.turnId === right.turnId
}

export default DataAidTurnPrincipalService
