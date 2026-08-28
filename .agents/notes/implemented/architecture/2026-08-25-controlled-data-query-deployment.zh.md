# Agent Note: 受控问数工作负载隔离

Status: implemented

[English](2026-08-25-controlled-data-query-deployment.md) | 中文

## Problem

受控问数链路同时包含浏览器 API、断言鉴权 broker、Agent 监听器和静态前端。如果共享路由表或 Pod 网络身份，Service selector 配置错误就可能暴露内部 API；在应用启动时建表或写参考数据也会把应用发布与数据库变更耦合。测试部署还需要可评审的秘密引用和不可变镜像，且不能提交环境值。

## Decision

DIC-BE 构建一个镜像，但通过 `APP_SURFACE` 启动两个独立 Deployment：`public` 只挂载浏览器模块与健康端点，`broker` 只挂载内部 data-query router 与健康端点。应用测试要求跨 surface 路径返回 404。两个 Deployment 都覆盖镜像 entrypoint 并直接运行 Gunicorn；独立一次性 Job 精确执行无参数 `python -m app.core.init_db`，独占 DDL 操作。

封闭 DSH data-aid bundle 在专用监听器上拥有精确的存活与就绪路由。其生产镜像仅通过 Node 显式 `--expose-internals` 模式调用构建产物 `apps/cli/lib/bin.js --profile data-aid`，因为 CLI 的强制长生命周期配置 watcher 会挂载 Cordis HMR。镜像 runtime manifest 直接拥有该 profile 使用的 HMR 与 timer，以及随附 Agent preset 导入的 persona 和 authenticated data-aid 包根；离线部署 validator 会在镜像构建前拒绝缺失的 Loader 直接依赖。Docker context 排除了 `.git`，因此 DSH 构建必须显式提供 `DSH_CLIENT_COMMIT_HASH` build arg，源提交缺失或格式非法时快速失败。最终阶段为 UID/GID `10001:10001` 创建可写的 `/home/dsh`，并以该用户运行 `--dump-config`，避免仅以 root 执行的构建 smoke 掩盖运行时 home 不可写问题。DIC-FE 以 test mode 构建、执行敏感 chunk 扫描，并由非 root nginx 只提供 `/fe/bigdata/dic/` 与 `/healthz`。

Kustomize 资源使用 digest 占位符、四个按工作负载拆分且逐键导入的 ExternalSecret、加固 Pod 设置、默认拒绝 NetworkPolicy 和精确出入站规则。TiDB TCP/4000 仅选择 `data-platform` namespace 中带 `app.kubernetes.io/name=tidb` 标签的 Pod；平台标签不同时必须使用经过 gate 验证的 overlay。DSH 镜像部署专用 production 依赖闭包，最终阶段只复制 `/runtime`。运维在 Git 外替换 digest 和非秘密 MaxCompute ConfigMap 占位符前，提交的清单有意保持不可部署。Node 解析器无需集群工具即可验证源码；独立 PowerShell 脚本验证 resolved digest、实际 TiDB 标签、跨 surface 隔离和 assertion kid 行为。

MaxCompute quota 的选择仍由部署拥有。非空 DIC-BE quota 会原样传给 PyODPS；当凭据没有获权的命名 quota 时，部署显式留空会省略 `quota_name` 并使用项目默认资源组。endpoint、project、credential reference、AK/SK、只读 hints、行数上限和 deadline 仍为必需且保持不变，因此这不是 Mock 或数据源回退。

真实治理和端到端验收值也必须保留在 Git 外。故意无效的模板记录必需的数据集、闭合指标和维度元数据、权威 staff 范围、精确主体策略、固定日期基准、预期行及获批故障控制。fail-closed 校验器拒绝额外字段、占位符、凭据、开放主体、变更 SQL、无效交叉引用和仓库内证据路径，且只输出计数与规范 SHA-256 指纹。仅管理员使用的 DIC-BE publisher 通过 stdin 把完全相同的输入字节交给固定校验器；默认模式是只读数据库 plan，且不会注册为 API 或 seed。apply 必须提供外部批准的 acceptance SHA、变更单、审批引用和独占 snapshot，并在持有 MySQL/TiDB 全局锁期间用单个事务完成 reconcile 与复验。pending snapshot 仅在 commit 后提升为正式证据；rollback 会重新校验未变的输入，并要求外部记录的 acceptance、desired 和 snapshot SHA，再检查精确闭包与 drift。输入中的 definition 仍是人工评审材料，因为当前治理 ORM 不持久化该字段。这些工具只能准备 Task 15 和 16；浏览器、审计、DSH、TiDB 与 MaxCompute 证据仍是强制要求。

## Alternatives considered

**由两个 Service 选择同一个 DIC-BE Pod。** 拒绝，因为每个被选 Pod 仍同时具备两套路由和网络身份；selector、代理或端口错误可能暴露内部 broker。

**在 DIC-BE entrypoint 中执行 schema 初始化。** 拒绝，因为副本启动和滚动发布会修改数据库，而且既有 entrypoint 能调用 reference 或 mock 阶段。单独审批的 DDL Job 使操作可见，并让工作负载重启不产生数据库副作用。

**在 overlay 中保存渲染后的 Secret 或带 tag 的镜像。** 拒绝，因为前者会让 Git 携带环境材料，后者允许选择可变工件。ExternalSecret 引用和 registry digest 明确划分这些责任。

**编造命名 quota，或失败后静默改为不带 quota 重试。** 拒绝，因为前者会在真实 MaxCompute 权限下失败，后者会在作业提交后改变部署选择的资源组。项目默认资源组必须由部署显式留空选择，并在提交任何作业前可从配置中识别。

## Consequences

运维必须提供 ClusterSecretStore、namespace、ingress、真实镜像 digest、非秘密 MaxCompute 值和获批的公网 HTTPS 出站控制。readiness 能发现 DIC-BE 数据库及必要 schema 故障，但 DSH readiness 有意不调用模型与 broker，以避免探针级联。可移植 base 仅对公网 HTTPS/443 保留宽目标 CIDR；TiDB 被限制到 namespace 与 Pod selector，且必须核验平台实际标签。Task 14 只有在测试集群、DDL、未知 key 轮换和健康检查形成外部证据后才能完成。
