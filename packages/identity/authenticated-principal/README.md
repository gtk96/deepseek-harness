# @deepseek-ai/dsh-authenticated-principal

English | [中文](README.zh.md)

`@deepseek-ai/dsh-authenticated-principal` is the Service Definition for an authenticated account at the DSH host. `AuthenticatedPrincipalService` exposes `ctx.authenticatedPrincipal.current()`, `require()`, `withPrincipal()`, and `withoutPrincipal()`; a provider supplies `authenticate(request, signal)` and owns the deployment's identity verification and permission lookup.

The Principal is request-local process state. It starts at a trusted transport request, carries the existing data-aid identity mapping and authorization facts, and is cleared after the returned operation settles. It is never copied into a Session, message, anonymous user id, Agent ownership field, Typert wire argument, or model request. `freezeAuthenticatedPrincipal()` makes the Principal record and its permission arrays shallowly immutable before publication.

## Principal fields

| DSH field | Existing data-aid source | Meaning |
|---|---|---|
| `ddUserId` | decoded `gk-service-user.id` | DingTalk user id from the trusted gateway visitor record |
| `clientId` | decoded `gk-service-app.clientId` | Optional gateway application id |
| `gkUserId` | existing identity mapping (`gk_userid`) | Mapped GK account id |
| `gimpStaffId` | existing identity mapping (`gimp_staff_id`) | Mapped staff id |
| `dataRole` | `data_role` | Existing data role, unchanged |
| `teamCodes` | `team_codes` | Existing team scope, unchanged |
| `dataOrgCodes` | `data_org_code` | Existing organization scope, unchanged |
| `authorizedScope` | deployment resolver, optional | Opaque provider-owned authorization data |

The Service Definition does not implement the `data_role`, family, team, organization, or authorization SQL rules. A deployment provider calls the existing data-aid service or SQL and returns the resolved fields; DSH only carries the result for Consumers.

## Provider and Consumer roles

| Package or role | Responsibility |
|---|---|
| `@deepseek-ai/dsh-authenticated-principal` (this package) | Service Definition, branded identity vocabulary, request-local scope, and lifecycle |
| `@deepseek-ai/dsh-authenticated-principal-data-aid` | Data-aid gateway visitor parser and resolver adapter |
| Deployment resolver | Existing `dd_userid` mapping and authority SQL/service; it is not reimplemented in DSH |
| Remote/query Consumer | Calls `ctx.authenticatedPrincipal.require()` and uses only the resolved permission facts |

A Consumer must not accept `user_id`, `data_role`, team, or organization overrides from model or Remote arguments. The resolver is the authority for those fields.

## Lifecycle

`withPrincipal()` tracks the returned synchronous value or Promise. Service disposal rejects new scopes, waits for returned operations to settle, and only then disables `AsyncLocalStorage`; detached work remains owned by the subsystem that detached it and must not retain authorization capabilities.

## Model Experience

None, as the Principal and transport request are model-hidden and no authenticated account or permission field is appended to a prompt or session log.

#### KV Cache effect

Independent of model-prefix caching; authentication metadata is kept outside model-visible request content.

## Known Limitations and Deferred Work

- **Provider trust is deployment-owned** — the Service Definition does not decide whether a forwarded header came from MSE, a trusted reverse proxy, or a signed transport; a provider must verify that condition before parsing identity.
- **Permission rules remain outside DSH** — the package carries resolver output but does not contain the existing data-aid SQL, so a deployment must supply a resolver and fail closed when mapping or authority data is unavailable.
- **Only process-local propagation is provided** — worker, child-process, queue, and later HTTP boundaries must authenticate and materialize a new explicit Principal rather than expecting ALS propagation.
