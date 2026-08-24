# @deepseek-ai/dsh-data-query-dic-be

[English](README.md) | 中文

本包是 `ctx.dataQuery` 的带凭据 DIC-BE HTTP Provider。它使用原生 `fetch` 发起 `POST`，在跟随前拒绝所有重定向，对请求和响应正文使用同一取消／截止信号，并且只接受完整且有界的 JSON 表格。

## 配置

`baseURL` 与绝对 `path` 选择固定 DIC-BE endpoint。`issuer`、`audience`、`assertionSecret` 与 `assertionTtlSeconds` 配置只通过 `x-dsh-principal-assertion` 携带的短期 HS256 JWT。`timeoutSeconds`、`maxRows` 与 `maxResultChars` 限制完整操作和响应。

每个 assertion 包含 `iss`、`aud`、等于 host Principal `gkUserId` 的 `sub`、随机 `jti`、`iat`、`exp`，以及只包含 Principal `dataRole` 的 `dataRoles`。POST body 只含 `datasetCode`、`metricCodes`、`dimensionCodes` 与 `limit`；身份、endpoint、凭据和部署上限都不会进入 body。

成功响应必须是 `application/json`，包含 `success: true`、`complete: true`、`truncated: false`、一致的 `rowCount` 与 `rowsReturned`、字符串 `columns` 和矩形 `rows`。完整 HTTP JSON 文档及规范化 `{columns, rows}` 结果都必须满足 `maxResultChars`，行数不得超过 `maxRows`。

## 模型体验

通过 Data Aid `data_query` Consumer 间接影响；本 provider 不贡献提示词或工具 schema。

#### KV Cache 影响

不会直接导致失效；assertion 与传输数据不会进入模型可见内容。

## 已知限制与暂缓事项

- **共享密钥轮换由部署负责**：每个 provider 实例只启用一个已配置 HS256 secret；协调重叠密钥或 key id 需要未来修改 DIC-BE 协议。
