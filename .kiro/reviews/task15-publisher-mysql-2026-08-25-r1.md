# Task 15 governance publisher MySQL integration review — r1

- Date: 2026-08-25
- Status: `approved`
- Findings: P1 = 0, P2 = 0, P3 = 0
- Scope: local isolated MySQL 5.7.44 only

## Independent verification

The reviewer started a disposable `mysql:5.7.44` container with a uniquely named `test_` database and ran the two publisher-specific integration tests. Both passed in 1.85 seconds.

The lock test proved that `GET_LOCK` is owned by a connection distinct from the SQLAlchemy write-transaction connection, a concurrent publisher cannot enter its transaction body, and a new connection can acquire and release the same lock after the first publisher exits. An independent post-test query returned `NULL` from `IS_USED_LOCK('dic-be:data-query:governance-publication:v1')`.

The round-trip test created only the four governance tables in the isolated database, persisted a pre-state, executed real MySQL apply and snapshot generation, verified the four-table post-state, then executed rollback and verified exact restoration of the prior dataset and metric with removal of newly published dimension and policy rows. Post-test `information_schema` inspection found zero remaining test tables.

The temporary container was removed and a final name-filtered `docker ps -a` returned no matching containers. The database URL guard requires the MySQL protocol and a database name beginning with `test_` or ending in `_test`; operators must still use a dedicated, non-shared test instance because the integration suite drops and recreates `dq_*` tables and uses an instance-wide lock name.

## Explicit limitation

This evidence is from local MySQL 5.7.44, not the target TiDB environment. It does not execute the administrator CLI with real acceptance data or external approvals, publish real governance values, access MaxCompute, or complete Task 15. Target TiDB lock, transaction, collation, timestamp, permission, and operational behavior remains unverified until the environment owner supplies and approves the designated test platform.
