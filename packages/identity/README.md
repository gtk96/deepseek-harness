---
description: "The identity package group: anonymous, per-harness-home correlation ids shared by telemetry, feedback, and DeepSeek provider requests."
kind: "package-group"
---

# identity/ — shared identity

English | [中文](README.zh.md)

## Summary

The identity group separates anonymous installation correlation from authenticated user facts and controlled semantic queries. Anonymous ids remain local to one harness home; authenticated principals and trusted turn bindings enter only through deployment-owned providers and never through model arguments. Each package README owns its configuration and security contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.md) | Gives every harness home one anonymous correlation id for telemetry, feedback, and DeepSeek requests |
| [`authenticated-principal`](authenticated-principal/README.md) | Defines request-local authenticated account and data-authorization facts |
| [`authenticated-principal-data-aid`](authenticated-principal-data-aid/README.md) | Adapts trusted Data Aid ingress and authority providers to principals and turn bindings |
| [`data-query`](data-query/README.md) | Owns controlled semantic-query provider registration and dispatch |
| [`data-query-dic-be`](data-query-dic-be/README.md) | Calls DIC-BE with short-lived signed principal assertions |

<a id="related-documentation"></a>
## Related documentation

- [Session telemetry subsystem](../../docs/subsystems/session-telemetry.md) — the telemetry feature that carries the id on exports.
- [dsh-llm-deepseek](../llm/llm-deepseek/README.md) — the DeepSeek provider that carries the id on requests.
- [dsh-command-feedback](../feedback/command-feedback/README.md) — the feedback command that names the anonymous installation in its acknowledgement.

<a id="dev-note"></a>
## Dev Note

None.
