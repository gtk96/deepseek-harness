# Agent Note: Request-local data-aid Principal authentication for HTTP Remote calls

Status: implemented

English | [中文](2026-08-19-request-local-data-aid-principal-authentication.zh.md)

## Problem

Remote `/api` calls need the trusted data-aid gateway identity and the existing permission result before a query Consumer runs, but account identity must not become Session data, message content, anonymous telemetry identity, Agent ownership, or Typert wire arguments. The Connection browser-trust fence prevents confused-deputy and DNS-rebinding access, but it does not prove a DingTalk account or resolve `data_role`, `team_codes`, and `data_org_code`.

## Decision

`@deepseek-ai/dsh-authenticated-principal` defines `ctx.authenticatedPrincipal` and owns an AsyncLocalStorage scope whose lifetime is the returned Gateway operation. Its immutable Principal carries branded `ddUserId`, mapped GK and GIMP ids, and the resolver's unchanged role and data scopes; it never writes Session or Agent state.

`@deepseek-ai/dsh-authenticated-principal-data-aid` provides the data-aid adapter. It requires a deployment-owned gateway verifier, strictly parses the standard-Base64 UTF-8 `gk-service-user` and optional `gk-service-app` headers, and delegates `dd_userid` mapping plus authority facts to a resolver. Missing, malformed, untrusted, unmapped, or failed inputs reject closed as `PrincipalAuthenticationError`; no header-only `X-Forwarded-Host` trust or anonymous fallback exists.

Connection passes the original Fetch `Request` to decoded RPC handlers as transport metadata after the existing envelope and trust checks. Typert Gateway authenticates that request when the Principal Service is composed, wraps descriptor resolution and business execution in the request-local scope, and maps authentication failures to the generic RPC `unauthorized` code. Direct Gateway callers pass an explicit Principal; a call without one clears ambient state, and an explicit Principal without the Service fails with `authentication-unavailable`.

The provider remains a deployment composition choice. The data-aid package provides `DataAidMseGatewayAuthenticator` for the MSE/enterprise SSO topology: Connection records the Node TCP peer address in non-wire Fetch metadata, and the provider accepts `gk-service-user` and `gk-service-app` only when it equals a configured IP literal. MSE or enterprise SSO owns DingTalk login, strips browser-supplied identity headers, and injects verified headers upstream. The package also provides a fixed table-backed resolver for the confirmed MaxCompute identity and authority snapshots: deployment code selects the explicit `dt`/`ht` partition and executes the generated SQL through a direct query callback. A deployment may use the direct `ctx.mcpClients` registry to call a configured MaxCompute MCP server with model-tool exposure disabled; the adapter accepts only complete structured SELECT results. DSH does not own database credentials, arbitrary project authority rules, or permission vocabulary, and it does not accept permission overrides from model or Remote arguments, authenticate ACP, or add identity to conversation behavior.

## Alternatives considered

- **Trust `X-Forwarded-Host` or visitor-header presence inside DSH.** Rejected: the current data-aid visitor header is unsigned, and only the deployment knows whether MSE or a reverse proxy established the network or signature trust required before parsing it.
- **Embed arbitrary project SQL in DSH.** Rejected: the fixed resolver only codifies the confirmed identity and authority tables and leaves credentials, transport, partition selection, and other project-specific rules with the deployment; embedding arbitrary permission logic would create divergent authorization rules.
- **Put identity in wire arguments, Session, or Agent state.** Rejected: those values are model-visible, durable, or ownership state and could be supplied or retained outside the authenticated HTTP request; the Principal is request-local internal state instead.
- **Let Agent or a business Consumer authenticate.** Rejected: authentication belongs before Typert invocation so every claimed Remote method receives the same authority and no Agent participates in permission decisions.

## Consequences

HTTP Remote authentication is available as a composable capability, while deployments without a Principal provider retain the existing local behavior. A deployment must provide both the gateway proof and either the confirmed table resolver's query/partition hooks or another existing resolver. The included MCP adapter needs the direct MCP registry and a dedicated MaxCompute bridge with `exposeTools: false`; a disconnected, malformed, errored, or truncated MCP response is authentication failure. Privileged Connection methods remain loopback-pinned independently of Principal authentication.

The fourth handler argument is transport metadata rather than business payload, so generated `args` and the RPC wire format remain unchanged. Concurrent HTTP calls receive isolated ALS stores, and service disposal waits for returned operations before disabling the stores; detached work does not inherit a durable authorization capability.

The stable `unauthorized` response contains no visitor, header, mapped-id, or resolver diagnostic. ACP, DingTalk chat, NL2SQL, Memory, query tools, and permission SQL implementation remain outside this integration.

## Verification

Unit coverage exercises strict visitor parsing, the confirmed MaxCompute SQL fields and dual-id join, explicit partition validation, returned identity-witness validation, the SQL two-row cap, external row validation, single-row fail-closed behavior, query signal hand-off, direct MCP structured-result validation, verifier and resolver fail-closed behavior, immutable permission output, concurrent Principal isolation, lifecycle draining, transport Request propagation, HTTP authentication, unauthorized mapping, and direct-call clearing. The affected package typechecks independently; the existing browser-trust fence remains the first carrier check.
