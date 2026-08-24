# data-aid MSE 钉钉部署

[English](README.md) | 中文

这是 MSE 或企业 SSO proxy 拥有钉钉浏览器登录的生产 DSH Web overlay。它不提供本地登录页：proxy 把未认证浏览器重定向到钉钉、验证回调、移除浏览器提交的任何 `gk-service-user` 与 `gk-service-app` header，并只为已认证的上游请求注入这些 header。

除非请求的直接 TCP peer 等于 `DSH_MSE_PROXY_IP`，DSH 都会拒绝请求。将该值设为 DSH 实际观测到的 MSE/SSO 一跳地址，如相邻 proxy、ingress pod 或负载均衡地址。不要使用 `X-Forwarded-For`、浏览器地址、hostname 或公网 MSE 地址，除非它同时也是直接 peer。随后 Provider 解析注入的钉钉 visitor id，并在每次 Remote 调用前调用非模型的 MaxCompute 权威 MCP bridge。

必需的部署值：

```powershell
$env:DSH_DATA_AID_PUBLIC_AUTHORITY = 'data-aid.example.internal'
$env:DSH_MSE_PROXY_IP = '10.0.0.8'
$env:DATA_AID_MAXCOMPUTE_MCP_URL = 'https://maxcompute-mcp.example.internal/mcp'
$env:DATA_AID_MAXCOMPUTE_MCP_TOKEN = 'replace-with-the-deployment-secret'
$env:DATA_AID_AUTHORITY_DT = '20260819'
$env:DATA_AID_AUTHORITY_HT = '14'
```

`DSH_DATA_AID_PUBLIC_AUTHORITY` 是不含 scheme 或路径的 `host[:port]` 权威。`DATA_AID_AUTHORITY_DT` 与 `DATA_AID_AUTHORITY_HT` 选择精确的 MaxCompute 权威快照；它们必须由部署自动化刷新，绝不由 DSH provider 推断。不要把 MCP token 写进这个 overlay 或提交它。

从仓库根目录启动 DSH 上游监听器：

```powershell
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch apps/cli/config/data-aid-mse/cordis.patch.yml --host 0.0.0.0 --port 3180
```

只向浏览器发布 MSE 公网权威。配置 MSE/企业 SSO 终止 TLS、对浏览器路由执行企业钉钉登录策略、从进入的客户端流量移除两个身份 header、上游注入其验证值，并代理到 DSH 监听器。不要公开暴露 DSH 上游端口：直接请求没有可信 proxy peer，会被拒绝。MaxCompute bridge 配置了 `exposeTools: false`，因此其 `execute_sql` 能力对模型不可用。

MSE 策略与钉钉应用凭据属于基础设施配置。它们有意不存放在 DSH 源码或浏览器 JavaScript 中。本机直接 `http://127.0.0.1:3180` 请求无法重定向到钉钉，因为不经过 MSE。

## 受权业务查询 broker

该 overlay 还选择 `data-aid` preset，其唯一的模型可见数据能力是 `data_query`。工具接受语义目录编码而非 SQL，并经配置的 `dic-be` provider 派发，该 provider 签发短期宿主 Principal 断言并发送给独立查询 broker。把 broker 端点、断言身份与有界查询设置加入部署环境：

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

查询 broker 必须验证断言（`iss`、`aud`、`sub`、`jti`、`iat`、`exp`、会话与轮次绑定），一次性消费 `jti`，并在服务端执行认证 Principal 的表、列、join、谓词与行级权限。它是独立的授权服务，不是 `DATA_AID_MAXCOMPUTE_MCP_URL` 权威 bridge。两个 MCP 客户端对模型保持隐藏；DSH 工具是唯一能附加宿主派生 Principal envelope 的调用方。不要配置未认证的 SQL 端点作为此 broker。
