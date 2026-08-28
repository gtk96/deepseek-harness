# Agent Note: data-query 语义目录投影

Status: implemented

[English](2026-08-27-data-query-semantic-catalog-projection.md) | 中文

## 问题

DSH ingress 在自然语言问数中只收到用户 `question` 时，模型无法得知已发布且已授权的 `datasetCode`、`metricCodes` 和 `dimensionCodes`，经常产生无效语义请求或无法给出有效结果。治理语义目录归 DIC-BE 所有，但仅发送问题不会让目录进入模型可见输入。

## 决策

DIC-BE 认领轮次后构建按 Principal 授权的 `semantic_catalog` 文本投影，并通过 `semanticCatalog` 字段发送给 DSH ingress。ingress 在可信服务认证下接受该可选字段，完成有界长度校验后，将其与 `question` 拼成一条用户消息：`catalog + "\n\n---\n\n" + question`。`TrackedDicBeTurn` 与 ingress 幂等比较同时保留 `question` 和 `semanticCatalog`。

## 考虑过的替代方案

- **由 DSH 拉取治理目录。** ingress 需要额外调用 broker 并绑定 Principal，这与授权和目录投影归 DIC-BE 所有相冲突。
- **在 system prompt 中静态列出数据集。** 静态列表无法按用户授权裁剪，也无法在「模型可见即落入日志」要求下表达逐轮投影。
- **只扩展 `data_query` schema 描述。** 模型仍缺少每用户授权视图，并会继续猜测物理名称。
- **把目录插入为预置 tool-result 消息。** 目录属于用户意图上下文，不是工具结果；合成结果也会违反「dispatch 即一轮用户消息」的生命周期。

## 后果

自然语言问数依赖 DIC-BE 与 ingress 协同部署，目录大小受 `maxSemanticCatalogChars` 和 `maxBodyBytes` 限制。Session 用户消息包含目录文本，而 callback 只投影 assistant 答案与 `data_query` 结果。DIC-BE 找不到已发布且已授权的数据集时，仍会发出说明性的非空目录文本，因此模型可能无法构造有效查询。

## 测试

ingress 测试覆盖未知字段、超长目录、模型输入组合和重复 dispatch 幂等性。组装后的 keyless data-aid 场景覆盖随附 profile 与模型可见 transcript，部署验收路径则在 Compose 栈上执行自然语言问数。
