# 本地受控 Data Aid broker 冒烟测试

[English](README.md) | 中文

该 patch 以随附的封闭 `data-aid` profile 为目标，只覆盖其中已有的 DIC-BE Provider 配置行。它不能向 `web` 插入受控问数服务；profile 本身不包含 raw MCP Client、MaxCompute／Hologres MCP Server、直查工具、浏览器认证器或数据源凭据。

本地 [`dic-be-fixture.mjs`](dic-be-fixture.mjs) 接受带非空 Principal assertion 的语义请求，并返回确定性的完整表格。加载 profile 前先启动它：

```powershell
node apps/cli/config/data-aid-test/dic-be-fixture.mjs
pnpm dsh --profile data-aid --patch apps/cli/config/data-aid-test/cordis.patch.yml
```

该命令证明随附 profile 无需数据源 bridge 即可加载。它不会把普通进程调用变成可信请求：本仓缺少通过服务认证的 DIC-BE turn ingress，因此除非测试或部署 adapter 在创建 Agent 时挂载默认 preset，并在 Agent 消息插入期间建立完整 binding，否则 `data_query` 会 fail closed。

`examples/headless-agent/tests/fixtures/data-aid` 下的 keyless runnable 场景提供两个完整的可信 binding。其 fake broker 返回一个治理成功结果与一个确定性的策略拒绝，snapshot 记录两段真实 Agent transcript。两个 fixture 都不验证生产网络策略、真实 assertion 防重放、治理目录正确性或 MaxCompute 执行。
