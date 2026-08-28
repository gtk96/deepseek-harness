# Agent Note: data-query semantic catalog projection

Status: implemented

English | [中文](2026-08-27-data-query-semantic-catalog-projection.zh.md)

## Problem

When DSH ingress receives only the user's `question` for a natural-language data query, the model cannot know the published and authorized `datasetCode`, `metricCodes`, and `dimensionCodes`. It often produces an invalid semantic request or no useful completion. DIC-BE owns the governed semantic catalog, but a question alone does not place that catalog in model-visible input.

## Decision

After claiming a turn, DIC-BE builds a Principal-authorized `semantic_catalog` text projection and sends it to DSH ingress as `semanticCatalog`. Under trusted service authentication, ingress accepts the optional field, validates its bounded length, and forms one user message as `catalog + "\n\n---\n\n" + question`. `TrackedDicBeTurn` and ingress idempotency comparisons retain both `question` and `semanticCatalog`.

## Alternatives considered

- **Have DSH fetch the governed catalog.** The ingress would need another broker call and Principal binding, contrary to DIC-BE ownership of authorization and catalog projection.
- **List datasets statically in the system prompt.** A static list cannot be trimmed by user authorization and cannot represent a per-turn projection under the model-visible-is-logged requirement.
- **Only broaden the `data_query` schema description.** The model would still lack the per-user authorized view and would continue guessing physical names.
- **Insert the catalog as a prebuilt tool-result message.** The catalog is user-intent context, not a tool result, and a synthetic result would violate the dispatch-as-one-user-turn lifecycle.

## Consequences

Natural-language data query depends on coordinated DIC-BE and ingress deployment, and catalog size is bounded by `maxSemanticCatalogChars` and `maxBodyBytes`. The Session user message contains the catalog text, while the callback projects only the assistant answer and `data_query` result. When DIC-BE finds no published authorized dataset, it still emits explanatory non-empty catalog text, so the model may be unable to construct a valid query.

## Testing

Ingress tests cover unknown fields, oversized catalogs, model-input composition, and idempotent repeated dispatch. The assembled keyless data-aid scenario covers the shipped profile and model-visible transcript, while the deployment acceptance path exercises a natural-language query against the Compose stack.
