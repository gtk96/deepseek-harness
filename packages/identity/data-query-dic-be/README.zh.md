# @deepseek-ai/dsh-data-query-dic-be

[English](README.md) | 中文

本包是 `ctx.dataQuery` 的带凭据 DIC-BE HTTP Provider。它使用原生 `fetch` 向固定路径发送一次 `POST`，拒绝重定向，让取消与截止时间覆盖响应正文读取，并且只接受完整且有界的 JSON 表格。DIC-BE 业务拒绝只接受精确的统一 `{code:200,bizCode:"DQ_*",msg,data:{}}` envelope；Provider 只把 `bizCode` 保留为 `DataQueryError` code，绝不暴露 broker message 或 data。

## 配置

显式 `baseURL`，或省略时由 launcher 所有的环境快照读取的 `DATA_AID_QUERY_BASE_URL`，与绝对 `path` 共同选择固定 endpoint。直接构造 `DicBeDataQueryProvider` 时始终必须提供已解析的 `baseURL`。`issuer`、`audience`、`assertionKeyRing`、`assertionActiveKid` 和 `assertionTtlSeconds` 配置 HS256 assertion。key ring 支持轮换重叠期；新 assertion 使用 active `kid`。secret 必须留在部署密钥存储中。`timeoutSeconds`、`maxRows` 与 `maxResultBytes` 还受 30 秒、100 行和 16 MiB 的协议硬上限约束；assertion TTL 最多为 60 秒。

JWT header 精确等于 `{alg:"HS256",typ:"JWT",kid}`。payload 精确包含 `iss`、`aud`、`sub`、`jti`、`iat`、`exp`、`conversationId` 与 `turnId`；`sub` 和两个业务 id 只能来自可信 `DataQueryContext`。POST body 只包含语义请求字段。过滤 operand 始终是非空标量数组，与 DIC-BE wire 协议一致。

成功响应精确包含五个字段：`{columns, rows, rowCount, complete:true, truncated:false}`。column 必须是唯一字符串，row 必须为矩形，`rowCount` 必须一致。cell 可包含嵌套的普通稠密 JSON object 与 array；所有数值必须 finite 且可无损表示，字符串有长度上限，并以迭代式逐 cell 深度／节点上限拒绝病态嵌套。额外字段、非 JSON 内容、重定向、截断、超出行数上限和格式错误的值都会 fail closed。完整 HTTP 文档和规范化结果都按 UTF-8 byte 限制，包括精确边界与多字节处理。

## 模型体验

通过 Data Aid `data_query` Consumer 间接影响；本 Provider 不贡献提示词或工具 schema。

#### KV Cache 影响

不会直接导致失效；assertion 与传输数据不会进入模型可见内容。

## 已知限制与暂缓事项

- **HS256 轮换由外部协调**——DSH 选择 active `kid`，但部署必须同步 DIC-BE 的验证 key ring，并在重叠期后移除旧 key。
- **broker 授权属于外部职责**——本 Provider 证明调用方上下文并验证传输结果；DIC-BE 仍负责防重放以及全部数据集、字段、谓词与行级授权。
