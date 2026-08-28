# Agent Note: Controlled data-query workload isolation

Status: implemented

English | [中文](2026-08-25-controlled-data-query-deployment.zh.md)

## Problem

The controlled query path combines a browser API, an assertion-authenticated broker, an Agent listener, and static frontend delivery. Sharing one route table or Pod network identity would let a Service selector mistake expose internal APIs, while startup-time schema or reference seeding would couple application rollout to database mutation. Test deployment also needs reviewable secret references and immutable images without committing environment values.

## Decision

DIC-BE builds one image but starts two independent Deployments through `APP_SURFACE`: `public` mounts browser modules and health only, while `broker` mounts only the internal data-query router and health. Application tests require cross-surface paths to return 404. Both Deployments override the image entrypoint and run Gunicorn directly; a separate one-shot Job owns the exact argument-free `python -m app.core.init_db` DDL command.

The closed DSH data-aid bundle owns exact liveness and readiness routes on its dedicated listener. Its production image invokes only the built `apps/cli/lib/bin.js --profile data-aid` entry under Node's explicit `--expose-internals` mode because the CLI's mandatory long-lived config watcher mounts Cordis HMR. The image runtime manifest directly owns HMR and timer for that profile and the persona and authenticated data-aid package roots imported by the shipped Agent preset; the offline deployment validator rejects a missing direct Loader dependency before image build. The Docker context excludes `.git`, so the DSH build requires an explicit `DSH_CLIENT_COMMIT_HASH` build argument and fails closed when the source commit is absent or malformed. The final stage provisions `/home/dsh` for UID/GID `10001:10001` and runs `--dump-config` as that user, so a root-only build smoke cannot conceal an unwritable runtime home. DIC-FE builds in test mode, runs the sensitive-chunk scanner, and serves only `/fe/bigdata/dic/` plus `/healthz` from non-root nginx.

Kustomize resources use digest placeholders, four workload-specific ExternalSecrets with explicit per-key imports, hardened Pod settings, default-deny NetworkPolicy, and exact ingress and egress rules. TiDB TCP/4000 is selected only through the `data-platform` namespace and `app.kubernetes.io/name=tidb` Pods; platform label differences require a validated overlay. The DSH image deploys a dedicated production dependency closure and copies only `/runtime` into its final stage. The committed manifests are intentionally unrenderable until operators replace digest and non-secret MaxCompute ConfigMap placeholders outside Git. A Node parser validates the source without cluster tooling; a separate PowerShell script verifies deployed state, resolved digests, live TiDB labels, cross-surface isolation, and assertion-kid behavior.

MaxCompute quota selection remains deployment-owned. A nonempty DIC-BE quota is passed unchanged to PyODPS; an explicitly empty quota omits `quota_name` and uses the project's default resource group when the credential has no authorized named quota. Endpoint, project, credential reference, AK/SK, read-only hints, row limit, and deadline remain mandatory and unchanged, so this is not a Mock or source fallback.

Real governance and end-to-end acceptance values also remain outside Git. An intentionally invalid template documents the required dataset, closed metric and dimension metadata, authoritative staff scope, exact subject policies, fixed-date benchmark, expected rows, and approved fault controls. Its fail-closed validator rejects extra keys, placeholders, credentials, open subjects, mutation SQL, invalid cross-references, and in-repository evidence paths, then emits only counts and a canonical SHA-256 fingerprint. The administrator-only DIC-BE publisher passes the exact input bytes to that fixed validator over stdin; its default mode is a read-only database plan and it is not registered as an API or seed. Apply requires the externally approved acceptance SHA, change ticket, approval reference, and an exclusive snapshot, then holds a MySQL/TiDB global lock while reconciling and verifying one transaction. A pending snapshot becomes final only after commit; rollback revalidates the unchanged input and requires the externally recorded acceptance, desired, and snapshot SHA values before checking exact closure and drift. Input definitions remain human review material because the current governance ORM does not persist them. These tools only prepare Tasks 15 and 16; browser, audit, DSH, TiDB, and MaxCompute evidence remains mandatory.

## Alternatives considered

**Two Services selecting one DIC-BE Pod.** Rejected because both route sets and both network identities would remain present in every selected Pod; a selector, proxy, or port error could expose the internal broker.

**Run schema initialization in the DIC-BE entrypoint.** Rejected because replica starts and rollouts would mutate the database and the existing entrypoint can invoke reference or mock stages. A separately approved DDL Job makes the operation visible and keeps workload restarts side-effect free.

**Store a rendered Secret or tagged images in the overlay.** Rejected because either choice makes Git carry environment material or permits mutable artifact selection. ExternalSecret references and registry digests keep those responsibilities explicit.

**Invent a named quota or silently retry without one.** Rejected because the former fails against real MaxCompute permissions and the latter changes the deployment's resource choice after submission. Project-default execution requires an explicit empty deployment value and is visible in configuration before any job is submitted.

## Consequences

Operators must supply the ClusterSecretStore, namespaces, ingress, real image digests, non-secret MaxCompute values, and approved public-HTTPS egress controls. Readiness detects DIC-BE database and required-schema failures, but DSH readiness deliberately avoids model and broker calls to prevent probe cascades. The portable base keeps broad destination CIDRs only for public HTTPS/443; TiDB is restricted to a namespace-and-Pod selector whose platform labels must be verified. Task 14 remains incomplete until the test cluster, DDL, unknown-key rotation, and health checks produce external evidence.
