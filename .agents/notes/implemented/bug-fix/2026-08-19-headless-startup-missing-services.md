# Agent Note: Headless startup missing services fail loud

Status: implemented

English | [中文](2026-08-19-headless-startup-missing-services.zh.md)

## Problem

The one-shot headless runner waited for Loader settlement, then returned when `agents`, `agentDefaultModel`, or `sessions` was unavailable. It neither wrote a diagnostic nor called the launcher-owned `appExit` hook. Node could therefore finish with status 0 without creating a Session, issuing a model request, or printing an answer.

The missing services occur when Loader aborts the tree while concurrent rows are still settling. The real Loader error is then present elsewhere in startup output, but the runner's silent return made the product outcome look like a successful empty task.

## Decision

After Loader settlement, the runner now collects every unavailable core service and reports one `headless-runner` error through its existing failure path. That writes the diagnostic and requests exit 1 through `appExit`. A normal signal-owned disposal still owns its existing shutdown code because the launcher coalesces the already-pending shutdown.

## Alternatives considered

- **Keep the silent return for early disposal.** A terminated command has no answer, Session, or request, so a successful exit violates the one-shot CLI's observable result.
- **Throw from the plugin.** The runner already has one error presentation and bounded application-shutdown path; bypassing it would duplicate process behavior and can leave output inconsistent.
- **Treat one particular missing service as special.** The three services are all required to begin a task, and one diagnostic listing every missing service makes the startup state actionable.

## Consequences

A broken startup now fails immediately and names its unavailable services. A valid headless run is unchanged: it still waits for settlement, creates one persisted Agent and Session, streams its model request, prints final assistant text, and exits through the same hook.

The headless package README records the failure behavior.

## Testing

`packages/bundle/headless/tests/headless.spec.ts` disposes the service subtree while Loader settlement is pending and asserts that the runner calls `appExit(1)` and writes the complete missing-service diagnostic. A real built DSH run then loaded the private gateway credential from the transient environment and printed the expected smoke response.
