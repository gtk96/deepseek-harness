# Controlled Data Aid profile deployment sample

English | [中文](README.zh.md)

The shipped `data-aid` profile starts from the closed [`@deepseek-ai/dsh-data-aid`](../../../../packages/bundle/data-aid/README.md) bundle rather than `web` or `base`. Its enabled rows contain only the minimum Agent/LLM runtime, the installation-owned `data-aid` preset, the controlled `dataQuery` Runtime, the DIC-BE HTTP Provider, trusted turn binding, a dedicated HTTP carrier, and the strict service-authenticated turn ingress. It mounts no raw MCP Client, MaxCompute/Hologres MCP Server, direct query tool, browser identity resolver, generic API, or data-source credential.

Set the Query Broker and assertion values through the deployment secret store, then start the dedicated profile:

```powershell
$env:DATA_AID_QUERY_BASE_URL = 'https://data-query-broker.example.internal'
$env:DATA_AID_QUERY_PATH = '/v1/internal/data-query/query'
$env:DATA_AID_QUERY_ISSUER = 'dsh-data-aid'
$env:DATA_AID_QUERY_AUDIENCE = 'dic-be:data-query'
$env:DATA_AID_QUERY_ASSERTION_KEY_RING = $env:DATA_AID_QUERY_ASSERTION_KEY_RING_FROM_SECRET_STORE
$env:DATA_AID_QUERY_ASSERTION_ACTIVE_KID = '2026-08'
$env:DATA_AID_QUERY_ASSERTION_TTL_SECONDS = '30'
$env:DATA_AID_QUERY_TIMEOUT_SECONDS = '30'
$env:DATA_AID_QUERY_MAX_ROWS = '100'
$env:DATA_AID_QUERY_MAX_RESULT_BYTES = '1048576'
$env:DATA_AID_QUERY_DEFAULT_LIMIT = '100'
$env:DATA_AID_INGRESS_HOST = '127.0.0.1'
$env:DATA_AID_INGRESS_PORT = '3081'
$env:DATA_AID_INGRESS_PATH = '/v1/internal/data-query/turns'
$env:DATA_AID_INGRESS_SERVICE_IDENTITY = 'dic-be'
$env:DATA_AID_INGRESS_SERVICE_TOKEN = $env:DATA_AID_INGRESS_SERVICE_TOKEN_FROM_SECRET_STORE
pnpm dsh --profile data-aid
```

`DATA_AID_QUERY_ASSERTION_KEY_RING_FROM_SECRET_STORE` must already hold a JSON object whose values are independently generated secrets of at least 32 UTF-8 bytes; no key material belongs in a command, repository file, log, or frontend artifact. `DATA_AID_QUERY_ASSERTION_KEY_RING` keeps verification-overlap keys while `DATA_AID_QUERY_ASSERTION_ACTIVE_KID` selects the signing key. The Provider rejects missing keys, explicit placeholder phrases such as `replace-with`, weak keys, TTL above 60 seconds, timeout above 30 seconds, row limits above 100, redirects, malformed responses, and incomplete results.

The Query Broker verifies exactly `iss`, `aud`, `sub`, `jti`, `iat`, `exp`, `conversationId`, and `turnId`, consumes `jti` once, and performs catalog and row authorization server-side. DSH never receives MaxCompute credentials or a SQL interface. [`cordis.patch.yml`](cordis.patch.yml) is an optional empty deployment layer; apply only id-targeted overrides to the `data-aid` profile, never use it to augment `web`.

## Service ingress

DIC-BE calls the exact configured path with `POST`, `X-DSH-Service-Identity: dic-be`, `Authorization: Bearer <DATA_AID_INGRESS_SERVICE_TOKEN>`, `Content-Type: application/json`, and exactly `{principal, conversationId, turnId, question}`. The profile authenticates before reading the bounded body, rejects extra fields and wrong service credentials, creates the Agent with a random internal Session id and the default preset, and synchronously wraps message insertion in `DataAidTurnPrincipalService.withTurn()`. Only a safety-checked `question` enters the Session and model request; the Principal and business ids remain host-side. Configure `DATA_AID_TURN_CALLBACK_URL` to the broker-only `/v1/internal/data-query/turn-state` route and inject a distinct `DATA_AID_TURN_CALLBACK_SERVICE_TOKEN`. DSH sends `running` after the message is claimed and one strict terminal projection after `turn/end`; the callback route is not mounted by the public DIC-BE workload.

Keep the default loopback bind when DIC-BE reaches DSH through a local sidecar. For a separate workload, explicitly set a reachable `DATA_AID_INGRESS_HOST` and place the listener behind a trusted service mesh or reverse proxy: the carrier does not terminate TLS or provide network authorization, rate limiting, or secret rotation. Generate `DATA_AID_INGRESS_SERVICE_TOKEN_FROM_SECRET_STORE` independently with at least 32 UTF-8 bytes and never store it in this file. The service route does not accept the legacy MSE visitor-header/MaxCompute MCP identity path.
