# Local data-aid Gateway smoke test

English | [中文](README.zh.md)

This overlay starts a DSH Web profile with a local stdio MCP fixture and the loopback-only `DataAidLoopbackTestAuthenticator`. It is a deterministic integration smoke test for the DSH authentication path; it is not a production DingTalk, MSE, reverse-proxy, or MaxCompute deployment. The fixture imports the repository's existing `dsh-mcp-client` MCP SDK and therefore runs only from this source checkout.

Run from the DSH repository root after building the changed host packages:

```powershell
$env:DSH_HOME = Join-Path $env:TEMP 'dsh-data-aid-smoke'
$env:DSH_DATA_AID_TEST_TOKEN = 'replace-with-a-random-local-test-secret'
$env:DSH_DATA_AID_MCP_FIXTURE_PATH = (Resolve-Path 'apps/cli/config/data-aid-test/maxcompute-mcp-fixture.mjs')
# 起一个本地假 dic-be 查询 broker（另一个终端）
node apps/cli/config/data-aid-test/dic-be-fixture.mjs
pnpm dsh web --patch apps/cli/config/data-aid-test/cordis.patch.yml --port 3180
```

DSH Web binds locally to `127.0.0.1`. Its HTTP bridge exposes the fixed internal `http://dsh.internal` request origin to the local provider, which also requires `x-dsh-data-aid-test-token` to equal `DSH_DATA_AID_TEST_TOKEN`. Send a Base64 visitor header for DingTalk id `014815142220899789` to call `pluginInventory/list`; the fixture returns its verified authority row. Missing, malformed, or wrong-token requests must return the Gateway `unauthorized` response.

The dedicated `maxcompute-authority` bridge uses `exposeTools: false`: its `execute_sql` operation is available only through `ctx.mcpClients` to the authenticator and never appears in the model tool catalog.

The `data-aid` preset exposes only `data_query`. The tool accepts semantic catalog codes (never SQL) and dispatches through the `dic-be` provider, which signs a short-lived Principal assertion for the local HTTP fixture. The fixture accepts a semantic query whenever DSH supplies a non-empty assertion and returns two deterministic rows; it rejects a missing assertion. This proves composition and HTTP wiring only; production requires a broker that verifies the assertion and enforces real table, column, join, predicate, and row authorization server-side.
