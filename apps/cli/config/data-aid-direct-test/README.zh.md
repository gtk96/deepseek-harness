# 本地 WSL 问数测试

[English](README.md) | 中文

该 overlay 复用已在 WSL 中监听 `127.0.0.1:8765` 与 `127.0.0.1:8766` 的 MaxCompute 与 Hologres MCP 服务。它不启动 Python 查询服务器，也不含凭据。模型只收到 `data_query_maxcompute` 和 `data_query_hologres`；两个原始 MCP bridge 都设置 `exposeTools: false`。

这是单用户功能测试，不是授权方案。两个封装使用 MCP 服务配置的服务身份，不执行端到端用户的表、列或行级作用域。仅将 DSH 绑定到 loopback；不要把这个 overlay 放到 LAN、反向代理或公网监听器之后。

请从 WSL 原生 checkout 运行，而非 Windows 挂载的 `/mnt/e` 路径：挂载文件系统上的 tsx 模块加载可能阻塞启动。部署 checkout 在 `/home/giikin/dsh-data-aid`；先构建再提供 Web 服务：

```sh
cd /home/giikin/dsh-data-aid
export DSH_CLIENT_COMMIT_HASH="$(git -C /mnt/e/dataworks_agent rev-parse HEAD)"
pnpm run build
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch apps/cli/config/data-aid-direct-test/cordis.patch.yml --host 127.0.0.1 --port 3080 --no-open
```

MaxCompute 要求端点带尾斜杠：`http://127.0.0.1:8765/mcp/`。Hologres 会重定向尾斜杠，所以配置的端点是 `http://127.0.0.1:8766/mcp`。

封装只接受一条无分号的 `SELECT` 或 `WITH` 语句，MaxCompute 只用 `execute_sql`，Hologres 只用 `execute_hg_select_sql`，并拒绝 MCP 错误、不完整的结构化响应以及超过配置上限的序列化结果。在 `apps/cli/config/agent-presets/data-aid-direct/agent.cordis.yml` 中修改项目、计算单元、超时与结果上限。
