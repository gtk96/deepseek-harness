# Agent Note: DeepSeek empty tool required array

Status: implemented

English | [中文](2026-08-19-deepseek-empty-tool-required.zh.md)

## Problem

`dsh-llm-deepseek` emitted an object tool schema without `required` when a tool accepted no arguments. JSON Schema permits the omission, but an OpenAI-compatible gateway decoded the missing member as `null` and rejected the entire function declaration because its API requires an array.

The failure stopped a fresh headless conversation before the model could answer: `get_goal` is the first no-argument tool the profile advertises. The harness request contained no JSON `null`; the gateway introduced the invalid value while translating the absent member.

## Decision

The DeepSeek wire serializer now copies object parameter schemas that omit `required` and adds `required: []`. Explicit required lists pass through unchanged, and the input schema remains unmodified. `[]` has the same JSON Schema meaning as omission for an object with no required properties while satisfying stricter OpenAI-compatible gateways.

The normalization belongs to the adapter because it responds to the provider wire representation. Tool definitions retain their provider-neutral JSON Schema projection.

## Alternatives considered

- **Special-case `get_goal`.** Other no-argument tools would fail on the same gateway, and a core tool should not encode one provider's wire quirk.
- **Make core JSON Schema projection always include `required`.** The core schema is provider-neutral and omission is valid there; only this adapter has evidence that the added field is necessary.
- **Add a deployment setting.** The materialized empty array is JSON Schema-equivalent, so a setting cannot provide a useful alternative behavior.

## Consequences

All object parameter schemas sent through this adapter explicitly state an empty required list when they previously relied on omission. The model receives the equivalent schema, and explicit nonempty lists remain exact. No session event or durable model-visible content changes.

The package README records the normalization under Wire-format notes.

## Testing

`tests/serialize.spec.ts` asserts that an omitted required list becomes `[]`, an explicit nonempty list is preserved, and the caller's schema object is not mutated. A live private-gateway probe accepted the explicit empty list after rejecting the omitted one.
