---
description: "Closed dsh profile for service-authenticated, Principal-bound semantic data queries through DIC-BE."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-data-aid`

English | [中文](README.zh.md)

## Summary

Use `dsh --profile data-aid` for the closed controlled-query runtime embedded behind DIC-BE. The profile mounts the minimum Agent and LLM services, the shipped `data-aid` preset, the `dataQuery` runtime and DIC-BE provider, trusted turn binding, one dedicated WebServer carrier, health probes, and the service-authenticated turn ingress. It does not inherit `dsh-base` or `dsh-web-app` and contains no shell, filesystem, Web tool, browser application, generic API, terminal, workflow, subagent, MCP, data-source server, or direct-query row.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The CLI initializes this bundle for `dsh --profile data-aid`. Configure the DIC-BE endpoint, assertion issuer and audience, key ring, active `kid`, request bounds, ingress listener and paths, service identity and token, callback, and health paths through the `DATA_AID_QUERY_*`, `DATA_AID_INGRESS_*`, `DATA_AID_TURN_CALLBACK_*`, and `DATA_AID_HEALTH_*` environment variables documented by the [deployment sample](../../../apps/cli/config/data-aid-mse/README.md). Missing or weak security values fail during Loader startup.

```sh
dsh --profile data-aid
```

The profile disables the user preset root. The CLI supplies only its installation-owned preset root, whose `data-aid` composition contributes the single model-visible `data_query` tool. Deploy DIC-BE as the only caller of the internal ingress; this profile is not a browser or public API surface.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The dedicated ingress authenticates the fixed DIC-BE workload through the exact `X-DSH-Service-Identity` value and a deployment-secret bearer token before reading the body. It accepts the bounded Principal, conversation, turn, question, and optional authorized semantic catalog fields; creates an Agent with a random internal Session id and the default preset; and establishes `DataAidTurnPrincipalService.withTurn()` around synchronous message insertion. When a catalog is present, one logged user message carries `catalog + "\n\n---\n\n" + question`; no request-local Principal is copied into Session state.

The listener defaults to `127.0.0.1`. An explicitly reachable bind requires deployment-owned TLS termination, trusted-network policy, rate controls, and secret rotation. Exact liveness and readiness routes share this carrier and add no browser or generic API. Liveness proves the Node HTTP process responds; readiness proves the closed Cordis composition completed.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Complete closed profile tree and environment-backed deployment configuration |
| [`src/index.ts`](src/index.ts) | Bundle package entry |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion for the static bundle composition |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Controlled-query deployment sample](../../../apps/cli/config/data-aid-mse/README.md) — environment contract and closed-profile launch.
- [Authenticated Data Aid adapter](../../identity/authenticated-principal-data-aid/README.md) — ingress, turn binding, callback, and model-facing tool behavior.
- [Data-query subsystem](../../../docs/subsystems/data-query.md) — public services and controlled semantic request vocabulary.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the shipped `data-aid` preset, which supplies the analyst persona and sole `data_query` tool.

#### KV Cache effect

The fixed persona and tool schema form the stable prefix; each authorized catalog, question, query, and result extends only the per-turn suffix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Ingress perimeter controls remain external** — the bundle authenticates and bounds its exact service route, while TLS, service-mesh authorization, rate limiting, and secret rotation remain deployment responsibilities.
- **Real DIC-BE and governed data acceptance remains external** — keyless composition and snapshots prove the shipped assembly and wire behavior, not a production dataset, user authorization decision, or cloud query job.
- **The profile is intentionally not extensible through user presets** — adding tools requires an explicit trusted profile change and changes the closed-runtime security review.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
