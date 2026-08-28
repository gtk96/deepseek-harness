# 受控问数

[English](data-query.md) | 中文

受控问数的 Service Definition 是 [`@deepseek-ai/dsh-data-query`](../../packages/identity/data-query)。它把可投影给模型的语义请求与可信 host 上下文、提供方私有传输断言分离。该包注册 `ctx.dataQuery`；网络提供方与面向模型的 Consumer 是独立角色。

源码：[`packages/identity/data-query/src/types.ts`](../../packages/identity/data-query/src/types.ts)

## 语义请求

请求只命名治理目录编码、语义过滤、包含起点但不含终点的时间范围、已选字段排序和行数限制。它不能携带身份、授权范围、SQL、物理映射、端点、凭据、超时控制或提供方 id。

```ts type-equiv
/** One semantic filter on a governed dimension; the provider validates operator arity and value types. */
interface DataQueryFilter {
  /** Governed dimension code. */
  readonly dimensionCode: string
  /** Allowed semantic comparison operation. */
  readonly operator: 'eq' | 'in' | 'between' | 'gte' | 'lte'
  /** Operand: one value for `eq`/`gte`/`lte`, a non-empty list for `in`, or two values for `between`. */
  readonly value: DataQueryValue | readonly DataQueryValue[]
}
```

```ts type-equiv
/** Inclusive start and exclusive end on one governed date or time dimension. */
interface DataQueryTimeRange {
  /** Governed date or time dimension code. */
  readonly dimensionCode: string
  /** Inclusive lower bound in the governed dimension's accepted representation. */
  readonly startInclusive: string
  /** Exclusive upper bound in the governed dimension's accepted representation. */
  readonly endExclusive: string
}
```

```ts type-equiv
/** Sort specification for one selected metric or dimension. */
interface DataQueryOrderBy {
  /** Already-selected metric or dimension code. */
  readonly fieldCode: string
  /** Sort direction. */
  readonly direction: 'asc' | 'desc'
}
```

```ts type-equiv
/**
 * Semantic query submitted by a Consumer.
 *
 * The request deliberately excludes Principal facts, conversation/turn ids, assertions, SQL,
 * physical identifiers, service addresses, credentials, and execution controls. A model-facing
 * Consumer may project only these fields into its tool schema.
 */
interface DataQueryRequest {
  /** Dataset selected from the server-owned semantic catalog. */
  readonly datasetCode: string
  /** One or more governed metrics requested from that dataset. */
  readonly metricCodes: readonly string[]
  /** Governed dimensions requested from that dataset; an empty list means no grouping. */
  readonly dimensionCodes: readonly string[]
  /** Semantic filters combined with server-owned authorization filters. */
  readonly filters?: readonly DataQueryFilter[]
  /** Inclusive/exclusive bound on one governed date or time dimension. */
  readonly timeRange?: DataQueryTimeRange
  /** Sorts restricted to selected metrics or dimensions. */
  readonly orderBy?: readonly DataQueryOrderBy[]
  /** Requested row count, subject to deployment and dataset ceilings. */
  readonly limit: number
}
```

## 可信调用上下文

`DataQueryConversationId` 与 `DataQueryTurnId` 是不透明品牌 id。可信 host 在模型 JSON 之外解析 `principalId` 与这两个 id，再把不可变上下文与语义请求分开传递。选中的提供方可使用此上下文创建传输断言；Service Definition 类型不含任何断言值。

```ts type-equiv
/** Opaque conversation identifier bound by the trusted turn host. */
type DataQueryConversationId = Branded<'DataQueryConversationId'>
```

```ts type-equiv
/** Opaque turn identifier bound by the trusted turn host. */
type DataQueryTurnId = Branded<'DataQueryTurnId'>
```

```ts type-equiv
/**
 * Trusted host context for one provider call.
 *
 * A Consumer obtains these values from authenticated turn state and passes them separately from
 * {@link DataQueryRequest}; model JSON must never supply or override them. Providers may derive a
 * transport assertion from this context, but assertions never enter the request or result types.
 */
interface DataQueryContext {
  /** Stable authenticated user id used as the Query Broker assertion subject. */
  readonly principalId: GkUserId
  /** Opaque conversation id bound to the authenticated turn. */
  readonly conversationId: DataQueryConversationId
  /** Opaque turn id bound to the authenticated turn. */
  readonly turnId: DataQueryTurnId
}
```

## 结果与错误

成功结果精确包含五个字段。字面量 `complete: true` 与 `truncated: false` 让部分数据或静默截断数据无法表示为成功的同进程结果。结果不含 SQL、物理映射、断言、凭据、job id 或内部诊断字段。

```ts type-equiv
/**
 * Complete safe result returned by a provider.
 *
 * Successful providers return exactly these five protocol fields. `complete` and `truncated` are
 * literal guarantees; SQL, physical mappings, credentials, assertions, job ids, and diagnostics
 * are not part of this result.
 */
interface DataQueryResult {
  /** Column names in row order. */
  readonly columns: readonly string[]
  /** Complete rectangular rows. */
  readonly rows: readonly (readonly DataQueryValue[])[]
  /** Number of rows, equal to `rows.length`. */
  readonly rowCount: number
  /** Confirms that the backend read and validated the complete result. */
  readonly complete: true
  /** Confirms that no rows were silently dropped. */
  readonly truncated: false
}
```

`DataQueryError extends HarnessError`。运行时所有的稳定错误码区分显式配置缺失、显式配置不可用、无可用提供方、提供方歧义和重复提供方失败。提供方专属错误码保持开放；Consumer 按 `code` 路由，绝不解析消息文本。

## 提供方选择与生命周期

配置的 id 必须指向可用提供方。未配置时，只选择恰好一个可用注册；零个或多个候选都会失败。注册是 Cordis effect：返回的 disposer 与贡献它的 fiber 都会移除注册，因此 HMR 不会留下陈旧提供方。每次查询都会重新执行选择，并原样转发取消信号。

```ts type-equiv
/** One controlled-query backend registered with {@link DataQueryRuntime}. */
interface DataQueryProvider {
  /** Stable registry id selected by runtime configuration or sole-provider auto-selection. */
  readonly id: string
  /** Cheap local availability check that makes no network request. */
  available(): boolean
  /**
   * Execute one semantic request for trusted turn context and honor cancellation for the complete operation.
   * @param request - semantic fields only.
   * @param context - trusted Principal and turn binding supplied outside model JSON.
   * @param signal - optional cancellation signal.
   * @returns a complete, untruncated five-field result.
   */
  query(request: DataQueryRequest, context: DataQueryContext, signal?: AbortSignal): Promise<DataQueryResult>
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdataquery--dataqueryruntime"></a>

### `ctx.dataQuery` — `DataQueryRuntime`

Runtime that owns data-query provider registration, deterministic selection, and dispatch.

A configured provider must be registered and available. Without a configured id, the runtime selects exactly one available provider and rejects zero or multiple candidates. Resolution occurs for every call so provider disposal and availability changes take effect without stale caching.

```ts cordis-catalog
/**
 * Register one provider for the contributing fiber's lifetime.
 * @param provider - backend implementation with a unique normalized id.
 * @returns disposer that removes the provider; the contributing fiber also disposes it automatically.
 * @throws {@link DataQueryError} with `DATA_QUERY_DUPLICATE_PROVIDER` when the id already exists.
 */
registerProvider(provider: DataQueryProvider): () => void

/**
 * Execute one semantic query through the provider resolved at call time.
 * @param request - semantic query fields, never trusted identity or transport data.
 * @param context - trusted Principal and turn binding obtained outside model JSON.
 * @param signal - optional cancellation signal forwarded unchanged.
 * @returns the provider's complete, untruncated five-field result.
 * @throws {@link DataQueryError} when provider selection is missing, unavailable, or ambiguous.
 */
query(request: DataQueryRequest, context: DataQueryContext, signal?: AbortSignal): Promise<DataQueryResult>
```

Source: [`packages/identity/data-query/src/index.ts`](../../packages/identity/data-query/src/index.ts)
<!-- END GENERATED cordis-surface -->
