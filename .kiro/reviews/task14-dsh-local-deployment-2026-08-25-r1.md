# Task 14 DSH 镜像与本地部署独立终审（2026-08-25，R1）

## 结论

**APPROVED**。P1：0；P2：0；P3：0。

本评审批准 DSH 运行时依赖闭包、镜像默认启动命令、Kubernetes 工作负载参数、离线 fail-closed 门禁及本地 Docker Compose smoke 证据。它不批准或替代真实 Kubernetes、目标 TiDB、受信 registry digest、ExternalSecret、MaxCompute 或真实端到端验收。

## 独立检查范围

- `deploy/controlled-data-query/images/dsh/runtime/package.json` 与 `pnpm-lock.yaml` 直接包含 Cordis HMR/timer production closure。
- `apps/cli/src/profile-boot.ts` 的长生命周期 watcher 加载路径，以及 HMR 对 Node internals 的前置条件。
- DSH Dockerfile build smoke、final-user smoke、默认 CMD 与 `deploy/controlled-data-query/base/dsh.yaml` 的一致性。
- `validate-manifests.mjs` 对四个启动路径的精确断言，以及 `controlled-data-query-manifest.spec.ts` 对每条路径移除 `--expose-internals` 的独立 mutation。
- 非 root、read-only、tmpfs、内部网络、HostPort、健康状态与文档中的非目标边界。

## 证据

- `node deploy/controlled-data-query/scripts/validate-manifests.mjs`：通过，`28 resources / 10 exact policies`。
- `pnpm exec vitest run scripts/controlled-data-query-manifest.spec.ts scripts/controlled-data-query-acceptance.spec.ts --reporter=verbose`：通过，2 files / **35 tests**；其中 manifest **14**、acceptance **21**。
- 四条 HMR 参数负向用例均独立通过：Kubernetes args、Docker build smoke、final-user smoke、镜像默认 CMD。
- 本地镜像用户为 `10001:10001`，默认 CMD 为 `node --expose-internals apps/cli/lib/bin.js --profile data-aid`；移除 Compose command 覆盖后运行容器仍使用该参数且 healthy。
- Compose backend 为 internal；mysql/broker/DSH 无 HostPort，public/frontend 仅绑定 `127.0.0.1:18000`/`127.0.0.1:18080`。public 与 frontend 健康端点为 200。
- 部署 README、英中 Agent Note 与 tasks.md 均明确本地 Compose/MySQL 5.7 smoke 不证明 Kubernetes、目标 TiDB、真实 MaxCompute 或真实查询成功。

## 剩余边界

未执行 Kubernetes apply、ExternalSecret/CNI/NetworkPolicy 运行态检查、目标 TiDB DDL、registry push/digest、MaxCompute 作业或真实授权/拒绝主体验收。Task 14–16 继续受这些真实环境输入阻塞。
