# Agent Note: Semantic data_query tool over the data-query capability

Status: implemented

English | [中文](2026-08-24-data-query-semantic-tool.zh.md)

## Problem

The model-facing `data_query` tool accepted a read-only SQL query and dispatched to a dedicated MCP broker that applied the authenticated user's scope. That left SQL in model arguments and coupled the tool to a broker-specific envelope. The controlled data-query MVP requires a semantic tool: its arguments are governed catalog codes, never SQL, physical identifiers, or execution configuration, and it dispatches through a provider seam rather than a raw MCP call.

## Decision

`data_query` now accepts only semantic fields: `datasetCode`, `metricCodes`, `dimensionCodes`, optional `filters`, `timeRange`, and `orderBy`, and `limit`. It resolves the authenticated Principal from `DataAidTurnPrincipalService` at execution, builds a host-owned `DataQueryRequest`, and dispatches through `ctx.dataQuery` to the explicitly configured provider. Production composes the `data-query-dic-be` provider, which signs a short-lived Principal assertion (`iss`, `aud`, `sub`, `jti`, `iat`, `exp`, turn binding) for the server-side broker. The tool contributes no SQL and no broker wire fields; the MCP query broker is removed from the data-aid and data-aid-test compositions, replaced by the data-query runtime and dic-be provider.

## Alternatives considered

- **Keep the SQL-broker tool.** Rejected: SQL in model arguments violates the never-expose-SQL invariant, and the tool would stay coupled to a broker-specific authorization envelope.
- **Authorize SQL inside the tool.** Rejected: client-side SQL parsing cannot prove table, column, join, predicate, or row authorization; the broker must decide.
- **Resolve the Principal inside the tool at execution from ambient state.** Rejected: the Web prompt returns before the later model turn, so request-local state is unavailable; the turn service is the only source that ties the authenticated Principal to the exact claimed turn.

## Consequences

The data-aid preset's model tool catalog is exactly `['data_query']`, and identity and scope never come from model arguments. The dic-be provider and its assertion become the production execution path; a broker that does not verify the assertion is unreachable from the model. `DataQueryRequest` gained optional semantic filters, time range, and ordering. The prior SQL-broker tool surface documented in [the authorized-query note](2026-08-20-data-aid-authorized-query.md) is superseded; the authenticated-principal and turn-principal seams that note describes remain current.
