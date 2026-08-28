---
description: "Credentialed DIC-BE HTTP provider for complete, bounded controlled semantic query results."
kind: "package-reference"
---

# @deepseek-ai/dsh-data-query-dic-be

English | [中文](README.zh.md)

## Summary

This package is the credentialed DIC-BE HTTP Provider for `ctx.dataQuery`. It sends one fixed-path `POST` with native `fetch`, rejects redirects, shares cancellation and deadline with response-body reads, and accepts only complete bounded JSON tables. A DIC-BE business rejection is accepted only as the exact unified `{code:200,bizCode:"DQ_*",msg,data:{}}` envelope; the Provider preserves only `bizCode` as a `DataQueryError` code and never exposes the broker message or data.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Configuration

An explicit `baseURL`, or `DATA_AID_QUERY_BASE_URL` from the launcher-owned environment snapshot when it is omitted, and absolute `path` select the fixed endpoint. Direct `DicBeDataQueryProvider` construction always requires the resolved `baseURL`. `issuer`, `audience`, `assertionKeyRing`, `assertionActiveKid`, and `assertionTtlSeconds` configure HS256 assertions. The key ring supports overlap during rotation; new assertions use the active `kid`. Secrets must remain in the deployment secret store. `timeoutSeconds`, `maxRows`, and `maxResultBytes` are additionally constrained by protocol ceilings of 30 seconds, 100 rows, and 16 MiB; assertion TTL is at most 60 seconds.

The JWT header is exactly `{alg:"HS256",typ:"JWT",kid}`. Its payload is exactly `iss`, `aud`, `sub`, `jti`, `iat`, `exp`, `conversationId`, and `turnId`; `sub` and both business ids come only from the trusted `DataQueryContext`. The POST body contains semantic request fields only. Filter operands are non-empty scalar arrays, matching DIC-BE's wire protocol.

A success response has exactly five fields: `{columns, rows, rowCount, complete:true, truncated:false}`. Columns must be unique strings, rows rectangular, and `rowCount` exact. A cell may contain nested plain dense JSON objects and arrays; every number is finite and lossless, strings are bounded, and iterative per-cell depth/node limits reject pathological nesting. Extra fields, non-JSON content, redirects, truncation, oversized row counts, and malformed values fail closed. Both the complete HTTP document and normalized result are capped by UTF-8 bytes, including exact-boundary and multibyte handling.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Data Aid `data_query` Consumer; this Provider contributes no prompt or tool schema.

#### KV Cache effect

No direct invalidation; assertions and transport data never enter model-visible content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **HS256 rotation is coordinated externally** — DSH selects an active `kid`, but deployment must keep DIC-BE's verification ring synchronized and retire old keys after the overlap window.
- **Broker authorization is external** — this Provider proves the caller context and validates transport results; DIC-BE remains responsible for replay protection and all dataset, field, predicate, and row authorization.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers ? click to expand</summary>

None.

</details>
