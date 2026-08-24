# Agent Note: Headless startup missing services fail loud

Status: implemented

[English](2026-08-19-headless-startup-missing-services.md) | 中文

## Problem

一次性 headless runner 在等待 Loader 结算后，如果 `agents`、`agentDefaultModel` 或 `sessions` 不可用便直接返回。它既不写诊断信息，也不调用由启动器持有的 `appExit` 钩子。因此，Node 可能以状态 0 结束，却没有创建 Session、没有发起模型请求，也没有输出回答。

当并发的 Loader 条目仍在结算时 Loader 中止整棵树，就会出现服务缺失。真实的 Loader 错误仍会出现在启动输出的其他位置，但 runner 的静默返回会让产品结果看似一次成功的空任务。

## Decision

Loader 结算后，runner 现在会收集所有不可用的核心服务，并通过既有失败路径报告一条 `headless-runner` 错误。该路径写出诊断信息，并经 `appExit` 请求以 1 退出。正常由信号持有的销毁仍保持原有退出码，因为启动器会合并已经进行中的 shutdown。

## Alternatives considered

- **在提前销毁时保持静默返回。** 被终止的命令没有回答、Session 或请求，以成功状态退出违反一次性 CLI 的可观测结果。
- **直接从插件抛出。** Runner 已有一条统一的错误展示与有界应用 shutdown 路径；绕过它会复制进程行为，并可能造成输出不一致。
- **只特殊处理某个缺失服务。** 三个服务都为启动任务所必需，列出所有缺失服务的一条诊断能让启动状态可操作。

## Consequences

损坏的启动现在会立即失败，并点名不可用服务。有效的 headless 运行不变：仍会等待结算、创建一个持久化 Agent 和 Session、流式发起模型请求、打印最终 assistant 文本，并通过同一个钩子退出。

Headless 包 README 记录了这一失败行为。

## Testing

`packages/bundle/headless/tests/headless.spec.ts` 在 Loader 结算挂起期间销毁服务子树，并断言 runner 调用 `appExit(1)` 且写出完整的缺失服务诊断。随后一次真实 built DSH 运行从瞬态环境加载私有网关凭据，并打印预期的 smoke 响应。
