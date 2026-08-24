# Local WSL data question-answering test

English | [中文](README.zh.md)

This overlay reuses the MaxCompute and Hologres MCP services already listening in WSL at `127.0.0.1:8765` and `127.0.0.1:8766`. It does not start a Python query server and does not contain credentials. The model receives only `data_query_maxcompute` and `data_query_hologres`; both raw MCP bridges set `exposeTools: false`.

This is a single-user functional test, not an authorization solution. The two wrappers use the MCP services' configured service identities and do not enforce end-user table, column, or row scope. Bind DSH to loopback only; do not place this overlay behind a LAN, reverse proxy, or public listener.

Run from a WSL-native checkout, not the Windows-mounted `/mnt/e` path: tsx module loading on the mounted filesystem can block startup. The deployed checkout is `/home/giikin/dsh-data-aid`; build it before serving Web:

```sh
cd /home/giikin/dsh-data-aid
export DSH_CLIENT_COMMIT_HASH="$(git -C /mnt/e/dataworks_agent rev-parse HEAD)"
pnpm run build
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch apps/cli/config/data-aid-direct-test/cordis.patch.yml --host 127.0.0.1 --port 3080 --no-open
```

MaxCompute requires the trailing endpoint slash: `http://127.0.0.1:8765/mcp/`. Hologres redirects a trailing slash, so the configured endpoint is `http://127.0.0.1:8766/mcp`.

The wrappers accept one `SELECT` or `WITH` statement without a semicolon, use only `execute_sql` for MaxCompute and `execute_hg_select_sql` for Hologres, and reject MCP errors, incomplete structured responses, and serialized results above the configured limit. Change projects, compute units, timeouts, and the result limit in `apps/cli/config/agent-presets/data-aid-direct/agent.cordis.yml`.
