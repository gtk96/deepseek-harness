# Agent Note: data-query semantic catalog projection

Status: implemented — DIC-BE projects authorized semantics; DSH ingress prepends catalog to model input.

## Problem

Natural-language问数在 DSH ingress 只收到用户 `question` 时，模型无法知道已发布且已授权的 `datasetCode`/`metricCodes`/`dimensionCodes`，常触发 `DQ_SEMANTIC_INVALID` 或空完成。治理语义目录在 dic-be，但未进入模型可见输入。

## Decision

dic-be 在认领轮次后按主体授权构建 `semantic_catalog` 文本投影，经 `semanticCatalog` 字段随 dispatch 发给 DSH ingress。ingress 在可信服务认证下接受可选 `semanticCatalog`，有界校验后与 `question` 拼成单条用户消息：`catalog + "\n\n---\n\n" + question`。`TrackedDicBeTurn` 与 ingress 幂等比较同时保留 `question` 与 `semanticCatalog`。

## Alternatives considered

- **在 DSH 侧拉取治理目录**：ingress 需额外 broker 调用与主体绑定，违背「鉴权与目录在 dic-be」的嵌入边界。
- **扩展 system prompt 静态列出数据集**：无法按用户授权裁剪，且模型可见 ⟺ 会话日志要求下难以按轮次投影。
- **仅放宽 `data_query` schema 描述**：仍无 per-user 授权视图，模型仍会猜物理表名。
- **把 catalog 放进 tool result 预置消息**：非用户意图输入，且违反「dispatch 即一轮用户问题」的 turn 生命周期。

## Consequences

- 自然语言问数依赖 dic-be 与 ingress 同步部署；catalog 体积受 `maxSemanticCatalogChars` 与 `maxBodyBytes` 约束。
- 会话日志中的用户消息含 catalog 文本；callback 仍只投影 assistant 答案与 `data_query` 结果，不回传 catalog。
- dic-be 无 published 授权数据集时 catalog 仍非空（说明性占位），模型可能无法构造有效查询。

## Acceptance criteria

- dic-be dispatch JSON 可含 `semanticCatalog`；ingress 拒绝未知字段与超长 catalog。
- 带 catalog 的 dispatch 在模型请求中出现 `catalog --- question` 拼接。
- 相同 turn 重复 dispatch（catalog 与 question 一致）返回 202 且不重复驱动 Agent。
- 自然语言问数（如「有多少种货币」）在本地 Compose 栈可 `succeeded` 并返回结果表。
