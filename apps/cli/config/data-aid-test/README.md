# Local controlled Data Aid broker smoke

English | [中文](README.zh.md)

This patch targets the shipped closed `data-aid` profile and overrides only its existing DIC-BE Provider row. It cannot insert controlled-query services into `web`; the profile itself contains no raw MCP Client, MaxCompute/Hologres MCP Server, direct query tool, browser authenticator, or data-source credential.

The local [`dic-be-fixture.mjs`](dic-be-fixture.mjs) accepts a semantic query carrying a non-empty Principal assertion and returns a deterministic complete table. Start it before loading the profile:

```powershell
node apps/cli/config/data-aid-test/dic-be-fixture.mjs
pnpm dsh --profile data-aid --patch apps/cli/config/data-aid-test/cordis.patch.yml
```

This command proves that the shipped profile loads without a data-source bridge. It does not make an ordinary process invocation trusted: this repository has no service-authenticated DIC-BE turn ingress, so `data_query` fails closed unless a test or deployment adapter mounts the default preset during Agent creation and establishes the complete binding during Agent message insertion.

The keyless runnable scenario under `examples/headless-agent/tests/fixtures/data-aid` supplies two complete trusted bindings. Its fake broker returns one governed success and one deterministic policy denial, and the snapshot records both real Agent transcripts. Neither fixture verifies production network policy, real assertion replay, governed catalog correctness, or MaxCompute execution.
