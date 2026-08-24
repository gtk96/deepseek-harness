/**
 * Ephemeral authenticated-Principal binding from Gateway prompt delivery to one Agent turn.
 *
 * @module @deepseek-ai/dsh-authenticated-principal-data-aid/turn-principal
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-authenticated-principal'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-authenticated-principal'

/** One live turn's immutable request Principal, or a conflict that must deny data access. */
interface TurnPrincipal {
  readonly turn: number
  readonly principal?: AuthenticatedPrincipal
  readonly conflicted: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Ephemeral authenticated Principal lookup for a live Agent turn. */
    dataAidTurnPrincipal: DataAidTurnPrincipalService
  }
}

/**
 * Carries an authenticated Principal from synchronous prompt delivery into its live Agent turn.
 *
 * The service holds only process-memory references. It never writes a Principal, identity,
 * or authorization scope to an Agent, Session, event, or durable log.
 */
export class DataAidTurnPrincipalService extends Service {
  static inject = ['authenticatedPrincipal']

  private readonly queued = new Map<Agent, Map<MessageId, AuthenticatedPrincipal>>()
  private readonly active = new Map<Agent, TurnPrincipal>()

  /** Register lifecycle listeners that retain and erase only live Principal references. */
  constructor(ctx: Context) {
    super(ctx, 'dataAidTurnPrincipal')
    ctx.effect(() => {
      const disposers = [
        ctx.on('agent/inbox/inserted', ({ agent, message }) => {
          const principal = ctx.authenticatedPrincipal.current()
          if (principal === undefined) return
          let messages = this.queued.get(agent)
          if (messages === undefined) {
            messages = new Map()
            this.queued.set(agent, messages)
          }
          messages.set(message.id, principal)
        }),
        ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
          const principal = this.takeQueued(agent, message.id)
          if (principal === undefined) return
          const previous = this.active.get(agent)
          if (previous === undefined || previous.turn !== turn) {
            this.active.set(agent, { turn, principal, conflicted: false })
            return
          }
          if (previous.conflicted || previous.principal !== principal) {
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
      }
    }, 'data-aid-turn-principal: lifecycle')
  }

  /**
   * Return the Principal active for this exact Agent, or deny an unbound/conflicted turn.
   * @param agent - Agent that owns the model tool execution.
   * @returns the exact immutable Principal captured when the turn's message was inserted.
   * @throws when the Agent has no bound authenticated turn or that turn has conflicting Principals.
   */
  require(agent: Agent | undefined): AuthenticatedPrincipal {
    if (agent === undefined) throw new Error('data query requires an authenticated agent turn')
    const active = this.active.get(agent)
    if (active === undefined) throw new Error('data query requires an authenticated active turn')
    if (active.conflicted || active.principal === undefined) {
      throw new Error('data query is denied because the active turn has conflicting authenticated principals')
    }
    return active.principal
  }

  /** Remove one retained Principal after the message leaves its pending inbox. */
  private takeQueued(agent: Agent, messageId: MessageId): AuthenticatedPrincipal | undefined {
    const messages = this.queued.get(agent)
    if (messages === undefined) return undefined
    const principal = messages.get(messageId)
    messages.delete(messageId)
    if (messages.size === 0) this.queued.delete(agent)
    return principal
  }
}

export default DataAidTurnPrincipalService
