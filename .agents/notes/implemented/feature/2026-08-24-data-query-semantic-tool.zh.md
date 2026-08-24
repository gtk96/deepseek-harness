# Agent Note: 基于 data-query 能力的语义化 data_query 工具

Status: implemented

[English](2026-08-24-data-query-semantic-tool.md) | 中文

## 问题

模型可见的 `data_query` 工具接受一条只读 SQL 查询，并派发给应用认证用户作用域的专用 MCP broker。这把 SQL 留在了模型参数里，也让工具耦合到 broker 专属的封套。受控问数 MVP 要求语义化工具：参数是治理过的目录编码，绝不是 SQL、物理标识符或执行配置，并经由 provider 接缝而非裸 MCP 调用派发。

## 决策

`data_query` 现在只接受语义字段：`datasetCode`、`metricCodes`、`dimensionCodes`、可选的 `filters`、`timeRange`、`orderBy`，以及 `limit`。它在执行时从 `DataAidTurnPrincipalService` 解析认证主体，构造宿主所有的 `DataQueryRequest`，并经 `ctx.dataQuery` 派发给显式配置的 provider。生产装配 `data-query-dic-be` provider，它会为服务端 broker 签发短期主体断言（`iss`、`aud`、`sub`、`jti`、`iat`、`exp`、轮次绑定）。工具不携带任何 SQL 或 broker 线字段；MCP 查询 broker 已从 data-aid 与 data-aid-test 装配中移除，由 data-query 运行时与 dic-be provider 取代。

## 替代方案

- **保留 SQL-broker 工具。** 否决：模型参数里出现 SQL 违反"绝不暴露 SQL"的不变式，工具也会继续耦合到 broker 专属的授权封套。
- **在工具内部授权 SQL。** 否决：客户端解析 SQL 无法证明表、列、连接、谓词或行级授权；必须由 broker 裁决。
- **在工具执行时从环境状态解析主体。** 否决：Web 提示在之后的模型轮次之前就返回，请求级状态不可用；turn 服务是把认证主体绑定到确切所认领轮次的唯一来源。

## 后果

data-aid 预设的模型工具目录精确等于 `['data_query']`，身份与作用域绝不来自模型参数。dic-be provider 及其断言成为生产执行路径；不验证断言的 broker 从模型侧无法触达。`DataQueryRequest` 新增了可选的语义过滤、时间范围与排序。旧 SQL-broker 工具面由 [授权查询 note](2026-08-20-data-aid-authorized-query.md) 记录的决策取代；该 note 描述的认证主体与轮次绑定接缝仍然有效。
