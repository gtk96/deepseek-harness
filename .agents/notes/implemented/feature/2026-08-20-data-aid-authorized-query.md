# Agent Note: Data Aid uses an authorized query broker

Status: implemented

English | [中文](2026-08-20-data-aid-authorized-query.zh.md)

## Problem

The Data Aid MSE overlay authenticated a request through an authority snapshot, but no model-visible business-data capability existed. Exposing the existing raw MaxCompute `execute_sql` tool would let model-generated SQL use the authority credential without the authenticated person's table, column, join, predicate, or row restrictions.

## Decision

Data Aid now composes a `data-aid` preset whose only model-facing data capability is `data_query`. The tool accepts SQL alone and obtains every identity and scope field from a host-owned `DataAidTurnPrincipalService`, not from model arguments. It calls a separate raw MCP broker using the caller's cancellation signal and accepts only a complete, bounded tabular structured result.

The turn service captures `ctx.authenticatedPrincipal.current()` only during `agent/inbox/inserted`, records it by exact Agent and message identity, and associates it with the turn when that exact message is claimed. It removes queue state at claim or discard, removes active state at `agent/turn-stopping`, and removes all state at Agent disposal. It never writes Principal data to the durable session log. Conflicting Principals in one turn deny data access.

The broker receives an immutable envelope derived from the authenticated Principal and must enforce read-only SQL plus scope authorization server-side. The former `maxcompute-authority.execute_sql` bridge remains hidden and is restricted to pre-model identity resolution. The MSE profile now requires a separate query broker endpoint and token; deployment also supplies project, compute, timeout, row, and JSON-size limits.

## Alternatives considered

**Expose `maxcompute-authority.execute_sql` to the model.** Rejected: the authority bridge's credential is not an end-user data authorization mechanism.

**Authorize SQL in the DSH tool.** Rejected: client-side SQL parsing cannot prove authorization across tables, columns, joins, predicates, and row filters.

**Persist Principal data in Session events.** Rejected: identity and authorization facts would become replayable durable state even though the authenticated-principal seam promises not to store them in Sessions or Agents.

**Read `ctx.authenticatedPrincipal.current()` inside the tool.** Rejected: the Web prompt Remote returns after enqueueing work, before the later model turn and tool execution.

## Consequences

A Data Aid model can formulate business answers from `data_query` results while raw MCP tools remain absent from its catalog. Every query requires an authenticated active turn and the configured broker's complete response. Missing identity, identity conflicts, broken transport, partial or truncated results, malformed rows, count mismatches, and configured limit violations fail closed.

The local data-aid fixture now supplies a deterministic authorized-query endpoint and verifies the envelope it receives. Focused tests cover turn-only Principal availability, conflict denial, removal at turn stop, envelope derivation, and rejection of incomplete or oversized broker results. A production rollout still depends on deploying a real broker that enforces the stated server-side authorization semantics; DSH configuration alone cannot supply those rules.

The model-facing tool surface described above was superseded by [the semantic data_query tool](2026-08-24-data-query-semantic-tool.md), which accepts catalog codes instead of SQL and dispatches through `ctx.dataQuery`; the authenticated-Principal and turn-binding seams documented here remain current.
