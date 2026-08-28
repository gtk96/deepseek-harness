# Controlled Data Query

English | [中文](data-query.zh.md)

The controlled data-query Service Definition is [`@deepseek-ai/dsh-data-query`](../../packages/identity/data-query). It separates a model-projectable semantic request from trusted host context and provider-private transport assertions. The package registers `ctx.dataQuery`; network providers and model-facing Consumers are separate roles.

Source: [`packages/identity/data-query/src/types.ts`](../../packages/identity/data-query/src/types.ts)

## Semantic request

A request names only governed catalog codes, semantic filters, an inclusive/exclusive time range, selected-field ordering, and a row limit. It cannot carry identity, authorization scope, SQL, physical mappings, endpoints, credentials, timeout controls, or a provider id.

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

## Trusted call context

`DataQueryConversationId` and `DataQueryTurnId` are opaque branded ids. A trusted host resolves `principalId` and both ids outside model JSON, then passes the immutable context separately from the semantic request. The selected provider may use this context to create a transport assertion; no assertion value enters the Service Definition types.

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

## Result and errors

A successful result contains exactly five fields. Literal `complete: true` and `truncated: false` make partial or silently truncated data unrepresentable as a successful same-process result. The result has no SQL, physical mapping, assertion, credential, job id, or internal diagnostic field.

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

`DataQueryError extends HarnessError`. Runtime-owned stable codes distinguish configured-missing, configured-unavailable, no-available, ambiguous, and duplicate-provider failures. Provider-specific codes remain open; Consumers route on `code`, never message text.

## Provider selection and lifetime

A configured id must name an available provider. Without one, exactly one available registration is selected; zero and multiple candidates fail. Registration is a Cordis effect: its returned disposer and its contributing fiber both remove it, so HMR cannot leave a stale provider. Selection runs on every query and forwards cancellation unchanged.

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauthenticatedprincipal--authenticatedprincipalservice-abstract-seam"></a>

### `ctx.authenticatedPrincipal` — `AuthenticatedPrincipalService` (abstract seam)

Service Definition and lifecycle owner for authenticated Principal providers. The provider subclass implements authenticate; this base class owns only request-local scope and never stores a Principal in a session or Agent.

```ts cordis-catalog
/**
 * Authenticate one transport request into a complete Principal.
 * @param request - standard Fetch request supplied by the transport adapter.
 * @param signal - request cancellation signal.
 * @returns the authenticated Principal.
 */
abstract authenticate(request: Request, signal: AbortSignal): Promise<AuthenticatedPrincipal>

/**
 * Read the Principal inherited by the current asynchronous operation.
 * @returns the current Principal, or `undefined` outside an authenticated scope.
 * @throws after this service has been disposed.
 */
current(): AuthenticatedPrincipal | undefined

/**
 * Read the current Principal and fail when the operation is unauthenticated.
 * @returns the current authenticated Principal.
 * @throws when no Principal is active or this service has been disposed.
 */
require(): AuthenticatedPrincipal

/**
 * Run an operation with one exact request-local Principal.
 * @param principal - Principal to inherit; `undefined` explicitly clears an inherited scope.
 * @param operation - synchronous or asynchronous operation to invoke.
 * @returns the exact value or Promise returned by `operation`.
 * @throws when this service is closing/disposed or when `operation` throws.
 */
withPrincipal<T>(principal: AuthenticatedPrincipal | undefined, operation: () => T): T

/**
 * Run an operation without inheriting an ambient Principal.
 * @param operation - synchronous or asynchronous operation to invoke.
 * @returns the exact value or Promise returned by `operation`.
 */
withoutPrincipal<T>(operation: () => T): T
```

Source: [`packages/identity/authenticated-principal/src/index.ts`](../../packages/identity/authenticated-principal/src/index.ts)

<a id="ctxdataaidturnprincipal--dataaidturnprincipalservice"></a>

### `ctx.dataAidTurnPrincipal` — `DataAidTurnPrincipalService`

Carries a trusted dispatch's Principal and business ids into its exact live Agent turn.

A transport adapter must authenticate the dic-be workload, strictly parse the three ids, then call withTurn around synchronous Agent message insertion. The service holds only process-memory references and never writes identity or authorization data to the Session log.

```ts cordis-catalog
/**
 * Bind one service-authenticated dic-be dispatch while inserting its Agent message.
 * @param binding - principal and business ids parsed by the trusted transport adapter, never model arguments.
 * @param operation - message insertion operation that emits `agent/inbox/inserted` before returning.
 * @returns the exact value returned by `operation`.
 * @throws when any principal or business id is malformed.
 */
withTurn<T>(binding: DataAidTrustedTurnBinding, operation: () => T): T

/**
 * Return the complete binding active for this exact Agent.
 * @param agent - Agent that owns the model tool execution.
 * @returns the immutable Principal and dic-be conversation/turn ids captured at insertion.
 * @throws when the Agent has no bound authenticated turn or the turn has conflicting bindings.
 */
require(agent: Agent | undefined): DataAidTrustedTurnBinding
```

Types: [Agent](core.md)

Source: [`packages/identity/authenticated-principal-data-aid/src/turn-principal.ts`](../../packages/identity/authenticated-principal-data-aid/src/turn-principal.ts)

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
