# Task 15 governance publisher independent review — r1

- Date: 2026-08-25
- Status: `approved`
- Scope: administrator publisher code and local SQLite/file safety regressions only
- Findings: P1 = 0, P2 = 0, P3 = 0

## Reviewed surfaces

- `dic-be/app/data_query/application/governance_publication.py`
- `dic-be/app/data_query/governance_publisher.py`
- `dic-be/tests/test_data_query_governance_publisher.py`
- `deploy/controlled-data-query/scripts/validate-acceptance-input.mjs`
- `scripts/controlled-data-query-acceptance.spec.ts`

## Independent verification

The reviewer reran the drift test eight times with a 1.1-second delay between runs; all eight passed across multiple database timestamp seconds. The complete publisher file then passed six consecutive runs, 13 tests per run, followed by one verbose 13-test run. This closes the earlier P3 test race in which restoring only `dataset.name` advanced `updated_at`; the test now restores both fields from the snapshot expected post-state.

The 13 publisher tests cover read-only plan behavior, omission of human-only definitions from ORM projection, exact approval SHA, idempotent apply, global resource collision, exclusive snapshot creation, drift refusal, exact prior-state and microsecond restoration, ticket/approval/self-hash binding, same-byte validator stdin, safe validator errors, pre-commit pending cleanup, forged acceptance closure, duplicate IDs and business keys, malformed snapshot fields and datetimes, foreign policy resources, wrong external snapshot SHA, desired-state mismatch, post-commit finalization failure, and the real fixed parent validator fingerprint smoke.

The reviewer independently confirmed the fixed validator rejects subsecond policy timestamps that the current database projection cannot preserve, while accepting valid whole-second offset timestamps. Snapshot loading now validates exact nested keys, scalar types, canonical datetimes, row IDs, business-key uniqueness, fingerprints, and dataset/resource closure before rollback writes. Ruff reported `All checks passed!`; LSP reported no diagnostics for the two publisher modules and their test.

## Explicit limitation

No real TiDB/MySQL environment was connected. The review does not verify the runtime behavior of `GET_LOCK`/`RELEASE_LOCK`, TiDB transaction and lock contention, TiDB `DATETIME` precision, production evidence storage, or any real governance values. Task 15 remains incomplete until an approved test environment executes plan/apply/rollback and records external database evidence. Local SQLite, synthetic acceptance inputs, and this approval must not be presented as real Task 15 completion.
