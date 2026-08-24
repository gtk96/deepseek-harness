# Agent Note：Data Aid 使用经授权的查询 broker

状态：已实现

[English](2026-08-20-data-aid-authorized-query.md) | 中文

## 问题

Data Aid MSE overlay 可以通过权限快照认证请求，但不存在模型可见的业务数据能力。若暴露现有的原始 MaxCompute `execute_sql` 工具，模型生成的 SQL 会使用权限凭据，却不会受到已认证用户的表、列、join、谓词或行权限约束。

## 决策

Data Aid 现在组合 `data-aid` preset，其唯一模型可见的数据能力是 `data_query`。工具只接受 SQL，并从 host 所有的 `DataAidTurnPrincipalService` 获取全部身份与 scope 字段，而不读取模型参数。它通过调用者取消信号调用独立的原始 MCP broker，并且只接受完整、受限的表格化结构结果。

turn service 只在 `agent/inbox/inserted` 时捕获 `ctx.authenticatedPrincipal.current()`，按精确的 Agent 和消息身份记录，并在该精确消息被 claim 时关联到 turn。它在 claim 或 discard 时删除排队状态，在 `agent/turn-stopping` 时删除活动状态，在 Agent dispose 时删除所有状态。它从不把 Principal 数据写入持久化 session log。一个 turn 中出现冲突 Principal 会拒绝数据访问。

broker 接收由已认证 Principal 派生的不可变 envelope，并必须在服务端执行只读 SQL 与 scope 鉴权。原有的 `maxcompute-authority.execute_sql` bridge 仍对模型隐藏，只用于模型调用前的身份解析。MSE profile 现在要求独立查询 broker endpoint 和 token；部署还提供 project、计算、超时、行数和 JSON 大小限制。

## 考虑过的替代方案

**向模型暴露 `maxcompute-authority.execute_sql`。** 不采用：authority bridge 的凭据不是终端用户数据授权机制。

**在 DSH 工具中授权 SQL。** 不采用：客户端 SQL 解析无法证明跨表、列、join、谓词和行过滤的授权。

**在 Session event 中持久化 Principal 数据。** 不采用：身份和授权事实会变成可重放的持久化状态，而 authenticated-principal seam 承诺不在 Session 或 Agent 中存储它们。

**在工具中读取 `ctx.authenticatedPrincipal.current()`。** 不采用：Web prompt 的 Remote 会在后续模型 turn 和工具执行前返回，因为它只负责入队。

## 结果

Data Aid 模型可以从 `data_query` 结果形成业务回答，原始 MCP 工具仍不会出现在其目录中。每次查询都需要已认证的活动 turn 和已配置 broker 的完整响应。缺失身份、身份冲突、传输故障、部分或截断结果、格式错误的行、计数不一致以及违反配置限制都会 fail closed。

本地 data-aid fixture 现在提供确定性的 authorized-query endpoint，并验证收到的 envelope。定向测试覆盖只在 turn 内可用的 Principal、冲突拒绝、turn 停止时移除、envelope 派生以及对不完整或超限 broker 结果的拒绝。生产发布仍取决于部署真实 broker，使其执行所述服务端授权语义；仅靠 DSH 配置不能提供这些规则。

上述模型可见工具面已由 [语义化 data_query 工具](2026-08-24-data-query-semantic-tool.md) 取代——它接受目录编码而非 SQL，并经 `ctx.dataQuery` 派发；本 note 描述的认证主体与轮次绑定接缝仍然有效。
