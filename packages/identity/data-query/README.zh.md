---
description: "Provider-neutral runtime for controlled semantic data queries with host-owned trusted turn context."
kind: "package-reference"
---

# @deepseek-ai/dsh-data-query

[English](README.md) | 中文

## 概述

`DataQueryRuntime`（`ctx.dataQuery`）是受控语义问数的 Service Definition 与 provider runtime（提供方运行时）。它只接受治理过的语义请求；可信身份与轮次绑定通过独立且由 host 所有的 `DataQueryContext` 传递，传输断言则保持为 Service Provider 的私有实现。

类型与选择规则参考[问数子系统页面](../../../docs/subsystems/data-query.zh.md)。[Service Definition 决策](../../../.agents/notes/implemented/architecture/2026-08-25-data-query-service-definition.zh.md)记录了请求、可信上下文和传输断言彼此分离的原因。

## 目录

- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## 配置

`provider` 可选地固定一个已注册的提供方 id。省略时，每次调用仅在恰好一个已注册提供方报告 `available() === true` 时自动选择。选择绝不依赖注册顺序。

## 服务 API

`registerProvider(provider)` 将唯一命名的提供方安装为 Cordis effect（效果），并返回其 disposer。调用该 disposer 或释放贡献它的 fiber 都会移除注册，HMR（热模块替换）期间同样如此。

`query(request, context, signal?)` 在调用时解析提供方，并原样转发语义 `DataQueryRequest`、可信 `DataQueryContext` 与取消信号。`DataQueryRequest` 不含 Principal、会话/轮次 id、断言、SQL、物理标识符、凭据、端点、超时或提供方选择器。成功的 `DataQueryResult` 精确包含 `columns`、`rows`、`rowCount`、`complete: true` 和 `truncated: false`，不含 SQL 或 job id。

## 失败

提供方选择失败是带稳定错误码的 `DataQueryError`：`DATA_QUERY_PROVIDER_CONFIGURED_MISSING`、`DATA_QUERY_PROVIDER_CONFIGURED_UNAVAILABLE`、`DATA_QUERY_PROVIDER_UNAVAILABLE` 和 `DATA_QUERY_PROVIDER_AMBIGUOUS`。重复注册抛出 `DATA_QUERY_DUPLICATE_PROVIDER`。提供方专属错误码保持开放，因此 Consumer 不得解析消息或假定错误码是封闭联合类型。

## 扩展点

Service Provider 实现 `DataQueryProvider`，使用稳定且规范化的 id，执行廉价的本地 `available()` 检查，为完整操作遵守取消，并且只返回完整且未截断的结果。网络提供方拥有断言创建和 wire validation（线上校验）；这两项职责都不属于本 Service Definition。

<a id="model-experience"></a>
## 模型体验

通过把 `DataQueryRequest` 投影为模型工具并记录对应工具调用与结果的 Consumer 间接影响。

#### KV Cache 影响

不会直接导致失效；所有模型可见 schema、请求和结果渲染变更都由 Consumer 负责。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **不执行模型或 wire validation**：这个带类型的同进程 Service Definition 不解析模型 JSON 或远程响应；Consumer 和网络 Service Provider 必须分别校验各自的不可信输入。
- **每次调用只选择一个提供方**：调用方不能在 `DataQueryRequest` 中选择提供方；路由由部署配置或唯一可用提供方选择负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
