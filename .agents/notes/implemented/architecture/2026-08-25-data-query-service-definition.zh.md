# Agent Note: 受控问数 Service Definition 边界

Status: implemented

[English](2026-08-25-data-query-service-definition.md) | 中文

## 问题

一次受控问数会把模型产生的语义意图与认证用户和轮次事实组合起来，随后由网络提供方派生短期断言。把这三项关注点放在同一个请求里会让可信字段看似由模型提供，使提供方传输细节泄漏到 Consumer，并且无法独立于某一种 broker 响应来陈述安全结果。

## 决策

`@deepseek-ai/dsh-data-query` 定义三组彼此分离的输入与输出。`DataQueryRequest` 只包含治理过的语义编码、过滤、时间范围、排序和限制。`DataQueryContext` 在请求之外携带品牌化会话 id、品牌化轮次 id 和已认证 GK 用户 id。`DataQueryProvider` 分别接收这两个值，并拥有全部传输断言；所有公开请求与结果类型都不含断言。

成功的 `DataQueryResult` 精确包含五个字段：`columns`、`rows`、`rowCount`、`complete: true` 和 `truncated: false`。SQL、物理映射、凭据、断言、job id 和诊断都没有成功结果表示。

`DataQueryRuntime` 在执行时解析提供方。显式 id 必须已注册且可用；未配置 id 时，必须恰好存在一个可用提供方。零个、多个、不可用、缺失和重复注册都使用稳定的 `DataQueryError` 错误码失败。提供方注册是 Cordis effect，其 disposer 和贡献注册的 fiber 都会移除注册。

## 替代方案

- **把 Principal 和轮次字段放进 `DataQueryRequest`。** 否决：同一对象会由 Consumer 从模型 JSON 投影；独立的可信参数会明确安全来源，并让身份远离语义序列化。
- **让运行时创建服务断言。** 否决：断言格式、密钥处理、受众和传输属于网络 Service Provider，而不是提供方无关的 Service Definition。
- **选择最先注册的提供方。** 否决：插件与 HMR 顺序会静默改变后端；显式选择或唯一可用选择会失败而不是猜测。
- **只返回列与行。** 否决：调用方还需要行数一致性以及明确的完整和未截断保证，才能暴露结果。

## 后果

Consumer 必须从可信轮次状态获取 `DataQueryContext`，且不能把它编码进模型参数。提供方只接收断言主体所需的最小身份，而不接收角色或数据范围声明；Query Broker 仍然是角色与授权的权威。提供方实现负责不可信 wire validation，而 Service Definition 信任带类型的同进程边界。更严格的分离增加了第二个查询参数和确定性的选择错误，但提供方替换、取消、HMR 清理和安全结果处理不再依赖注册顺序或传输专属字段。
