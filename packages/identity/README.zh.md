---
description: "identity 包组：由遥测、反馈与 DeepSeek 提供方请求共享的匿名按 harness home 关联 id。"
kind: "package-group"
---

# identity/ — 共享身份

[English](README.md) | 中文

## 概述

identity 组将匿名安装关联、已认证用户事实与受控语义查询分离。匿名 id 只属于一个 harness home；已认证 principal 与受信轮次绑定只能由部署自有提供方注入，绝不来自模型参数。各包 README 负责自身配置与安全约定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.zh.md) | 为每个 harness home 提供遥测、反馈与 DeepSeek 请求使用的匿名关联 id |
| [`authenticated-principal`](authenticated-principal/README.zh.md) | 定义请求本地的已认证账号与数据授权事实 |
| [`authenticated-principal-data-aid`](authenticated-principal-data-aid/README.zh.md) | 将受信 Data Aid 入口与权限提供方适配为 principal 和轮次绑定 |
| [`data-query`](data-query/README.zh.md) | 持有受控语义查询提供方注册与分发 |
| [`data-query-dic-be`](data-query-dic-be/README.zh.md) | 使用短期签名 principal assertion 调用 DIC-BE |

<a id="related-documentation"></a>
## 相关文档

- [会话遥测子系统](../../docs/subsystems/session-telemetry.zh.md)——在导出中携带该 id 的遥测功能。
- [dsh-llm-deepseek](../llm/llm-deepseek/README.zh.md)——在请求中携带该 id 的 DeepSeek 提供方。
- [dsh-command-feedback](../feedback/command-feedback/README.zh.md)——在确认文本中点名该匿名安装的反馈命令。

<a id="dev-note"></a>
## 开发备注

无。
