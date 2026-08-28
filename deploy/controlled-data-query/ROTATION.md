# Assertion key rotation runbook

This procedure rotates the HS256 assertion key shared by DSH and DIC-BE. The platform-provided `ClusterSecretStore/platform-controlled-data-query` remains the source of key material; never paste key values into Git, shell history, ConfigMaps, rendered manifests, Pod output, or tickets. In the commands below, replace `<old-kid>` and `<new-kid>` with non-secret key identifiers.

A secret-manager update is not loaded by a running process. Every phase therefore forces the affected ExternalSecret to reconcile, restarts the exact Deployment, waits for a new ReplicaSet and completed rollout, and verifies the live signing/acceptance behavior before the phase is complete. Record the pre-restart ReplicaSet name and compare it with the post-restart value; a Ready condition alone does not prove that the environment was reloaded.

## Rotation

1. In the approved secret manager, update the `dic-be-broker-runtime` material so its key ring and accepted-kid list contain both `<old-kid>` and `<new-kid>`, while `<old-kid>` remains active. Also update `dsh-runtime`'s key ring to contain both keys while its active kid remains `<old-kid>`. Reconcile and reload the verifier first:

   ```powershell
   kubectl -n controlled-data-query-test get rs -l app.kubernetes.io/name=dic-be-broker
   kubectl -n controlled-data-query-test annotate externalsecret/dic-be-broker-runtime force-sync=$(Get-Date -AsUTC -UFormat %s) --overwrite
   kubectl -n controlled-data-query-test wait --for=condition=Ready externalsecret/dic-be-broker-runtime --timeout=120s
   kubectl -n controlled-data-query-test rollout restart deployment/dic-be-broker
   kubectl -n controlled-data-query-test rollout status deployment/dic-be-broker --timeout=180s
   kubectl -n controlled-data-query-test get rs -l app.kubernetes.io/name=dic-be-broker --sort-by=.metadata.creationTimestamp
   pwsh deploy/controlled-data-query/scripts/verify-cluster.ps1 -Namespace controlled-data-query-test -ExpectedSigningKid <old-kid> -AcceptedKids <old-kid>,<new-kid>
   ```

   The verifier command creates assertions inside the DSH Pod from its mounted key ring without printing key material. Both configured kids must reach broker request validation without `DQ_ASSERTION_INVALID`; an unconfigured kid must return `DQ_ASSERTION_INVALID`, and no MaxCompute job may be created for that rejected request.

2. Reconcile and reload DSH while `<old-kid>` is still active, so its live key ring contains both keys before activation:

   ```powershell
   kubectl -n controlled-data-query-test get rs -l app.kubernetes.io/name=dsh
   kubectl -n controlled-data-query-test annotate externalsecret/dsh-runtime force-sync=$(Get-Date -AsUTC -UFormat %s) --overwrite
   kubectl -n controlled-data-query-test wait --for=condition=Ready externalsecret/dsh-runtime --timeout=120s
   kubectl -n controlled-data-query-test rollout restart deployment/dsh
   kubectl -n controlled-data-query-test rollout status deployment/dsh --timeout=180s
   kubectl -n controlled-data-query-test get rs -l app.kubernetes.io/name=dsh --sort-by=.metadata.creationTimestamp
   pwsh deploy/controlled-data-query/scripts/verify-cluster.ps1 -Namespace controlled-data-query-test -ExpectedSigningKid <old-kid> -AcceptedKids <old-kid>,<new-kid>
   ```

3. Change only `dsh-runtime`'s active kid to `<new-kid>`, retain both keys, force ExternalSecret reconciliation, restart DSH, and wait for a new ReplicaSet and completed rollout using the commands from step 2. Run the verifier with `-ExpectedSigningKid <new-kid> -AcceptedKids <old-kid>,<new-kid>` and complete a real controlled-query turn. The verifier must observe the live DSH active kid as `<new-kid>` and broker acceptance for both kids.

4. Only after step 3 succeeds, record the termination time of the final old DSH Pod. Start the grace clock at that time, not at the secret-manager write, ExternalSecret Ready condition, or rollout-restart command. Wait at least `maximum assertion TTL + maximum verifier clock skew`; with the shipped bounds this is 65 seconds. Use the deployed values and add rollout observation time.

5. After the grace period, remove `<old-kid>` from the broker accepted list and both workload key rings. Reconcile `dic-be-broker-runtime` and `dsh-runtime`, restart **both** `deployment/dic-be-broker` and `deployment/dsh`, and independently wait for each new ReplicaSet and rollout. Run the verifier with `-ExpectedSigningKid <new-kid> -AcceptedKids <new-kid>`, confirm `<old-kid>` and an unknown kid are rejected with `DQ_ASSERTION_INVALID`, complete a controlled-query turn, then retire the old secret-manager version under the platform retention policy.

Never activate a new DSH key before DIC-BE accepts it, and never retire the old key before the post-rollout TTL-plus-skew grace has elapsed.

## Rollback

Before retirement, set DSH active kid back to `<old-kid>` while retaining both keys. Force `dsh-runtime` reconciliation, restart DSH, wait for a new ReplicaSet and completed rollout, then run the verifier with `-ExpectedSigningKid <old-kid> -AcceptedKids <old-kid>,<new-kid>` before resuming traffic.

If the old key has already been retired, restore its secret-manager version and add it to the broker key ring and accepted list first. Force `dic-be-broker-runtime` reconciliation, restart the broker, wait for its new ReplicaSet and rollout, and verify `<old-kid>` acceptance. Only then reactivate `<old-kid>` in `dsh-runtime`, reconcile, restart DSH, wait for its new ReplicaSet and rollout, and rerun the verifier. The TTL grace for any subsequent retirement starts only after the last Pod signing with the rolled-back-from key terminates.

If key integrity is suspected, do not reactivate it: stop new turn dispatch, install a third clean key through the normal verifier-first sequence, reload both Deployments, and let all potentially exposed assertions expire. Every rollback verification also requires both DIC-BE Deployments and DSH ready, an unknown kid rejected, the public workload returning 404 for `/v1/internal/**`, the broker returning 404 for browser routes, and no unexpected MaxCompute job for rejected requests.
