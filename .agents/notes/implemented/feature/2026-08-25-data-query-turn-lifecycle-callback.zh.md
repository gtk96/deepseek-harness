# Agent Note: 受控问数轮次生命周期回调

Status: implemented

[English](2026-08-25-data-query-turn-lifecycle-callback.md) | 中文

## Problem

DIC-BE 会持久化浏览器轮次并置为 queued，DSH 也能接受派发，但生产路径没有把真实 Agent turn 接到 DIC-BE 既有状态机。ingress 成功后，浏览器可能永远轮询到 `queued`；若把业务 ID 写入 Session 来关联完成事件，又会让授权上下文进入模型日志。

## Decision

封闭 Data Aid ingress 只在有界进程内存中保留已认证 principal、conversation id、turn id、question、Agent 与 message id。包含精确 binding 值、credential 模式或 raw SQL 的模型输入会被拒绝。精确 message 被 claim 时，ingress 使用固定服务认证向仅 broker 挂载的 DIC-BE 路由回调 `running`；精确的持久 `turn/end` 随后生成一个严格终态回调，其中只能有受限 assistant text、已验证受控结果或稳定错误码。

DIC-BE 在读取有界 JSON body 前认证回调，校验完整 principal／conversation／turn binding，并复用 `service.update_turn_state()` 作为状态和审计提交点。相同回调重放不产生操作；终态之后迟到的 `running` 会被接受但不回退；冲突或逆向迁移失败关闭。public workload 不挂载回调路由。

回调尝试次数有限，而且进程可能在 ingress 接受后崩溃，因此持久派发 worker 还负责 accepted turn 完成看门狗。超过配置 deadline 后仍为 `queued` 或 `running` 的 accepted turn 会通过条件迁移进入 `timed_out`，写入规范内稳定码 `DQ_AGENT_FAILED` 与对应审计。并发终态回调会先改变行，使看门狗行锁条件无法匹配，因此由终态回调获胜。

## Alternatives considered

- **把 DIC-BE ID 写入 DSH Session event。** 否决，因为 Session 是模型历史来源，会使业务授权 identifier 持久化并靠近模型。
- **把 `agent/status: idle` 当成一次派发结果。** 否决，因为 Agent status 覆盖整个 Agent activity，无法把输出归因到一条 queued message；精确 inbox claim 与持久 turn number 才能定义所需区间。
- **让 DIC-BE 轮询 DSH Session 状态。** 否决，因为这会创建靠近浏览器的 Session API、暴露 Harness 内部实现，而且仍然需要安全的业务 ID 映射。
- **无限重试回调。** 否决，因为 teardown 将无法达到静止状态，broker 不可用时还会保留无界工作；有界重试加持久 DIC-BE 看门狗可以提供最终终态。

## Consequences

业务 ID 和回调 credential 不进入模型输入或 Session event，浏览器可见状态遵循既有单向 DIC-BE 状态机。回调 token 与 ingress／assertion credential 相互独立，只注入 DSH 与 broker workload。ingress 去重只在进程内有效，因此 DIC-BE 仍是唯一持久幂等权威，并且不会重试已确认接受的派发。DSH 崩溃可能把完成延迟到看门狗 deadline，但不会再留下永久非终态轮次。
