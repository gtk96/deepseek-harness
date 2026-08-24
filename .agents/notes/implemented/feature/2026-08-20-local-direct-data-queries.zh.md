# Agent Note: Local direct Data Aid queries use WSL MCP wrappers

Status: implemented

[English](2026-08-20-local-direct-data-queries.md) | 中文

## Problem

本地功能验收需要通过已在 WSL 运行的 MCP 服务获得真实的 MaxCompute 与 Hologres 查询结果，同时不能改变生产 MSE 的授权组合。这些 MCP 服务除只读查询外还发布写入和管理工具。

## Decision

`apps/cli/config/data-aid-direct-test` 将 DSH 直接连接到 WSL loopback 上的 MaxCompute 与 Hologres endpoint。两个 bridge 都设置 `exposeTools: false`。`data-aid-direct` preset 只发布 `data_query_maxcompute` 与 `data_query_hologres`，分别调用 `execute_sql` 和 `execute_hg_select_sql`。

封装只接受一条非空、无分号的 `SELECT` 或 `WITH` 语句，在部署配置中固定服务选择和 MaxCompute project，转发取消信号，并限制模型可见的序列化结果。它们拒绝 MCP 错误和不完整的结构化响应。该 profile 只通过 `--host 127.0.0.1 --port 3080` 运行，必须从 WSL 原生目录而非 Windows 挂载路径启动，并使用 service identity，不进行按用户授权。

## Alternatives considered

**Expose raw MCP tool catalogs.** 不采用：MaxCompute 发布建表和写入工具，Hologres 发布 DML、DDL、procedure 与管理工具。

**Point production `data_query` at either WSL MCP server.** 不采用：生产 `data_query` 需要执行授权的 broker 和由 Principal 派生的 scope；本地 MCP 服务不提供该接口。

**Keep a DSH-owned pyodps query server.** 不采用：它重复了已部署的 WSL MaxCompute MCP 服务，且不能提供 Hologres 访问。

## Consequences

仅 loopback 的 WSL DSH 实例可以向两个系统发起真实的只读问数，而不会把源 MCP 工具放进模型目录。服务端按用户授权 broker 未就绪前，该模式不适用于共享、LAN、反向代理或公开部署。
