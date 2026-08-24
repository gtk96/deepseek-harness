# @deepseek-ai/dsh-data-query

English | [中文](README.zh.md)

`DataQueryRuntime` (`ctx.dataQuery`) is the Service Definition and provider registry for controlled semantic data queries. Deployment config must name one provider explicitly; registration order and provider availability never select a backend implicitly.

## Service API

`registerProvider(provider)` installs a uniquely named provider for the contributing fiber's lifetime and returns a disposer. `query(request, signal?)` resolves the configured provider at call time, requires it to be available, and forwards the request and cancellation signal unchanged.

`DataQueryRequest` carries `datasetCode`, `metricCodes`, `dimensionCodes`, optional semantic `filters`, `timeRange`, and `orderBy`, a `limit`, and an immutable host-owned `principal`. Consumers must obtain that Principal from an authenticated host service rather than accepting it from an external or model argument. `DataQueryResult` is a complete rectangular table with `columns` and `rows`.

## Model Experience

Indirectly, through a Consumer such as the Data Aid `data_query` tool; this registry contributes no prompt, tool schema, or result text.

#### KV Cache effect

No direct invalidation; the Consumer owns model-visible request changes.

## Known Limitations and Deferred Work

- **One selected provider per runtime** — routing a query to different providers requires separate Cordis service realms rather than per-request provider names.
