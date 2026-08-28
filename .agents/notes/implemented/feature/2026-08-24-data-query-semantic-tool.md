# Agent Note: Semantic data_query tool over the data-query capability

Status: implemented

English | [中文](2026-08-24-data-query-semantic-tool.zh.md)

## Problem

The earlier model-facing data query accepted SQL and relied on a raw MCP broker. The controlled data-query MVP requires one semantic tool whose arguments cannot select physical execution, whose identity cannot be forged from model or DSH Session data, and whose HTTP Provider agrees with the deployed DIC-BE protocol under cancellation, malformed data, and key rotation.

## Decision

The dedicated preset exposes exactly `data_query` and no raw MCP capability. Its closed parameter root projects every locally expressible bound into the model schema: catalog-code length/patterns, field/filter/order counts, unique code arrays, filter-value lengths/counts, and the 1–100 row range. Cross-field semantics remain host-validated. The Consumer obtains `principalId`, `conversationId`, and `turnId` only from `DataAidTurnPrincipalService`; the ingress calls `withTurn()` around synchronous Agent message insertion. The service keys queued state by exact Agent and message identity, rejects differing bindings and any turn that mixes bound and unbound claimed messages in either order, and clears state on claim/discard, turn stop, Agent disposal, and service disposal. It never derives business ids from a Session id or internal turn number.

The DIC-BE Provider signs HS256 with a deployment key ring and active `kid`. The JWT header is exactly `alg`, `typ`, and `kid`; claims are exactly `iss`, `aud`, `sub`, `jti`, `iat`, `exp`, `conversationId`, and `turnId`, with TTL capped at 60 seconds. Request timeout and rows are capped at 30 seconds and 100. Responses must contain exactly `{columns, rows, rowCount, complete:true, truncated:false}`; extra fields, malformed JSON, row inconsistencies, redirects, and truncation fail closed. Cells accept nested plain dense JSON objects and arrays, while iterative depth/node bounds, bounded strings, finite lossless numbers, and both wire and normalized UTF-8 byte caps prevent pathological results.

The CLI ships `data-aid` as an auto-initialized profile whose sole bundle applies over an empty root. That bundle mounts the minimum Agent/LLM stack, the installation-owned preset roster, the controlled runtime and Provider, trusted turn binding, a dedicated WebServer carrier, and one strict ingress; it does not inherit `dsh-base` or `dsh-web-app`. The ingress authenticates the configured fixed service identity plus bearer secret before reading a byte-capped body, accepts exactly `{principal, conversationId, turnId, question}`, maps business conversations to Agents with random internal Session ids, mounts the default preset, and synchronously wraps `agent.followup()` in `withTurn()`. Only the question enters the Session/model input.

The terminal callback treats a recorded `data_query` error as the authoritative query outcome even if a later model step fails: stable policy and semantic denials remain denied, timeouts remain timed out, and other query errors remain failed. A successful query result does not override a later Agent error because the model-visible answer step still did not complete. This ordering prevents provider failures after a rejected tool call from converting an auditable pre-execution denial into the unrelated `DQ_AGENT_FAILED` code.

The real Loader composition test resolves that shipped profile layer, proves no MCP or direct-query module is loaded and the only tool is `data_query`, sends wrong-identity and extra-field HTTP requests that create no Agent, sends one accepted request, captures the active trusted binding, verifies Principal/conversation/turn values are absent from Session events and the recorded model request, and verifies ingress route/Agent disposal. A fixed expected file snapshots the complete `data_query` schema. A keyless runnable Agent snapshot executes two trusted turns through the same Consumer and Provider: one governed success and one fake-broker HTTP policy denial. Package-local tsdown entries emit every declared Loader subpath as a self-contained file, and a plain-Node smoke imports those package exports from the examples workspace.

## Alternatives considered

- **Keep SQL or raw MCP model-visible.** Rejected: the model could choose physical authority and the dedicated catalog would not be enforceable.
- **Derive business ids from DSH Session state.** Rejected: these ids belong to DIC-BE dispatch and a local derivation would fabricate authorization context.
- **Capture only an ambient Principal.** Rejected: it cannot prove the exact DIC-BE conversation and turn that authorized the query.
- **Reuse MSE visitor headers or use `conversationId` as the Agent Session id.** Rejected: visitor headers authenticate a browser through a direct proxy rather than a workload dispatch, while a business conversation Session id would reach model-adapter metadata.
- **Accept compatible response supersets or character limits.** Rejected: DIC-BE specifies five fields and enforces bytes; permissive parsing would hide protocol drift and mishandle multibyte data.
- **Always let the final Agent reason replace a completed tool error.** Rejected: a provider failure after an auditable broker denial would erase the real authorization outcome, even though no source job was submitted.

## Consequences

Deployments can rotate assertion keys by overlapping verification entries and changing the active `kid`. Tool inputs and successful results remain bounded and deterministic, while abort and timeout cancel the underlying HTTP work. Missing trusted turn state makes `data_query` unavailable rather than falling back to Session-derived identity.

The closed profile now receives the service-authenticated DIC-BE `{principal, conversationId, turnId, question}` dispatch without mounting the legacy MSE visitor-header or MaxCompute MCP identity path. The exact service identity and bearer token are deployment configuration; the route rejects extra fields, retains business ids only in process memory for authorization, and fails closed on missing or conflicting turn state. The listener defaults to loopback. TLS termination, service-mesh/network authorization, rate controls, secret rotation, and real DIC-BE/MaxCompute acceptance remain deployment work.
