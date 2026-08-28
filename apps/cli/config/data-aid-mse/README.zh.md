# 受控 Data Aid profile 部署样例

[English](README.md) | 中文

随附的 `data-aid` profile 从封闭的 [`@deepseek-ai/dsh-data-aid`](../../../../packages/bundle/data-aid/README.zh.md) bundle 启动，而不以 `web` 或 `base` 为基础。其 enabled 配置行只包含最小 Agent／LLM runtime、安装自身持有的 `data-aid` preset、受控 `dataQuery` Runtime、DIC-BE HTTP Provider、可信 turn binding、专用 HTTP carrier 与严格的服务认证 turn ingress。它不挂载 raw MCP Client、MaxCompute／Hologres MCP Server、直查工具、浏览器身份 resolver、通用 API 或数据源凭据。

通过部署 secret store 设置 Query Broker 与 assertion 值，然后启动专用 profile：

```powershell
$env:DATA_AID_QUERY_BASE_URL = 'https://data-query-broker.example.internal'
$env:DATA_AID_QUERY_PATH = '/v1/internal/data-query/query'
$env:DATA_AID_QUERY_ISSUER = 'dsh-data-aid'
$env:DATA_AID_QUERY_AUDIENCE = 'dic-be:data-query'
$env:DATA_AID_QUERY_ASSERTION_KEY_RING = $env:DATA_AID_QUERY_ASSERTION_KEY_RING_FROM_SECRET_STORE
$env:DATA_AID_QUERY_ASSERTION_ACTIVE_KID = '2026-08'
$env:DATA_AID_QUERY_ASSERTION_TTL_SECONDS = '30'
$env:DATA_AID_QUERY_TIMEOUT_SECONDS = '30'
$env:DATA_AID_QUERY_MAX_ROWS = '100'
$env:DATA_AID_QUERY_MAX_RESULT_BYTES = '1048576'
$env:DATA_AID_QUERY_DEFAULT_LIMIT = '100'
$env:DATA_AID_INGRESS_HOST = '127.0.0.1'
$env:DATA_AID_INGRESS_PORT = '3081'
$env:DATA_AID_INGRESS_PATH = '/v1/internal/data-query/turns'
$env:DATA_AID_INGRESS_SERVICE_IDENTITY = 'dic-be'
$env:DATA_AID_INGRESS_SERVICE_TOKEN = $env:DATA_AID_INGRESS_SERVICE_TOKEN_FROM_SECRET_STORE
pnpm dsh --profile data-aid
```

`DATA_AID_QUERY_ASSERTION_KEY_RING_FROM_SECRET_STORE` 必须预先保存 JSON object，其中每个值都是独立生成且至少 32 UTF-8 byte 的 secret；任何命令、仓库文件、日志或前端产物都不得包含 key material。`DATA_AID_QUERY_ASSERTION_KEY_RING` 保存验证重叠密钥，`DATA_AID_QUERY_ASSERTION_ACTIVE_KID` 选择签名密钥。Provider 会拒绝缺失密钥、`replace-with` 等显式占位短语、弱密钥、超过 60 秒的 TTL、超过 30 秒的 timeout、超过 100 行的上限、重定向、畸形响应和不完整结果。

Query Broker 精确验证 `iss`、`aud`、`sub`、`jti`、`iat`、`exp`、`conversationId` 与 `turnId`，一次性消费 `jti`，并在服务端执行目录与行级授权。DSH 不接收 MaxCompute 凭据或 SQL 接口。[`cordis.patch.yml`](cordis.patch.yml) 是可选的空部署层；只能对 `data-aid` profile 中已有的配置行实施 id-targeted override，绝不能用它扩展 `web`。

## 服务 ingress

DIC-BE 使用 `POST`、`X-DSH-Service-Identity: dic-be`、`Authorization: Bearer <DATA_AID_INGRESS_SERVICE_TOKEN>`、`Content-Type: application/json` 及精确的 `{principal, conversationId, turnId, question}` 调用配置 path。profile 在读取有上限的 body 前完成认证，拒绝额外字段与错误服务 credential，使用随机内部 Session id 和默认 preset 创建 Agent，并在同步消息插入外围调用 `DataAidTurnPrincipalService.withTurn()`。只有通过安全检查的 `question` 进入 Session 与模型请求；Principal 和业务 id 留在宿主侧。将 `DATA_AID_TURN_CALLBACK_URL` 配置为仅 broker 挂载的 `/v1/internal/data-query/turn-state`，并注入独立的 `DATA_AID_TURN_CALLBACK_SERVICE_TOKEN`。message 被 claim 后 DSH 发送 `running`，`turn/end` 后发送一个严格终态投影；public DIC-BE workload 不挂载该回调路由。

DIC-BE 通过本地 sidecar 访问 DSH 时保留默认 loopback bind。若它是独立 workload，则显式设置可达的 `DATA_AID_INGRESS_HOST`，并把 listener 放在可信 service mesh 或 reverse proxy 后：该 carrier 不终止 TLS，也不提供网络授权、rate limiting 或 secret rotation。`DATA_AID_INGRESS_SERVICE_TOKEN_FROM_SECRET_STORE` 必须独立生成且至少 32 UTF-8 byte，绝不能写入本文件。服务路由不接受旧的 MSE visitor-header／MaxCompute MCP 身份路径。
