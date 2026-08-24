# Agent Note: 面向非模型 Consumer 的直接 MCP registry

Status: implemented

[English](2026-08-19-mcp-direct-consumer-registry.md) | 中文

## 问题

部分 Host 操作发生在模型循环之前，但仍需要调用已配置 MCP server；`ctx.tools` 只公开面向模型的工具。通过 ToolRuntime 路由认证会使身份解析依赖模型执行，并把鉴权查询发布给模型。

## 决策

`@deepseek-ai/dsh-mcp-client/mcp-clients` 提供 `ctx.mcpClients`，即原始已连接 MCP caller 的进程内 registry。每个 `mcp-client` bridge 只会在连接成功后注册当前 MCP client，并在该 generation 断开或释放前移除对应的精确注册。`call()` 转发原始 MCP 工具名称、参数、取消信号和 bridge 已配置的超时，并把未经验证的协议结果交给 Consumer。

bridge 新增 `exposeTools`。其解析后的默认值保持为 `true`，供面向模型的 MCP server 使用。内部专用 server 的部署设置为 `false`：bridge 仍连接并发布直接 caller，但会跳过工具发现、工具注册和工具列表通知。data-aid MaxCompute resolver 使用这条路径，并自行验证完整结构化结果。

## 替代方案

- **调用已生成的 `ctx.tools` definition。** 否决：ToolRuntime 面向模型，会把工具执行语义带入认证，并使鉴权查询对模型可用。
- **在 data-aid 包中创建第二个 MCP connection。** 否决：两个 client 会为同一 server 重复认证、transport 配置、重连策略和进程生命周期。
- **把 MCP 文本内容解析为查询行。** 否决：文本无法证明 fail-closed 授权所需的完整行、截断和结果计数事实。

## 后果

非模型 Consumer 可以共享现有 stdio 或 Streamable HTTP client、取消处理、超时和重连生命周期，而不会暴露 server 的工具。部署必须在每个 bridge 前挂载 registry，并使用唯一 server 名称。连接丢失、重试耗尽或释放期间，直接调用会被拒绝；Consumer 必须按自身策略处理失败。通用 registry 不验证特定工具的输入或输出。

## 验证

MCP registry 覆盖重复注册拒绝、精确 disposer 所有权、不可用调用拒绝、原始调用转发、连接生命周期发布、重连替换，以及不会发现工具或发布模型工具的直接专用模式。data-aid 覆盖只有完整结构化 MaxCompute SELECT 结果才能到达其表 resolver。
