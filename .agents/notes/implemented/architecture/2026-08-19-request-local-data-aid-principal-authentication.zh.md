# Agent Note: HTTP Remote 调用的 request-local data-aid Principal 认证

Status: implemented

[English](2026-08-19-request-local-data-aid-principal-authentication.md) | 中文

## 问题

Remote `/api` 调用需要在问数 Consumer 运行前取得可信 data-aid 网关身份与既有权限结果，但账户身份不能成为 Session 数据、消息内容、匿名遥测身份、Agent ownership 或 Typert wire 参数。Connection 浏览器信任栅栏可以防御混淆代理人与 DNS rebinding，却不能证明钉钉账户，也不能解析 `data_role`、`team_codes` 和 `data_org_code`。

## 决策

`@deepseek-ai/dsh-authenticated-principal` 定义 `ctx.authenticatedPrincipal`，并拥有一个生命周期等于 Gateway 返回操作的 AsyncLocalStorage 作用域。其不可变 Principal 携带带 brand 的 `ddUserId`、映射后的 GK 与 GIMP id，以及 resolver 原样返回的角色和数据范围；它不会写入 Session 或 Agent 状态。

`@deepseek-ai/dsh-authenticated-principal-data-aid` 提供 data-aid 适配器。它要求部署提供网关验证器，严格解析标准 Base64 UTF-8 的 `gk-service-user` 与可选 `gk-service-app` header，并把 `dd_userid` 映射和权限事实委托给 resolver。缺失、格式错误、不可信、无法映射或执行失败的输入都会以 `PrincipalAuthenticationError` fail closed；不存在只检查 header 的 `X-Forwarded-Host` 信任，也不存在匿名降级。

Connection 在已有信封解析与信任检查之后，把原始 Fetch `Request` 作为 transport metadata 传给解码后的 RPC handler。组合 Principal Service 时，Typert Gateway 认证该 request，并在描述符解析和业务执行期间建立 request-local 作用域，将认证失败映射为通用 RPC `unauthorized`。Gateway 直接调用方显式传入 Principal；未传入时清除 ambient 状态；Service 不存在却显式传入 Principal 时以 `authentication-unavailable` 失败。

Provider 仍由部署组合决定。data-aid 包为 MSE／企业 SSO 拓扑提供 `DataAidMseGatewayAuthenticator`：Connection 在非 wire Fetch metadata 中记录 Node TCP peer address，provider 只有在该地址等于已配置 IP literal 时才接受 `gk-service-user` 和 `gk-service-app`。MSE 或企业 SSO 负责钉钉登录、移除浏览器传入的身份 header，并向上游注入已验证的 header。该包同时为已确认的 MaxCompute 身份与权限快照提供固定的表 resolver：部署代码选择明确的 `dt`／`ht` 分区，并通过直接 query callback 执行生成的 SQL。部署可以使用直接的 `ctx.mcpClients` registry 调用已配置 MaxCompute MCP server，同时禁用模型工具暴露；adapter 只接受完整的结构化 SELECT 结果。DSH 不拥有数据库凭据，不拥有任意项目的权限规则或权限词汇，也不接受模型或 Remote 参数中的权限覆盖，不认证 ACP，也不增加对话行为。

## 替代方案

- **在 DSH 内信任 `X-Forwarded-Host` 或 visitor header 的存在。** 否决：当前 data-aid visitor header 没有签名，只有部署知道 MSE 或反向代理是否已经建立了读取 header 所需的网络或签名信任。
- **把任意项目 SQL 嵌入 DSH。** 否决：固定 resolver 只固化已确认的身份与权限表，并把凭据、transport、分区选择和其他项目规则留给部署；嵌入任意权限逻辑会产生分叉的鉴权规则。
- **把身份放进 wire 参数、Session 或 Agent 状态。** 否决：这些值可能成为模型可见、持久化或 ownership 状态，并能在认证 HTTP request 之外被提供或保留；Principal 改为 request-local 内部状态。
- **让 Agent 或业务 Consumer 负责认证。** 否决：认证必须发生在 Typert 调用之前，使所有已认领 Remote 方法共享同一权限，并确保 Agent 不参与权限判断。

## 后果

HTTP Remote 认证作为可组合能力提供；没有 Principal Provider 的部署保留既有本地行为。部署必须同时提供网关证明，以及固定表 resolver 的 query／分区 hook 或其他既有 resolver。随附 MCP adapter 需要直接 MCP registry 和设置了 `exposeTools: false` 的专用 MaxCompute bridge；连接断开、格式错误、错误或截断的 MCP 响应都会导致认证失败。Connection 的特权方法仍独立于 Principal 认证而固定为仅回环。

第四个 handler 参数是 transport metadata，不是业务载荷，因此生成的 `args` 与 RPC wire 格式保持不变。并发 HTTP 调用得到相互隔离的 ALS store；Service 释放会等待已返回的操作完成后再禁用 store，脱离返回链的工作不会继承持久化的鉴权能力。

稳定的 `unauthorized` 响应不包含 visitor、header、映射 id 或 resolver 诊断。ACP、钉钉对话、NL2SQL、Memory、查询工具和权限 SQL 实现仍不在本集成范围内。

## 验证

单元覆盖严格 visitor 解析、已确认的 MaxCompute SQL 字段与双 id join、显式分区校验、返回身份见证字段校验、SQL 两行上限、外部结果行校验、单行 fail-closed、查询信号传递、直接 MCP 结构化结果校验、verifier 与 resolver 的 fail-closed 行为、不可变权限结果、并发 Principal 隔离、生命周期 draining、transport Request 传递、HTTP 认证、unauthorized 映射和 direct-call 清除。受影响包已独立通过类型检查；已有浏览器信任栅栏仍是第一道载体检查。
