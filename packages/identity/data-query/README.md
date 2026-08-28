# @deepseek-ai/dsh-data-query

English | [中文](README.zh.md)

`DataQueryRuntime` (`ctx.dataQuery`) is the Service Definition and provider runtime for controlled semantic data queries. It accepts only governed semantic requests; trusted identity and turn bindings travel in a separate host-owned `DataQueryContext`, while transport assertions remain private to Service Providers.

The type and selection reference is [the data-query subsystem page](../../../docs/subsystems/data-query.md). The [Service Definition decision](../../../.agents/notes/implemented/architecture/2026-08-25-data-query-service-definition.md) records why request, trusted context, and transport assertion are separate.

## Configuration

`provider` optionally pins one registered provider id. When omitted, each call auto-selects only if exactly one registered provider reports `available() === true`. Selection never depends on registration order.

## Service API

`registerProvider(provider)` installs a uniquely named provider as a Cordis effect and returns its disposer. Disposing that function or the contributing fiber removes the registration, including during HMR.

`query(request, context, signal?)` resolves a provider at call time and forwards the semantic `DataQueryRequest`, trusted `DataQueryContext`, and cancellation signal unchanged. `DataQueryRequest` has no Principal, conversation/turn id, assertion, SQL, physical identifier, credential, endpoint, timeout, or provider selector. A successful `DataQueryResult` has exactly `columns`, `rows`, `rowCount`, `complete: true`, and `truncated: false`; it has no SQL or job id.

## Failures

Provider-selection failures are `DataQueryError` instances with stable codes: `DATA_QUERY_PROVIDER_CONFIGURED_MISSING`, `DATA_QUERY_PROVIDER_CONFIGURED_UNAVAILABLE`, `DATA_QUERY_PROVIDER_UNAVAILABLE`, and `DATA_QUERY_PROVIDER_AMBIGUOUS`. Duplicate registration raises `DATA_QUERY_DUPLICATE_PROVIDER`. Provider-specific codes remain open so Consumers must not parse messages or assume a closed error union.

## Extension point

A Service Provider implements `DataQueryProvider`, uses a stable normalized id, performs a cheap local `available()` check, honors cancellation for the complete operation, and returns only a complete untruncated result. A network provider owns assertion creation and wire validation; neither concern belongs in this Service Definition.

## Model Experience

Indirectly, through a Consumer that projects `DataQueryRequest` as a model tool and logs the resulting tool call and result.

#### KV Cache effect

No direct invalidation; the Consumer owns every model-visible schema, request, and result rendering change.

## Known Limitations and Deferred Work

- **No model or wire validation** — this typed same-process Service Definition does not parse model JSON or remote responses; the Consumer and network Service Provider must validate their respective untrusted inputs.
- **One selected provider per call** — callers cannot choose a provider in `DataQueryRequest`; deployment config or sole-available-provider selection owns routing.
