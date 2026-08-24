# identity/ — shared identity

English | [中文](README.zh.md)

Identity values shared across product domains. Anonymous correlation and authenticated request-local account facts are separate capabilities; an authenticated Principal is not an anonymous user id.

| Package | Role | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.md) | Persists one anonymous Harness-home correlation id for telemetry, feedback, and DeepSeek requests | — |
| [`authenticated-principal/`](authenticated-principal/README.md) | Provides request-local authenticated account and data-authorization facts without persistence | `authenticatedPrincipal` |
| [`authenticated-principal-data-aid/`](authenticated-principal-data-aid/README.md) | Adapts trusted data-aid gateway visitors and deployment-owned identity/permission resolvers | `authenticatedPrincipal` |
| [`data-query/`](data-query/README.md) | Service Definition and provider registry for controlled semantic data queries | `dataQuery` |
| [`data-query-dic-be/`](data-query-dic-be/README.md) | Dic-be HTTP provider that signs a short-lived Principal assertion for a semantic query | — |
