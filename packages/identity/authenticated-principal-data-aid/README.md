---
description: "Data Aid authentication, trusted-turn ingress, callbacks, health probes, and controlled-query adapters for DIC-BE deployments."
kind: "package-reference"
---

# @deepseek-ai/dsh-authenticated-principal-data-aid

English | [中文](README.zh.md)

## Summary

`DataAidGatewayAuthenticator` is the data-aid Service Provider for `@deepseek-ai/dsh-authenticated-principal`. It verifies a deployment-owned gateway trust hook, strictly parses the existing `gk-service-user` and optional `gk-service-app` headers, then calls a resolver that owns the existing identity mapping and authorization SQL/service.

This package deliberately does not treat `X-Forwarded-Host` or the presence of `gk-service-user` as proof by itself. `DataAidMseGatewayAuthenticator` provides the supported MSE deployment verifier: it accepts visitor headers only when `@deepseek-ai/dsh-client-connection` recorded a configured direct TCP proxy IP for the Fetch request. MSE or the enterprise SSO proxy owns DingTalk login, strips browser-supplied identity headers, and injects the verified headers upstream. A false result, malformed or missing visitor header, missing identity mapping, missing permission facts, or resolver failure all fail closed as authentication failure.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Gateway visitor parsing

The parser follows data-aid's current representation: each header is standard Base64 containing UTF-8 JSON. `gk-service-user` must decode to an object with a non-empty string `id`; `gk-service-app` is optional, but when present it must decode to an object whose optional `clientId` is a non-empty string. Canonical padding and UTF-8 are required. Fetch's duplicate-header combination cannot pass the strict Base64 check, so the provider never selects one duplicate identity arbitrarily.

The parser exposes only branded `ddUserId` and optional `clientId` to the resolver. It does not copy raw visitor objects into the Principal. The resolver receives the original request only within the provider boundary, while Remote wire `args` remain unchanged.

## Resolver seam

```ts
import type {
  DataAidGatewayVisitor,
  DataAidPrincipalResolution,
} from '@deepseek-ai/dsh-authenticated-principal-data-aid'

interface DataAidPrincipalResolver {
  resolve(input: {
    visitor: DataAidGatewayVisitor
    request: Request
    signal: AbortSignal
  }): DataAidPrincipalResolution | undefined | Promise<DataAidPrincipalResolution | undefined>
}
```

The resolver starts with `ddUserId`, performs the existing `gk_userid`/`gimp_staff_id` mapping, and returns `dataRole`, `teamCodes`, and `dataOrgCodes` exactly as the existing data-aid authority produces them. `undefined` means the request is not authorized.

### Confirmed MaxCompute table resolver

`createDataAidTablePrincipalResolver` provides the fixed resolver for the confirmed MaxCompute snapshots. It requires two deployment hooks and never selects a partition implicitly:

```ts
import {
  createDataAidTablePrincipalResolver,
  type DataAidAuthorityPartitionResolver,
  type DataAidAuthorityQuery,
} from '@deepseek-ai/dsh-authenticated-principal-data-aid'

declare const resolveCurrentAuthorityPartition: DataAidAuthorityPartitionResolver
declare const executeMaxComputeSelect: DataAidAuthorityQuery

const principalResolver = createDataAidTablePrincipalResolver({
  resolvePartition: resolveCurrentAuthorityPartition,
  query: executeMaxComputeSelect,
})
```

`resolvePartition` returns the explicit `dt` (`YYYYMMDD`) and `ht` (`HH`) snapshot. `query` receives the SQL from `buildDataAidAuthoritySql` and the request `AbortSignal`, then returns raw result rows. A model-visible MCP tool registered in `ctx.tools` cannot be used for this pre-model authentication step.

### Direct MaxCompute MCP query

`createDataAidMaxComputeMcpQuery` adapts the direct `ctx.mcpClients` registry from `@deepseek-ai/dsh-mcp-client/mcp-clients`. It invokes one configured raw MCP SELECT tool before the model loop; set that bridge's `exposeTools` to `false` so the authority tool never enters the model catalog.

```ts
import {
  createDataAidMaxComputeMcpQuery,
  createDataAidTablePrincipalResolver,
} from '@deepseek-ai/dsh-authenticated-principal-data-aid'
import type { McpClientRegistry } from '@deepseek-ai/dsh-mcp-client/mcp-clients'

export function principalResolver(mcpClients: McpClientRegistry) {
  return createDataAidTablePrincipalResolver({
    resolvePartition: () => ({ dt: '20260819', ht: '14' }),
    query: createDataAidMaxComputeMcpQuery(mcpClients, {
      serverName: 'maxcompute-authority',
      toolName: 'execute_sql',
      project: 'giikin',
      maxCU: 10,
      timeoutSeconds: 30,
    }),
  })
}
```

The configured MCP tool must accept `project`, `sql`, `async: false`, `maxCU`, and `timeout`, and return `structuredContent` with `success: true`, `truncated: false`, equal `rowCount` and `rowsReturned`, and the full `data` array. MCP errors, text-only responses, truncation, inconsistent counts, and missing fields fail closed.

The generated SQL reads `ods_pl_gimp__gk_dingtalk_user_hourly` as `i` and `dmr_pty_staff_attribute_authority_hourly` as `a`. It requires `i.gk_userid = a.gimp_staff_id`, `i.dd_userid = a.dd_staff_id`, `i.status = '1'`, `a.staff_status = '1'`, and matching `dt`/`ht` values on both tables. It selects `i.gk_userid`, `a.gimp_staff_id`, `i.dd_userid`, `a.dd_staff_id`, `data_role` from `$.data_role`, `team_codes` from `$.area_ids`, and `data_org_code` from `$.data_org`. `LIMIT 2` preserves enough rows to distinguish zero, one, and multiple matches.

The deployment query callback must return the complete result set produced by that limit; it must not silently page or truncate the rows before the resolver sees them. The resolver accepts exactly one row. It validates that both mapped ids and all permission values are non-empty strings, preserves string values such as `"0"`, and splits comma-separated team and organization codes. Zero rows, multiple rows, malformed rows, missing permission values, and query failures fail closed through `DataAidGatewayAuthenticator`.

## Composition

The provider is a Service plugin and needs both hooks as trusted same-process configuration. A deployment may supply them through a `!!js` Cordis config entry or a small composition plugin. The optional MCP route mounts a direct registry and a dedicated non-model bridge before the Principal provider:

```yaml
- id: mcp-clients
  name: '@deepseek-ai/dsh-mcp-client/mcp-clients'

- id: mcp-maxcompute-authority
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: maxcompute-authority
    transport: streamable-http
    url: !!js process.env.DATA_AID_MAXCOMPUTE_MCP_URL
    headers:
      Authorization: !!js '`Bearer ${process.env.DATA_AID_MAXCOMPUTE_MCP_TOKEN}`'
    exposeTools: false
    failOnStartupError: true

- id: authenticated-principal
  name: '@deepseek-ai/dsh-authenticated-principal-data-aid'
  config:
    verifyGatewayRequest: !!js ./deployment/auth.js#verifyGatewayRequest
    resolver: !!js ./deployment/data-aid.js#principalResolver
```

The provider registers `ctx.authenticatedPrincipal`. Typert Gateway authenticates the Fetch request before invocation and establishes the resulting Principal only for that invocation's returned lifetime.

### MSE DingTalk provider

`@deepseek-ai/dsh-authenticated-principal-data-aid/mse-gateway` exports `DataAidMseGatewayAuthenticator` for legacy or external MSE/enterprise SSO compositions that separately choose the optional MaxCompute MCP authority adapter. Its `trustedProxyAddresses` option is a non-empty unique list of IP literals seen directly by DSH; IPv4-mapped IPv6 peer addresses normalize to their IPv4 literal. It rejects hostnames, proxy forwarding headers, synthetic Fetch requests, and missing bridge metadata.

The shipped closed [`data-aid` profile](../../../packages/bundle/data-aid/README.md) does not mount this provider or any MCP package. DIC-BE owns browser identity and calls DSH through the separately authenticated strict turn ingress described below; browser visitor headers are not accepted on that service route.

### Strict DIC-BE turn ingress

`@deepseek-ai/dsh-authenticated-principal-data-aid/dic-be-turn-ingress` is the production service transport mounted by the closed profile. It exposes one configured exact `POST` path. DIC-BE must send the configured `X-DSH-Service-Identity`, `Authorization: Bearer <service token>`, and `Content-Type: application/json`; authentication completes before the bounded body is read. The JSON object must contain exactly `principal`, `conversationId`, `turnId`, and `question`. Unknown fields, duplicate/coalesced service identity headers, malformed identifiers, non-normalized question text, oversized bodies, and wrong credentials are rejected without reflecting request values.

The ingress keeps a bounded process-memory conversation-to-Agent map and accepted-turn table, creates each Agent with a random internal Session id and the profile's default preset/model, and inserts only a question that passes the credential, raw-SQL, and exact-business-id safety gate. It calls `DataAidTurnPrincipalService.withTurn()` synchronously around `agent.followup()`, so the three business identity values are available only to host-side authorization and never appear in model messages, tool arguments, system text, or Session events. An exact duplicate dispatch is accepted without creating another Agent turn; a conflicting reuse of `turnId` is rejected. Accepted requests return `202 {"accepted":true}` without identifiers; failures return only `{"accepted":false}`.

When the bound message is actually claimed, the ingress sends a fixed-service-authenticated `running` callback to the configured DIC-BE broker URL. The matching durable `turn/end` produces exactly one terminal projection: final assistant text, an optional strict three-field controlled result, or a stable error code. Running and terminal deliveries are serialized and retried within configured bounds. Callback payloads use the process-memory binding rather than Session data, and answers/results containing credentials, raw SQL, or any exact binding value fail closed instead of being persisted. DIC-BE owns idempotent state validation and the accepted-turn completion watchdog, so a lost callback converges to `timed_out` rather than remaining non-terminal.

`DATA_AID_INGRESS_HOST` defaults to `127.0.0.1`. A multi-service deployment may explicitly bind a reachable interface, but the shipped WebServer does not terminate TLS: a service mesh or reverse proxy must provide TLS, trusted-network policy, request-rate controls, and secret injection. `DATA_AID_INGRESS_SERVICE_TOKEN` must be a deployment-generated secret of at least 32 UTF-8 bytes. This service credential authenticates the DIC-BE workload; it does not replace DIC-BE's user authentication or the signed query assertion.

### Data Aid workload health

`@deepseek-ai/dsh-authenticated-principal-data-aid/data-aid-health` registers configurable exact `GET` routes on the dedicated listener. The shipped bundle defaults to `/healthz/live` for process liveness and `/healthz/ready` for completed Cordis composition readiness. Both return small non-cacheable JSON responses, reject other methods, and do not add a fallback, browser API, or generic public route. Configure `DATA_AID_HEALTH_LIVE_PATH` and `DATA_AID_HEALTH_READY_PATH` when the platform reserves different probe paths.

### Loopback provider

`@deepseek-ai/dsh-authenticated-principal-data-aid/loopback-test` remains available for isolated tests of the legacy browser-authentication path. DSH Web binds locally to `127.0.0.1`; its HTTP bridge presents authenticated plugins with the fixed internal origin `http://dsh.internal`, which the provider requires together with an explicit test secret. It cannot verify an MSE or reverse-proxy boundary and must never be used as a production Provider. The controlled broker smoke patch for the [`data-aid` profile](../../../apps/cli/config/data-aid-test/README.md) does not mount it.

## Local direct query test

`@deepseek-ai/dsh-authenticated-principal-data-aid/direct-query-tools` registers `data_query_maxcompute` and `data_query_hologres` for a local single-user test. Each wrapper accepts one `SELECT` or `WITH` statement without a semicolon, invokes only the deployed service's read-query MCP operation, and bounds the serialized result that reaches the model. Both MCP bridges must set `exposeTools: false`.

This capability intentionally has no Principal or authorization-broker dependency. It uses the local MCP service identity, so it is restricted to loopback-only use. The WSL composition lives at [`apps/cli/config/data-aid-direct-test`](../../../apps/cli/config/data-aid-direct-test/README.md); do not use it for shared, LAN, reverse-proxied, or public access.

## Gateway behavior

None, as gateway headers, resolver output, and authorization failures are model-hidden transport and service state.

#### KV Cache effect

Independent of model-prefix caching; the provider never appends identity or permission fields to model-visible content.

## Gateway deployment responsibilities

- **MSE identity boundary is infrastructure-owned** — `DataAidMseGatewayAuthenticator` verifies the direct proxy peer, but MSE/enterprise SSO must still terminate TLS, perform DingTalk login, strip client identity headers, and inject verified headers before DSH receives the request.
- **MCP tool contract is deployment-owned** — the optional adapter requires the deployed SELECT tool's raw name and its synchronous structured-result fields; unsupported tool inputs or result formats fail authentication rather than using text parsing.
- **HTTP only in the gateway integration** — ACP and other process boundaries need their own authenticated transport adapter and are intentionally not enabled by this provider.

## Authorized model data queries

`@deepseek-ai/dsh-authenticated-principal-data-aid/turn-principal` bridges only the complete service-authenticated dispatch binding — `principalId`, `conversationId`, and `turnId` — from synchronous Agent message insertion to the matching live turn. It keeps process-memory references by exact Agent and message identity, removes queued and active references on claim, discard, turn stop, Agent disposal, and service disposal, and denies conflicting bindings or any turn that mixes bound and unbound claimed messages in either order. It never derives business ids from a DSH Session or internal turn number.

`@deepseek-ai/dsh-authenticated-principal-data-aid/data-query-tool` registers the sole model-visible `data_query` capability in the Data Aid agent preset. Its closed root accepts bounded semantic catalog codes — a dataset, unique metrics and dimensions, finite scalar filters, one time range, selected-field ordering, and a row limit — never SQL, physical identifiers, identity, endpoints, or execution configuration. The tool reads all three identity fields from the active trusted binding, dispatches a host-owned `DataQueryRequest` through `ctx.dataQuery`, and returns the broker's complete five-field table result. Missing, malformed, conflicting, or expired lifecycle state fails closed.

Production composes the `@deepseek-ai/dsh-data-query-dic-be` Provider. It signs an assertion whose header carries the active key-ring `kid` and whose payload is exactly `iss`, `aud`, `sub`, `jti`, `iat`, `exp`, `conversationId`, and `turnId`. It accepts only the strict `{columns, rows, rowCount, complete:true, truncated:false}` response and complete UTF-8 byte-bounded results. Every cell may be a nested JSON object or array, but every number must be finite and lossless, strings are bounded, objects and arrays must be plain dense JSON, and per-cell depth and node limits prevent pathological nesting. DIC-BE must verify the assertion, consume `jti` once, and enforce all dataset, field, predicate, and row authorization server-side. Do not point this Provider at `maxcompute-authority.execute_sql`; that bridge authenticates browser requests and cannot grant business-data access.

The shipped `data-aid` profile starts from its own closed bundle; its preset contains exactly `data_query` and no raw MCP capability. The bundle reads `DATA_AID_QUERY_ASSERTION_KEY_RING` as a JSON object plus `DATA_AID_QUERY_ASSERTION_ACTIVE_KID`; the endpoint, assertion bounds, semantic limits, and dedicated service-ingress listener, path, identity, token, body, and question limits use the `DATA_AID_QUERY_*` and `DATA_AID_INGRESS_*` settings shown in `apps/cli/config/data-aid-mse/.env.example`. Keep key material out of source control.


<a id="model-experience"></a>
## Model Experience

### `data_query`

#### What the model sees

The model sees one closed `data_query` semantic tool schema accepting governed dataset, metric, dimension, filter, time-range, ordering, and row-limit fields; its success value is the strict five-field table result, while safe failures expose no assertion, SQL, job id, endpoint, or identity.

#### Token effect

The stable schema contributes to the request prefix, and each call adds bounded arguments plus a result capped by the Provider's row and UTF-8 byte limits.

#### KV Cache effect

The schema is stable across turns and does not itself invalidate the prefix cache; per-turn calls and results extend only the conversation suffix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Ingress network controls remain deployment-owned** — the shipped strict route authenticates the fixed service identity and bearer secret, but its WebServer does not provide TLS, service-mesh policy, rate limiting, or secret rotation.
- **Real broker and MaxCompute acceptance is external** — local HTTP and keyless snapshots prove DSH composition and protocol handling, not production authorization, network policy, or governed-data correctness.
- **Direct query tools remain local-only** — the separate `data-aid-direct` preset uses service credentials without per-user business-data authorization and must not be exposed through shared or public listeners.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers ? click to expand</summary>

None.

</details>
