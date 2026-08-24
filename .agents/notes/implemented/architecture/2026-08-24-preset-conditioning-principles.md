# Agent Note: Preset conditioning — first-request commitment and stable persona bands

Status: implemented

English | [中文](2026-08-24-preset-conditioning-principles.zh.md)

## Problem

A session's behavior mode is set by its first request. After that request the trajectory is strongly anchored: later edits to the persona or the visible tool catalog perturb at most one reasoning block before the original trajectory reasserts. A preset author who plans to "redirect" behavior mid-session — widen the catalog, swap the persona, add instructions after the first turn — is relying on a mechanism that does not work. Separately, model behavior along a persona axis is not continuously tunable: it collapses into a plan-first band and a doer band with an unstable mixed band between them, where behavior degrades. Neither fact was stated in the harness's AGENTS.md, so preset and profile authors had no written guidance on when conditioning takes effect or how to place a persona.

The observations originate from the community `dsh-routing-suite` research artifact (measurements on DeepSeek V4 Pro through a third-party harness). The mechanism that ships in that suite is a separate matter and is not adopted here.

## Decision

The two rules are recorded here; AGENTS.md is at its word budget, so it carries a one-line pointer to this note:

1. **Condition the first request; do not redirect mid-session.** Compose the persona and core tool set before the first request; do not plan to change behavior by editing conditioning after the session starts.
2. **Author toward a stable condition, never a hybrid.** Pick a plan-first or doer band for a preset; do not blend conditions and expect the stronger behavior of either side.

The rules are experience-derived guidance, not a release gate. The `dsh-routing-suite` runtime injector and its keyword-count classification router are not adopted (see Alternatives). The principles are stated without the suite's mechanism, and the source is attributed as a community artifact rather than a DeepSeek finding.

## Alternatives considered

- **Adopt the suite's runtime injector as a dependency.** Rejected: it bypasses the official assembly model in which persistent plugins have exactly one state — configuration, reconciled transactionally by HMR. Injecting into a running web contradicts the plugins-not-loop-changes stance in AGENTS.md and introduces a third-party runtime hack into a production fork.
- **Adopt the keyword-count classification router as a preset mechanism.** Rejected: classification by keyword counts is brittle and was measured on one model and harness; there is no evidence it generalizes, and relying on it would couple preset behavior to prompt lexicons the repository does not control.
- **Leave AGENTS.md silent.** Rejected: preset and profile composition is current work (the controlled data-query profiles), and both rules materially change how those presets should be authored.

## Consequences

Preset and profile authors now have written guidance: they assemble a stable persona and core tool set before the first request and never blend conditions. The suite's tooling stays out of the tree. Because the source is a community experiment, the rules are framed as experience notes and remain subject to repository-owned evidence; a maintainer who observes contrary behavior should update this note rather than treat it as authoritative.
