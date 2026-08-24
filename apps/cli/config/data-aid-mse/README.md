# data-aid MSE DingTalk deployment

This is the production DSH Web overlay for an MSE or enterprise SSO proxy that owns the DingTalk browser login. It does not add a local login page: the proxy redirects an unauthenticated browser to DingTalk, validates the callback, removes any browser-supplied `gk-service-user` and `gk-service-app` headers, and injects those headers only for the authenticated upstream request.

DSH rejects the request unless its direct TCP peer equals `DSH_MSE_PROXY_IP`. Set that value to the address DSH actually sees for the MSE/SSO hop, such as the adjacent proxy, ingress pod, or load-balancer address. Do not use `X-Forwarded-For`, a browser address, a hostname, or the public MSE address unless it is also the direct peer. The provider then parses the injected DingTalk visitor id and calls the non-model MaxCompute authority MCP bridge before every Remote invocation.

Required deployment values:

```powershell
$env:DSH_DATA_AID_PUBLIC_AUTHORITY = 'data-aid.example.internal'
$env:DSH_MSE_PROXY_IP = '10.0.0.8'
$env:DATA_AID_MAXCOMPUTE_MCP_URL = 'https://maxcompute-mcp.example.internal/mcp'
$env:DATA_AID_MAXCOMPUTE_MCP_TOKEN = 'replace-with-the-deployment-secret'
$env:DATA_AID_AUTHORITY_DT = '20260819'
$env:DATA_AID_AUTHORITY_HT = '14'
```

`DSH_DATA_AID_PUBLIC_AUTHORITY` is an `host[:port]` authority without a scheme or path. `DATA_AID_AUTHORITY_DT` and `DATA_AID_AUTHORITY_HT` select the exact MaxCompute authority snapshot; they must be refreshed by deployment automation and are never inferred by the DSH provider. Do not place the MCP token in this overlay or commit it.

Start the DSH upstream listener from the repository root:

```powershell
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch apps/cli/config/data-aid-mse/cordis.patch.yml --host 0.0.0.0 --port 3180
```

Publish only the MSE public authority to browsers. Configure MSE/enterprise SSO to terminate TLS, run the enterprise DingTalk login policy for the browser route, strip both identity headers from incoming client traffic, inject its verified values upstream, and proxy to the DSH listener. Do not expose the DSH upstream port publicly: a direct request has no trusted proxy peer and is rejected. The MaxCompute bridge is configured with `exposeTools: false`, so its `execute_sql` capability is unavailable to the model.

The MSE policy and the DingTalk application credentials are infrastructure configuration. They are intentionally not stored in DSH source or browser JavaScript. A local direct `http://127.0.0.1:3180` request cannot redirect to DingTalk because it does not traverse MSE.

## Authorized business query broker

The overlay also selects the `data-aid` preset, whose only model-facing data capability is `data_query`. The tool accepts semantic catalog codes, not SQL, and dispatches through the configured `dic-be` provider, which signs a short-lived host Principal assertion and posts it to the independent query broker. Add the broker endpoint, assertion identity, and bounded query settings to the deployment environment:

```powershell
$env:DATA_AID_QUERY_BASE_URL = 'https://data-query-broker.example.internal'
$env:DATA_AID_QUERY_PATH = '/v1/internal/data-query/query'
$env:DATA_AID_QUERY_ISSUER = 'dsh-web'
$env:DATA_AID_QUERY_AUDIENCE = 'dic-be'
$env:DATA_AID_QUERY_ASSERTION_SECRET = 'replace-with-the-deployment-secret'
$env:DATA_AID_QUERY_ASSERTION_TTL_SECONDS = '30'
$env:DATA_AID_QUERY_TIMEOUT_SECONDS = '30'
$env:DATA_AID_QUERY_MAX_ROWS = '100'
$env:DATA_AID_QUERY_MAX_RESULT_CHARS = '65536'
$env:DATA_AID_QUERY_DEFAULT_LIMIT = '100'
```

The query broker must verify the assertion (`iss`, `aud`, `sub`, `jti`, `iat`, `exp`, conversation and turn binding), consume `jti` once, and enforce the authenticated Principal's table, column, join, predicate, and row permissions server-side. It is a separate authorization service, not the `DATA_AID_MAXCOMPUTE_MCP_URL` authority bridge. Both MCP clients remain hidden from the model; the DSH tool is the only caller that can attach a host-derived Principal envelope. Do not configure an unauthenticated SQL endpoint as this broker.
