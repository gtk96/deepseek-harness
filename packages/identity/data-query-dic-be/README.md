# @deepseek-ai/dsh-data-query-dic-be

English | [中文](README.zh.md)

This package is the credentialed DIC-BE HTTP Provider for `ctx.dataQuery`. It uses native `fetch` with `POST`, rejects every redirect before following it, applies one cancellation/deadline signal to the request and response body, and accepts only complete bounded JSON tables.

## Configuration

`baseURL` and absolute `path` select the fixed DIC-BE endpoint. `issuer`, `audience`, `assertionSecret`, and `assertionTtlSeconds` configure a short-lived HS256 JWT carried only in `x-dsh-principal-assertion`. `timeoutSeconds`, `maxRows`, and `maxResultChars` bound the complete operation and response.

Each assertion contains `iss`, `aud`, `sub` equal to the host Principal's `gkUserId`, a random `jti`, `iat`, `exp`, and `dataRoles` containing only the Principal's `dataRole`. The POST body contains only `datasetCode`, `metricCodes`, `dimensionCodes`, and `limit`; identity, endpoint, credentials, and deployment ceilings never enter the body.

A successful response must be `application/json` with `success: true`, `complete: true`, `truncated: false`, matching `rowCount` and `rowsReturned`, string `columns`, and rectangular `rows`. The complete HTTP JSON document and normalized `{columns, rows}` result must fit `maxResultChars`, and rows must not exceed `maxRows`.

## Model Experience

Indirectly, through the Data Aid `data_query` Consumer; this provider contributes no prompt or tool schema.

#### KV Cache effect

No direct invalidation; assertion and transport data never enter model-visible content.

## Known Limitations and Deferred Work

- **Shared-secret rotation is deployment-owned** — one configured HS256 secret is active per provider instance; coordinated overlap or key identifiers require a future DIC-BE protocol revision.
