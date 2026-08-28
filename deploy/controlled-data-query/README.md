# Controlled data-query deployment artifacts

This directory contains commit-ready test-environment artifacts only. No database, image builder, registry, secret manager, Docker daemon, or Kubernetes cluster is contacted by the offline checks. Task 14 remains incomplete until operators render these files with real image digests, apply them to the designated test cluster, run the DDL Job, and capture the cluster verification evidence.

## Platform prerequisites

The platform must provide External Secrets Operator and `ClusterSecretStore/platform-controlled-data-query`. The store name and the `external-secrets.io/v1beta1` fields are deployment assumptions; platform owners must patch them if their installed CRD version or store name differs. `base/external-secret.yaml` creates four independent Secrets: DSH receives only its model key, assertion signer ring/active kid, ingress token, and lifecycle-callback token; public receives only JWT, TiDB password, and the DSH ingress token; broker receives only TiDB, assertion verifier, lifecycle-callback token, and MaxCompute AK/SK material; DDL receives only the TiDB password. The callback token is distinct from both the ingress token and assertion keys and is projected only into DSH and broker. Workloads map every allowed key through an explicit `secretKeyRef`; no workload imports a whole Secret. MaxCompute endpoint, project, and quota are non-secret `dic-be-broker-config` values rendered outside Git, never ExternalSecret properties.

The platform must also provide the `controlled-data-query` or `controlled-data-query-test` namespace, an ingress controller in the `ingress-nginx` namespace with `app.kubernetes.io/component=controller`, TiDB at `tidb.data-platform.svc.cluster.local`, and registry pull authorization. The base NetworkPolicies select namespace `data-platform` and Pods labeled `app.kubernetes.io/name=tidb`; if the platform uses any different namespace or Pod label, its out-of-tree overlay must patch all three TiDB egress peers together, run the manifest gate against the rendered overlay, and make the cluster verifier confirm that the resulting selector matches a live TiDB Pod. Ingress hostnames, TLS, WAF, and MSE/SSO policy remain platform-owned and are intentionally not guessed here.

## Images and rendering

Build DIC-BE from `dic-be/Dockerfile`, DIC-FE from `dic-fe/Dockerfile`, and DSH from `images/dsh/Dockerfile`. Because the root Docker context excludes `.git`, pass the exact source commit with `--build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD)` when building DSH; the build fails closed when that argument is absent or malformed. DIC-FE's build runs `pnpm run build:test`, which includes the existing sensitive chunk scanner. DSH uses the dependency-only `images/dsh/runtime/package.json` deploy root, including direct HMR and timer dependencies loaded by the long-lived `data-aid` profile plus the persona and authenticated data-aid packages loaded by its shipped Agent preset. The offline manifest validator rejects any missing direct runtime Loader dependency. The image build materializes a production-only `/runtime`, removes owned `src`/test trees and all test trees, rejects remaining symlinks, and copies only `/runtime` into the final stage. The final stage creates a writable `/home/dsh` for UID/GID `10001:10001`, imports the built CLI with `node --expose-internals apps/cli/lib/bin.js --profile data-aid --dump-config` as that user, and then removes the smoke state. The final command uses the same built entry and Node option because Cordis HMR loads Node internals; it never contains the repository `/workspace`, source TypeScript, `tsx`, dev dependencies, or secret values.

Every manifest image uses an intentionally unresolved `${DSH_IMAGE_DIGEST}`, `${DIC_BE_IMAGE_DIGEST}`, or `${DIC_FE_IMAGE_DIGEST}` token after `@sha256:`. Replace each token with the 64 hexadecimal characters from the registry digest in a generated render outside Git. The same render or environment overlay must replace the non-secret `${MAXCOMPUTE_ENDPOINT}`, `${MAXCOMPUTE_PROJECT}`, and `${DATA_QUERY_MAXCOMPUTE_QUOTA}` ConfigMap values. Do not apply unresolved files, substitute image tags, or use `latest`. Run the repository's offline source gate before substitution; after substitution, `scripts/verify-cluster.ps1` requires every workload image to match `@sha256:[0-9a-f]{64}` exactly.

## Offline validation

From the repository root, run:

```sh
node deploy/controlled-data-query/scripts/validate-manifests.mjs
pnpm exec vitest run scripts/controlled-data-query-manifest.spec.ts
```

These checks parse YAML directly and require no `kubectl` or `kustomize`. They reject literal Secrets, seed/reference arguments, mutable images, a parameterized DDL command, missing workloads/services/policies, missing probes/resources, and weakened container security settings.

## Governance and acceptance input

Tasks 15 and 16 use the intentionally invalid schema example in [`acceptance/input.template.json`](acceptance/input.template.json) and the procedure in [`acceptance/README.md`](acceptance/README.md). Copy the template to an access-controlled path outside Git and validate it with `node deploy/controlled-data-query/scripts/validate-acceptance-input.mjs <absolute-input-path>`. The fail-closed validator requires exact keys, a real single-table MaxCompute reference, 100-row/30-second limits, published and rejected resources, authoritative staff scope mappings, distinct subjects, exact default-deny policies, a fixed-date read-only benchmark, expected rows, stable rejection/fault codes, approved rollback procedures, and an out-of-tree evidence directory. It rejects placeholders, open subjects, wildcard policies, credentials, secret-bearing fields, mutation SQL, and incomplete cross-references; successful output contains only counts and a canonical SHA-256 fingerprint.

The application exposes no governance-write API. Environment owners must run the administrator-only `python -m app.data_query.governance_publisher` from `dic-be`: default mode is a read-only plan, while apply requires the exact acceptance SHA, change ticket, approval reference, and a new out-of-tree snapshot. Apply output's acceptance, desired, and snapshot SHA values become external rollback approvals; rollback revalidates the same input and refuses snapshot or database drift. Definitions remain human review material because the current governance ORM does not persist them. Input validation and local publisher tests are preparation only: they cannot complete Task 15 or 16 and do not replace the external evidence listed in the acceptance README.

## Deployment order

1. Validate this source tree, build all three immutable images, scan them, and prepare an out-of-tree digest-substituted test overlay.
2. Confirm all four ExternalSecrets reconcile to their same-named runtime Secrets, verify each Secret has exactly the gate-defined key allowlist, and confirm DIC-BE accepts old and new assertion keys as required by [ROTATION.md](ROTATION.md).
3. Apply ConfigMaps, ExternalSecret, Services, NetworkPolicies, and Deployments. The public and broker processes are separate Deployments selected by `APP_SURFACE`; they are not two Services over one Pod. Both DIC-BE Deployments override the image entrypoint with `gunicorn`, so the seed/reference-capable `entrypoint.sh` never runs in production workloads.
4. Create the `dic-be-ddl` Job separately. Its sole invocation is the argument-free `python -m app.core.init_db`; it performs schema creation only. Wait for completion and verify all required tables, indexes, and unique constraints in the designated test database before considering Task 14.2 complete.
5. Configure platform ingress only for `dic-be-public:8000` and `dic-fe:8080`. Never route DSH or `dic-be-broker` through public/browser ingress.
6. Run `scripts/verify-cluster.ps1`. It checks rollout, ExternalSecret, DDL completion, policies, resolved images, DSH readiness, cross-surface 404s, and unknown-`kid` rejection. Capture output plus the database schema evidence; this repository does not claim those checks have run.

## Network controls and risks

Default deny covers ingress and egress. Broker ingress accepts only DSH Pods; DSH ingress accepts only public-worker Pods; public and frontend ingress accept only the labeled ingress controller. Explicit policies allow DNS, public-to-DSH on 3081, DSH-to-broker on 8000, and TiDB TCP/4000 only to the `data-platform` namespace's `app.kubernetes.io/name=tidb` Pods. DSH model-provider and broker MaxCompute HTTPS retain fixed-port 443 egress to `0.0.0.0/0` because portable Kubernetes NetworkPolicy cannot select public DNS names; production should replace those two HTTPS rules with an egress gateway or approved CIDRs. TiDB never uses an `ipBlock`. CNI handling of node-originated kubelet probes must be confirmed before rollout.

Readiness for DIC-BE validates configuration at process load, connects to TiDB, and requires all eight `dq_*` tables. Liveness does not touch dependencies. DSH readiness means the closed Cordis composition and its exact health route loaded; it does not call DIC-BE, the model provider, or MaxCompute. These choices avoid cascading probe traffic but require the cluster verifier for end-to-end dependency checks.

## Rollback

Stop new browser traffic first. Roll back DIC-FE to the prior digest or remove its ingress, then roll back `dic-be-public`, DSH, and `dic-be-broker` to their previous immutable digests. Do not rerun the DDL Job during an application rollback. Schema changes in this release are additive; preserve them unless an independently reviewed database rollback explicitly proves data safety. For assertion failures, follow [ROTATION.md](ROTATION.md): restore DIC-BE acceptance before changing DSH's active key. Re-run readiness, cross-surface 404, unknown-`kid`, network-policy, and no-unexpected-job checks before reopening traffic.
