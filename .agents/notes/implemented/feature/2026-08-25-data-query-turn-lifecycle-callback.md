# Agent Note: Controlled data-query turn lifecycle callback

Status: implemented

English | [中文](2026-08-25-data-query-turn-lifecycle-callback.zh.md)

## Problem

DIC-BE durably queued browser turns and DSH accepted them, but no production path connected a real Agent turn to DIC-BE's existing state machine. A successful ingress could therefore leave the browser polling `queued` forever, while copying business ids into Session state to correlate completion would expose authorization context to the model log.

## Decision

The closed Data Aid ingress retains the authenticated principal, conversation id, turn id, question, Agent, and message id only in bounded process memory. It rejects model input containing exact binding values, credential patterns, or raw SQL. When the exact message is claimed, it sends a fixed-service-authenticated `running` callback to the broker-only DIC-BE route. The exact durable `turn/end` then produces one strict terminal callback containing only bounded assistant text, a validated controlled result, or a stable error code.

DIC-BE authenticates the callback before reading its bounded JSON body, verifies the complete principal/conversation/turn binding, and reuses `service.update_turn_state()` as the state-and-audit commit point. Equal callback replays are no-ops, stale `running` after a terminal callback is accepted without regression, and conflicting or reverse transitions fail closed. The public workload does not mount the callback route.

Callback attempts are finite and process crashes can occur after ingress acceptance, so the persistent dispatch worker also owns an accepted-turn completion watchdog. An accepted turn still in `queued` or `running` after the configured deadline is conditionally moved to `timed_out` with the stable `DQ_AGENT_FAILED` code and matching audit. A concurrent terminal callback wins by changing the row before the watchdog lock condition can match.

## Alternatives considered

- **Write DIC-BE ids into DSH Session events.** Rejected because Session is the model-history source and would make business authorization identifiers durable and model-adjacent.
- **Treat `agent/status: idle` as one dispatch result.** Rejected because Agent status covers whole-agent activity and cannot attribute output to one queued message; exact inbox claim and durable turn number provide the required interval.
- **Let DIC-BE poll DSH Session state.** Rejected because it creates a browser-adjacent Session API, exposes Harness internals, and still needs a secure business-id mapping.
- **Retry callbacks forever.** Rejected because teardown could never reach quiescence and an unavailable broker would retain unbounded work; bounded retries plus the persistent DIC-BE watchdog provide eventual terminal state.

## Consequences

Business ids and callback credentials remain outside model input and Session events, while browser-visible state follows the existing monotonic DIC-BE state machine. The callback token is distinct from ingress and assertion credentials and is injected only into DSH and the broker workload. Ingress duplicate suppression is process-local, so DIC-BE remains the sole durable idempotency authority and does not retry a confirmed acceptance. A DSH crash may delay completion until the configured watchdog deadline, but it no longer leaves a permanent non-terminal turn.
