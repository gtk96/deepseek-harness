/** Keyless Data Aid adapter: call the sole semantic tool, then report success or refusal. */

import type { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

class DataAidSnapshotAdapter extends LlmAdapter {
  private calls = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const id = ToolCallId(`data-aid-snapshot-${++this.calls}`)
      const args = JSON.stringify({ datasetCode: 'sales_daily', metricCodes: ['order_count'], limit: 10 })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'data_query', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'data_query', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const detail = toolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = toolResult.isError
      ? `DATA_QUERY_REJECTED: ${detail}`
      : `DATA_QUERY_SUCCESS: ${detail}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 6 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'data-aid-snapshot-llm'
export const inject = ['llm']

/** Register the deterministic keyless adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['data-aid-snapshot'], new DataAidSnapshotAdapter())
}
