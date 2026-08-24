# @deepseek-ai/dsh-data-query

[English](README.md) | 中文

`DataQueryRuntime`（`ctx.dataQuery`）是受控语义问数的 Service Definition 与 provider registry。部署配置必须显式指定一个 provider；注册顺序和 provider 可用性都不会隐式选择后端。

## 服务 API

`registerProvider(provider)` 在贡献它的 fiber 生命周期内安装一个唯一命名的 provider，并返回 disposer。`query(request, signal?)` 在调用时解析已配置 provider，要求其可用，并原样转发请求与取消信号。

`DataQueryRequest` 携带 `datasetCode`、`metricCodes`、`dimensionCodes`、`limit` 和 host 所有的不可变 `principal`。Consumer 必须从已认证 host service 获取该 Principal，不得从外部或模型参数接受它。`DataQueryResult` 是带 `columns` 与 `rows` 的完整矩形表格。

## 模型体验

通过 Data Aid `data_query` 工具等 Consumer 间接影响；本 registry 不贡献提示词、工具 schema 或结果文本。

#### KV Cache 影响

不会直接导致失效；模型可见请求变更由 Consumer 负责。

## 已知限制与暂缓事项

- **每个 runtime 只选择一个 provider**：把不同查询路由到不同 provider 需要独立 Cordis service realm，而不是逐请求 provider 名称。
