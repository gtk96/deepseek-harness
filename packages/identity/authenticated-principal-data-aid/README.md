# @deepseek-ai/dsh-authenticated-principal-data-aid

English | [中文](README.zh.md)

`DataAidGatewayAuthenticator` is the data-aid Service Provider for `@deepseek-ai/dsh-authenticated-principal`. It verifies a deployment-owned gateway trust hook, strictly parses the existing `gk-service-user` and optional `gk-service-app` headers, then calls a resolver that owns the existing identity mapping and authorization SQL/service.

This package deliberately does not treat `X-Forwarded-Host` or the presence of `gk-service-user` as proof by itself. `DataAidMseGatewayAuthenticator` provides the supported MSE deployment verifier: it accepts visitor headers only when `@deepseek-ai/dsh-client-connection` recorded a configured direct TCP proxy IP for the Fetch request. MSE or the enterprise SSO proxy owns DingTalk login, strips browser-supplied identity headers, and injects the verified headers upstream. A false result, malformed or missing visitor header, missing identity mapping, missing permission facts, or resolver failure all fail closed as authentication failure.

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

The deployment query callback must return the complete result set produced by that limit; it must not silently page or truncate the rows before the resolver sees them.
The resolver accepts exactly one row. It validates that both mapped ids and all permission values are non-empty strings, preserves string values such as `"0"`, and splits comma-separated team and organization codes. Zero rows, multiple rows, malformed rows, missing permission values, and query failures fail closed through `DataAidGatewayAuthenticator`.

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

### MSE DingTalk deployment

`@deepseek-ai/dsh-authenticated-principal-data-aid/mse-gateway` exports `DataAidMseGatewayAuthenticator` for the MSE/enterprise SSO topology. Its `trustedProxyAddresses` option is a non-empty unique list of IP literals seen directly by DSH; IPv4-mapped IPv6 peer addresses normalize to their IPv4 literal. It rejects hostnames, proxy forwarding headers, synthetic Fetch requests, and missing bridge metadata. The production overlay is [`apps/cli/config/data-aid-mse`](../../../apps/cli/config/data-aid-mse/README.md). It requires an explicit authority partition and mounts its raw MaxCompute MCP bridge with `exposeTools: false`.

### Loopback smoke test

`@deepseek-ai/dsh-authenticated-principal-data-aid/loopback-test` exports `DataAidLoopbackTestAuthenticator` for the isolated DSH Web smoke test under [`apps/cli/config/data-aid-test`](../../../apps/cli/config/data-aid-test/README.md). DSH Web binds locally to `127.0.0.1`; its HTTP bridge presents authenticated plugins with the fixed internal origin `http://dsh.internal`, which the provider requires together with an explicit test secret. It cannot verify an MSE or reverse-proxy boundary and must never be used as a production Provider.

## Local direct query test

`@deepseek-ai/dsh-authenticated-principal-data-aid/direct-query-tools` registers `data_query_maxcompute` and `data_query_hologres` for a local single-user test. Each wrapper accepts one `SELECT` or `WITH` statement without a semicolon, invokes only the deployed service's read-query MCP operation, and bounds the serialized result that reaches the model. Both MCP bridges must set `exposeTools: false`.

This capability intentionally has no Principal or authorization-broker dependency. It uses the local MCP service identity, so it is restricted to loopback-only use. The WSL composition lives at [`apps/cli/config/data-aid-direct-test`](../../../apps/cli/config/data-aid-direct-test/README.md); do not use it for shared, LAN, reverse-proxied, or public access.

## Model Experience

None, as gateway headers, resolver output, and authorization failures are model-hidden transport and service state.

#### KV Cache effect

Independent of model-prefix caching; the provider never appends identity or permission fields to model-visible content.

## Known Limitations and Deferred Work

- **MSE identity boundary is infrastructure-owned** — `DataAidMseGatewayAuthenticator` verifies the direct proxy peer, but MSE/enterprise SSO must still terminate TLS, perform DingTalk login, strip client identity headers, and inject verified headers before DSH receives the request.
- **MCP tool contract is deployment-owned** — the optional adapter requires the deployed SELECT tool's raw name and its synchronous structured-result fields; unsupported tool inputs or result formats fail authentication rather than using text parsing.
- **HTTP only in this integration** — ACP and other process boundaries need their own authenticated transport adapter and are intentionally not enabled by this provider.

## Authorized model data queries

`@deepseek-ai/dsh-authenticated-principal-data-aid/turn-principal` bridges a Principal only from synchronous, authenticated prompt insertion to the matching live Agent turn. It keeps references in process memory keyed by exact Agent and message identity, deletes queued references when a message is claimed or discarded, deletes the active reference at `agent/turn-stopping`, and clears every reference at Agent disposal. It never persists a Principal or scope in a Session or Agent event. A turn that claims different Principals is denied.

`@deepseek-ai/dsh-authenticated-principal-data-aid/data-query-tool` registers the model-visible `data_query` capability in the Data Aid agent preset. The model supplies only semantic catalog codes — a dataset, metrics, optional dimensions, filters, a time range, ordering, and a row limit — never SQL, physical identifiers, or execution configuration. The tool resolves the active Principal from the turn service and dispatches a host-owned `DataQueryRequest` through `ctx.dataQuery` to the explicitly configured provider. It rejects missing turn identity, conflicting turns, and provider failures.

Production composes the `@deepseek-ai/dsh-data-query-dic-be` provider, which signs a short-lived Principal assertion (`iss`, `aud`, `sub`, `jti`, `iat`, `exp`, turn binding) and posts the semantic request to an independent broker. The broker is the authorization decision point: it must verify the assertion, consume `jti` once, resolve the subject's data roles from authoritative sources, and enforce the dataset, table, column, join, predicate, and row authorizations server-side; DSH never parses or authorizes model SQL because the model never produces any. Do not point the provider at the `maxcompute-authority.execute_sql` bridge: that bridge exists only to authenticate a request and cannot grant business-data access.

The shipped `data-aid` preset contains only `data_query`. The production overlay requires the broker endpoint and assertion identity: `DATA_AID_QUERY_BASE_URL`, `DATA_AID_QUERY_PATH`, `DATA_AID_QUERY_ISSUER`, `DATA_AID_QUERY_AUDIENCE`, `DATA_AID_QUERY_ASSERTION_SECRET`, plus bounded `DATA_AID_QUERY_ASSERTION_TTL_SECONDS`, `DATA_AID_QUERY_TIMEOUT_SECONDS`, `DATA_AID_QUERY_MAX_ROWS`, `DATA_AID_QUERY_MAX_RESULT_CHARS`, and `DATA_AID_QUERY_DEFAULT_LIMIT`; no credential belongs in source control.
