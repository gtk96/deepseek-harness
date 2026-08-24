# Agent Note: Branch-based contribution workflow

Status: implemented

English | [中文](2026-08-24-feature-branch-workflow.zh.md)

## Problem

The contribution conventions described PR history and labels but never stated where work should start. A whole feature's exploratory implementation accumulated uncommitted in the master working tree, and follow-up edits kept landing on master until the tree was moved to a feature branch after the fact. AGENTS.md's word budget left no room for a plain statement of the norm.

## Decision

AGENTS.md's Conventions carry the rule: **feature branches only; never commit to master**. Non-trivial work starts on a feature branch (here `feat/controlled-data-query-mvp`); master stays clean and advances only through reviewed merges. The rule is stated in the fewest words the budget allows.

## Alternatives considered

- **Raise the AGENTS.md word ceiling.** Rejected: the ceiling exists to keep the file dense, and the norm fits once adjacent content condenses.
- **Record the norm only in a note, not in AGENTS.md.** Rejected: contributors decide where to work by reading AGENTS.md, not notes.
- **Leave it unwritten.** Rejected: the master working tree that prompted this conversation is exactly the failure the norm prevents.

## Consequences

Contributors and agents have an explicit instruction to open a feature branch before non-trivial work. The existing exploratory implementation moved to `feat/controlled-data-query-mvp` with its working tree intact. Master is no longer an implicit working surface.
