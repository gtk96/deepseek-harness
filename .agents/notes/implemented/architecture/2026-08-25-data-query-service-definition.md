# Agent Note: Controlled data-query Service Definition boundaries

Status: implemented

English | [中文](2026-08-25-data-query-service-definition.zh.md)

## Problem

A controlled data query combines model-produced semantic intent with authenticated user and turn facts, then a network provider derives a short-lived assertion. Putting all three concerns in one request makes trusted fields look model-supplied, lets provider transport details leak into Consumers, and cannot state the safe result independently of one broker response.

## Decision

`@deepseek-ai/dsh-data-query` defines three separate inputs and outputs. `DataQueryRequest` contains only governed semantic codes, filters, time range, ordering, and limit. `DataQueryContext` carries a branded conversation id, branded turn id, and authenticated GK user id outside the request. `DataQueryProvider` receives both values separately and owns any transport assertion; assertions are absent from every public request and result type.

A successful `DataQueryResult` has exactly five fields: `columns`, `rows`, `rowCount`, `complete: true`, and `truncated: false`. SQL, physical mappings, credentials, assertions, job ids, and diagnostics have no successful-result representation.

`DataQueryRuntime` resolves providers at execution time. An explicit id must be registered and available; without one, exactly one available provider is required. Zero, multiple, unavailable, missing, and duplicate registrations fail with stable `DataQueryError` codes. Provider registration is a Cordis effect whose disposer and contributing fiber both remove the registration.

## Alternatives considered

- **Include Principal and turn fields in `DataQueryRequest`.** Rejected because the same object is projected from model JSON by a Consumer; a separate trusted argument makes the security origin explicit and keeps identity out of semantic serialization.
- **Let the runtime create the service assertion.** Rejected because assertion format, key handling, audience, and transport belong to the network Service Provider, not the provider-neutral Service Definition.
- **Select the first registered provider.** Rejected because plugin and HMR order would silently change the backend; explicit or sole-available selection fails instead of guessing.
- **Return only columns and rows.** Rejected because callers also need row-count agreement and explicit completeness/non-truncation guarantees before exposing a result.

## Consequences

Consumers must obtain `DataQueryContext` from trusted turn state and cannot encode it in model arguments. Providers receive the minimum identity needed for the assertion subject rather than role or data-scope claims; the Query Broker remains the authority for roles and authorization. Provider implementations perform untrusted wire validation, while the Service Definition trusts its typed same-process boundary. The stricter separation adds a second query argument and deterministic selection errors, but provider replacement, cancellation, HMR cleanup, and safe result handling no longer depend on registration order or transport-specific fields.
