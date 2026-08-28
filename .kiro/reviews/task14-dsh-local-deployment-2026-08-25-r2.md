## 结论

**APPROVED**。P1：0；P2：0；P3：0。

本评审批准 shipped data-aid Agent preset 的生产 runtime 闭包修复、lockfile 同步、离线 fail-closed 门禁、完整生产 deploy closure 解析和本地真实模型链路证据。它不批准或替代真实 Kubernetes、目标 TiDB、受信 registry digest、ExternalSecret、MaxCompute、治理数据或真实端到端验收。

## 独立检查范围

- `deploy/controlled-data-query/images/dsh/runtime/package.json` 与 `pnpm-lock.yaml` 的 runtime importer。
- shipped `data-aid` Agent preset 直接导入的 `@deepseek-ai/dsh-persona` 与 `@deepseek-ai/dsh-authenticated-principal-data-aid` 包根。
- `validate-manifests.mjs` 的 direct runtime dependency 断言及 `controlled-data-query-manifest.spec.ts` 的 persona 删除 mutation。
- production-only `pnpm deploy --legacy --prod` 闭包中的 Node 包解析。
- 部署 README、英中 Agent Note、pairing record 与 Task 14–16 状态边界。
- 指定文件范围内的凭据值扫描和差异格式。

## 证据

- `node deploy/controlled-data-query/scripts/validate-manifests.mjs`：通过，`28 resources / 10 exact policies`。
- `pnpm exec vitest run scripts/controlled-data-query-manifest.spec.ts`：通过，**15/15**；单独运行 persona mutation 为 **1 passed / 14 skipped**，删除该直接依赖时 validator 按预期拒绝。
- `pnpm install --lockfile-only --frozen-lockfile --offline`：通过，252 个 workspace，lockfile `Already up to date`。
- 临时 `pnpm --filter dsh-data-aid-runtime deploy --legacy --prod` production closure 中，Node `createRequire` 实际解析 `@deepseek-ai/dsh-persona` 与 `@deepseek-ai/dsh-authenticated-principal-data-aid` 均成功；临时目录在检查后移除。
- runtime manifest 与 lock importer 的 47 个 dependency key 一致；pnpm 接受 workspace/link 的规范化结果。
- 指定文件范围凭据值候选为 **0**；只存在秘密名称、引用和占位符。
- 英中 Agent Note pairing 一致；相关 `git diff --check` 通过。
- Task 14、14.1–14.3、15、16、16.1–16.4 仍未勾选，文档明确本地 Docker/MySQL/DeepSeek 证据不证明目标 TiDB、MaxCompute、registry 或集群验收。

## 剩余边界

未执行 Kubernetes apply、ExternalSecret/CNI/NetworkPolicy 运行态检查、目标 TiDB DDL、受信 registry push/digest、MaxCompute 作业、真实治理发布或真实授权/拒绝主体验收。Task 14–16 继续受这些外部输入阻塞。
