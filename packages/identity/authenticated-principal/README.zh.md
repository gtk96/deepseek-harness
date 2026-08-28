---
description: "Request-local authenticated Principal service definition for trusted DSH host transports and authorization consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-authenticated-principal

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-authenticated-principal` 是 DSH Host 上已认证账户的 Service Definition。`AuthenticatedPrincipalService` 提供 `ctx.authenticatedPrincipal.current()`、`require()`、`withPrincipal()` 和 `withoutPrincipal()`；提供方实现 `authenticate(request, signal)`，并负责部署侧身份验证与权限查询。

Principal 是 request-local 的进程状态。它从可信 transport request 开始，携带 data-aid 既有的身份映射与鉴权事实，并在返回的操作完成后清除。它绝不会复制到 Session、消息、匿名用户 id、Agent ownership 字段、Typert wire 参数或模型请求中。`freezeAuthenticatedPrincipal()` 会在发布前将 Principal 记录及权限数组浅冻结为只读值。

## 目录

- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## Principal 字段

| DSH 字段 | data-aid 既有来源 | 含义 |
|---|---|---|
| `ddUserId` | 解码后的 `gk-service-user.id` | 可信网关访问者记录中的钉钉用户 id |
| `clientId` | 解码后的 `gk-service-app.clientId` | 可选的网关应用 id |
| `gkUserId` | 既有身份映射（`gk_userid`） | 映射后的 GK 账户 id |
| `gimpStaffId` | 既有身份映射（`gimp_staff_id`） | 映射后的员工 id |
| `dataRole` | `data_role` | 原有数据角色，保持不变 |
| `teamCodes` | `team_codes` | 原有团队范围，保持不变 |
| `dataOrgCodes` | `data_org_code` | 原有组织范围，保持不变 |
| `authorizedScope` | 部署 resolver，可选 | 提供方拥有的 opaque 鉴权数据 |

Service Definition 不实现 `data_role`、家族、团队、组织或鉴权 SQL 规则。部署提供方调用现有 data-aid 服务或 SQL 并返回解析字段；DSH 只为 Consumer 携带解析结果。

## 提供方与消费方角色

| 包或角色 | 职责 |
|---|---|
| `@deepseek-ai/dsh-authenticated-principal`（本包） | Service Definition、带 brand 的身份词汇、request-local 作用域与生命周期 |
| `@deepseek-ai/dsh-authenticated-principal-data-aid` | data-aid 网关访问者解析器与 resolver 适配器 |
| 部署 resolver | 既有 `dd_userid` 映射与权限 SQL／服务；DSH 不重新实现 |
| Remote／问数 Consumer | 调用 `ctx.authenticatedPrincipal.require()`，只使用解析后的权限事实 |

Consumer 不得接受模型或 Remote 参数中的 `user_id`、`data_role`、团队或组织覆盖值。resolver 是这些字段的权威来源。

## 生命周期

`withPrincipal()` 会跟踪返回的同步值或 Promise。Service 释放时拒绝新的作用域，等待已返回的操作完成，然后才禁用 `AsyncLocalStorage`；脱离返回链的工作仍由分离它的子系统负责，不得继续持有鉴权能力。

<a id="model-experience"></a>
## 模型体验

无，因为 Principal 与 transport request 对模型隐藏，不会向 prompt 或 session log 追加已认证账户或权限字段。

#### KV Cache 影响

与模型前缀缓存无关；认证元数据保持在模型可见请求内容之外。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **提供方负责信任判断**——Service Definition 不判断 forwarded header 是否来自 MSE、可信反向代理或签名 transport；提供方必须先完成该验证再解析身份。
- **权限规则仍在 DSH 之外**——本包携带 resolver 输出但不包含既有 data-aid SQL，因此部署必须提供 resolver，并在映射或权限事实不可用时拒绝请求。
- **只提供进程内传播**——worker、子进程、队列及后续 HTTP 边界必须重新认证并物化新的显式 Principal，不能期待 ALS 传播。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
