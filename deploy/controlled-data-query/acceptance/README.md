# Controlled data-query acceptance input

This directory contains only the schema example for Tasks 15 and 16. `input.template.json` is intentionally invalid and contains no real project, table, subject, policy, SQL, result, credential, or evidence path. A validator success proves that an input is internally complete; it does not prove that governance rows were published, a cluster was deployed, MaxCompute jobs ran, or Tasks 15/16 passed.

## Prepare an input outside Git

1. Copy `input.template.json` to an access-controlled absolute path outside every repository checkout.
2. Replace every placeholder with values approved by the dataset owner, security owner, and test-environment owner. Keep the input itself and the evidence directory outside Git.
3. Put only a `secret-manager://store/reference` locator in `credentialRef`. Never put an access key, secret key, bearer value, cookie, JWT, password, secret payload, or Kubernetes Secret in this file.
4. Use one real MaxCompute `project.table`, a fixed business date, a single read-only benchmark query, and the independently computed expected result (at most 100 rows). The query must select only from that table, use each selected semantic code as its exact `AS` alias, and exactly reproduce the semantic filters, authoritative scope, fixed-date equality, dimension grouping, requested ordering, and limit in the validator's accepted subset. Expected columns are dimensions followed by metrics in semantic-request order. The query and result are acceptance material and must not be copied into repository logs.
5. Name distinct authenticated authorized and unauthorized users. Configure the authorized user from the authoritative staff record: `authority_data_role` supplies data roles, while row scope uses only an approved `scopeMappings.source` field accepted by the validator.
6. Obtain written approval for every fault-control procedure and rollback. The validator never executes a procedure.

Validate the out-of-tree file from the repository root:

```powershell
node deploy/controlled-data-query/scripts/validate-acceptance-input.mjs E:\secure-acceptance\controlled-data-query.json
```

The validator requires Node.js and local Git. It invokes only a shell-free, five-second `git rev-parse` to prove that the supplied repository root is the canonical checkout top level; it does not run hooks or access a remote. Successful output contains only validation counts and a canonical SHA-256 fingerprint. Validation failures report a JSON path and error category, not the rejected value. Store the fingerprint with the change ticket so the governance publication and Task 16 evidence can be tied to the exact reviewed input.

Policy `validFrom` and `expiresAt` values are either `null` or canonical ISO timestamps at whole-second precision with `Z` or an explicit numeric offset. Subsecond values are rejected because the current TiDB/MySQL ORM columns do not declare fractional-second precision; the publisher normalizes accepted offsets to naive UTC without truncating approved data.

## Publish governance data

The data-query application deliberately exposes no governance-write HTTP API. Its administrator-only CLI is `python -m app.data_query.governance_publisher` from the `dic-be` checkout; it is not registered in application bootstrap, `init_db`, or any seed stage. The input `definition` fields remain human review material covered by the acceptance SHA because the current governance ORM does not persist definitions. Do not claim those definitions were written to TiDB.

Run the CLI with only `--input <absolute-path>` first. This is a database read-only plan: it validates the exact input bytes through the fixed parent Node validator, detects global metric/dimension code collisions, and prints only row counts plus acceptance/desired SHA values. It still requires the designated test-database environment configuration; never put a DSN or password on its command line.

Apply is a real test-database change and requires explicit environment-owner confirmation immediately before execution. Provide `--apply`, the validator's exact `--approve-input-sha256`, external `--change-ticket` and `--approval-ref` values, and a new direct child of `evidenceDirectory` as `--snapshot`. The tool holds a MySQL/TiDB global publication lock, performs one transaction, verifies the post-state, writes a pending snapshot before commit, and promotes it only after commit. Record the safe output's acceptance, desired, and snapshot SHA values in the external change ticket. A `.pending` artifact is not success evidence; it indicates a commit result that must be reconciled by the database owner.

Rollback must revalidate the unchanged acceptance input and requires `--rollback`, `--approve-input-sha256`, `--expect-desired-sha256`, `--expect-snapshot-sha256`, the same ticket/approval references, and the final snapshot. It refuses any mismatch, malformed or cross-dataset snapshot closure, or current-state drift before restoring prior rows atomically. The database auto-increment high-water mark is not restored.

Before apply, export or otherwise record the existing rows for every affected code and review the generated plan. Snapshot files contain physical mappings and authorization subjects: keep them in the access-controlled evidence directory, never Git or ordinary logs. Do not add a public seed endpoint and do not use mock/open wildcard policies.

## Required acceptance evidence

Task 15 evidence must show the controlled database publication, authoritative subject resolution, exact default-deny policies, and MaxCompute metadata checks. Task 16 evidence must additionally show: browser success with the real job identifier; benchmark-result equality; no new MaxCompute job for policy, unpublished-metric, denied-dimension, and assertion-replay rejections; 100-row and 30-second limits; approved cancellation and fault cases; the actual DSH tool list `['data_query']`; and sensitive-data scans across browser output, application logs, audit rows, and DSH transcript.

Keep timestamped command output, screenshots, audit extracts, MaxCompute job-list comparisons, rollback evidence, and the fingerprint under `evidenceDirectory`. Redact only for human presentation; retain the access-controlled originals. Never claim a local fake adapter, SQLite test, static manifest gate, local image smoke, or this validator as real MaxCompute or cluster acceptance.
