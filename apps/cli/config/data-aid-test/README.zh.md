# 本地 data-aid 网关冒烟测试

[English](README.md) | 中文

该 overlay 以本地 stdio MCP fixture 与仅限 loopback 的 `DataAidLoopbackTestAuthenticator` 启动一个 DSH Web profile。它是 DSH 认证路径的确定性集成冒烟测试；不是生产 DingTalk、MSE、反向代理或 MaxCompute 部署。fixture 导入仓库现有的 `dsh-mcp-client` MCP SDK，因此只能从本源码 checkout 运行。

在构建改动的 host 包之后，从 DSH 仓库根目录运行：

```powershell
$env:DSH_HOME = Join-Path $env:TEMP 'dsh-data-aid-smoke'
$env:DSH_DATA_AID_TEST_TOKEN = 'replace-with-a-random-local-test-secret'
$env:DSH_DATA_AID_MCP_FIXTURE_PATH = (Resolve-Path 'apps/cli/config/data-aid-test/maxcompute-mcp-fixture.mjs')
# 起一个本地假 dic-be 查询 broker（另一个终端）
node apps/cli/config/data-aid-test/dic-be-fixture.mjs
pnpm dsh web --patch apps/cli/config/data-aid-test/cordis.patch.yml --port 3180
```

DSH Web 绑定到本机 `127.0.0.1`。其 HTTP bridge 向本地 Provider 暴露固定内部 origin `http://dsh.internal`，Provider 还要求 `x-dsh-data-aid-test-token` 等于 `DSH_DATA_AID_TEST_TOKEN`。为 DingTalk id `014815142220899789` 发送 Base64 visitor header 以调用 `pluginInventory/list`；fixture 返回其验证过的权威行。缺失、格式错误或令牌错误的请求必须返回网关 `unauthorized` 响应。

专用 `maxcompute-authority` bridge 使用 `exposeTools: false`：其 `execute_sql` 操作仅通过 `ctx.mcpClients` 对认证器可用，绝不进入模型工具目录。

`data-aid` preset 只暴露 `data_query`。工具接受语义目录编码（绝不接受 SQL），并经 `dic-be` provider 派发，该 provider 为本地 HTTP fixture 签发短期 Principal 断言。只要 DSH 提供非空断言，fixture 就接受语义查询并返回两行确定性结果；缺失断言会被拒绝。这只能证明组装与 HTTP 接线；生产需要验证断言并在服务端执行真实表、列、join、谓词与行级授权的 broker。
