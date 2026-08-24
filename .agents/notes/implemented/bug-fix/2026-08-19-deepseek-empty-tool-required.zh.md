# Agent Note: DeepSeek empty tool required array

Status: implemented

[English](2026-08-19-deepseek-empty-tool-required.md) | 中文

## Problem

`dsh-llm-deepseek` 在工具不接受参数时，会发送不含 `required` 的 object 工具 schema。JSON Schema 允许省略该字段，但一个 OpenAI 兼容 gateway 将缺失成员解码为 `null`，随后因其 API 要求数组而拒绝整个函数声明。

该失败会在模型作答前终止一个新的 headless 对话：`get_goal` 是该 profile 公布的第一个无参数工具。Harness 请求并不含 JSON `null`；网关在翻译缺失成员时引入了无效值。

## Decision

DeepSeek 协议序列化器现在会复制省略 `required` 的 object 参数 schema，并加入 `required: []`。显式 required 列表保持不变，输入 schema 也不会被修改。对于没有必填属性的 object，`[]` 与省略在 JSON Schema 中语义相同，同时满足更严格的 OpenAI 兼容 gateway。

该归一化属于适配器，因为它针对提供方的协议表示。工具定义仍保留提供方中立的 JSON Schema 投影。

## Alternatives considered

- **只特判 `get_goal`。** 其他无参数工具会在同一个 gateway 上失败，核心工具不应编码某个提供方的协议细节。
- **让核心 JSON Schema 投影始终包含 `required`。** 核心 schema 与提供方无关，省略在这里有效；只有此适配器有证据表明需要新增该字段。
- **新增部署设置。** 加入空数组后 JSON Schema 语义不变，设置无法提供有意义的替代行为。

## Consequences

此前依赖省略的所有 object 参数 schema 现在都会经由该适配器明确声明空 required 列表。模型收到的 schema 语义相同，显式的非空列表保持精确。不会改变会话事件或持久化的模型可见内容。

包 README 在协议格式说明中记录了该归一化。

## Testing

`tests/serialize.spec.ts` 断言：省略的 required 列表会变为 `[]`，显式的非空列表保持不变，调用方的 schema 对象不会被修改。一个私有 gateway 的在线探针曾拒绝省略字段，并接受显式空列表。
