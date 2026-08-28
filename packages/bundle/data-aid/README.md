# `@deepseek-ai/dsh-data-aid`

English | [中文](README.zh.md)

Closed Profile Bundle for controlled semantic data queries. [`cordis.patch.yml`](cordis.patch.yml) applies directly over an empty profile root and mounts only the minimum Agent/LLM services, the shipped `data-aid` preset roster, the `dataQuery` Runtime, the DIC-BE HTTP Provider, trusted turn binding, one dedicated WebServer carrier, and the strict service-authenticated turn ingress. It does not inherit `dsh-base` or `dsh-web-app` and contains no Shell, filesystem, Web tool, browser application, generic API, terminal, workflow, subagent, MCP, MaxCompute/Hologres server, or direct-query row.

The CLI auto-initializes `dsh --profile data-aid` with this bundle. Configure the DIC-BE endpoint, assertion issuer/audience, key ring, active `kid`, bounds, and the ingress listener/path/service identity/service token through the `DATA_AID_QUERY_*` and `DATA_AID_INGRESS_*` environment variables documented by the [deployment sample](../../../apps/cli/config/data-aid-mse/README.md). Missing or weak security values fail during Loader startup. The profile disables the user preset root; the CLI supplies only its installation-owned preset root, whose `data-aid` composition contributes the single model-visible `data_query` tool.

The bundled ingress authenticates the fixed DIC-BE workload through the exact `X-DSH-Service-Identity` value and a deployment secret bearer token before reading the body. It accepts only `{principal, conversationId, turnId, question}`, mounts the default preset while creating an Agent with a random internal Session id, and establishes `DataAidTurnPrincipalService.withTurn()` around synchronous message insertion. Only the question reaches the model. The listener defaults to `127.0.0.1`; an explicitly reachable bind requires deployment-owned TLS termination, trusted-network policy, rate controls, and secret rotation. The profile does not expose a browser or generic public entry point and does not fall back to MSE visitor headers.

The same dedicated listener exposes exact `GET /healthz/live` and `GET /healthz/ready` routes by default. Liveness proves the Node HTTP process responds; readiness proves the closed Cordis composition completed. `DATA_AID_HEALTH_LIVE_PATH` and `DATA_AID_HEALTH_READY_PATH` may replace the paths. These probes add no browser or generic API.


## Model Experience

Indirectly, through the shipped `data-aid` preset: the model receives its analyst persona and exactly one tool, `data_query`. The bundle contributes no additional model-visible text.

#### KV Cache effect

The profile fixes one preset and one tool-schema prefix for every Agent it creates; query arguments and results vary after that prefix.

## Known Limitations and Deferred Work

- **Ingress perimeter controls remain external** — the bundle authenticates and bounds its exact service route, while TLS, service-mesh authorization, rate limiting, and secret rotation remain deployment responsibilities.
- **Real DIC-BE and MaxCompute acceptance remains external** — the keyless composition and snapshot tests prove the shipped assembly and wire behavior, not a production dataset, user authorization, or cloud job.
