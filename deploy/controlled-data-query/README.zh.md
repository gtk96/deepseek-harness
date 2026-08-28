# 受控数据查询部署产物

[English](README.md) | 中文

此目录只包含可直接提交的测试环境产物。离线检查不会连接数据库、镜像构建器、注册表、密钥管理器、Docker daemon 或 Kubernetes 集群。只有运维人员使用真实镜像 digest 渲染这些文件、将其应用到指定测试集群、运行 DDL Job 并采集集群验证证据后，任务 14 才算完成。

## 平台前提条件

平台必须提供 External Secrets Operator 和 `ClusterSecretStore/platform-controlled-data-query`。store 名称和 `external-secrets.io/v1beta1` 字段属于部署假设；如果平台安装的 CRD 版本或 store 名称不同，平台所有者必须修补这些值。`base/external-secret.yaml` 会创建四个相互独立的 Secret：DSH 只能获得模型密钥、assertion 签名密钥环／active kid、ingress token 和生命周期 callback token；public 只能获得 JWT、TiDB 密码和 DSH ingress token；broker 只能获得 TiDB、assertion verifier、生命周期 callback token 和 MaxCompute AK／SK 材料；DDL 只能获得 TiDB 密码。callback token 与 ingress token、assertion key 均不相同，并且只投影到 DSH 和 broker。各 workload 通过显式 `secretKeyRef` 映射每个允许的 key，不会整体导入 Secret。MaxCompute endpoint、project 和 quota 是在 Git 外渲染的非密钥 `dic-be-broker-config` 值，绝不是 ExternalSecret property。

平台还必须提供 `controlled-data-query` 或 `controlled-data-query-test` namespace、位于 `ingress-nginx` namespace 且带有 `app.kubernetes.io/component=controller` 的 ingress controller、地址为 `tidb.data-platform.svc.cluster.local` 的 TiDB，以及 registry pull authorization。基础 NetworkPolicy 选择 namespace `data-platform` 和带有 `app.kubernetes.io/name=tidb` 标签的 Pod；如果平台使用其他 namespace 或 Pod 标签，其仓库外 overlay 必须一起修补全部三个 TiDB egress peer，针对渲染后的 overlay 运行 manifest 门禁，并让集群验证器确认最终 selector 能匹配实时 TiDB Pod。Ingress hostname、TLS、WAF 和 MSE／SSO 策略仍归平台所有，此处有意不作猜测。

## 镜像与渲染

使用 `dic-be/Dockerfile` 构建 DIC-BE，使用 `dic-fe/Dockerfile` 构建 DIC-FE，使用 `images/dsh/Dockerfile` 构建 DSH。根 Docker context 会排除 `.git`，因此构建 DSH 时需通过 `--build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD)` 传入准确的源 commit；缺少该参数或参数格式错误时，构建会以关闭方式失败。DIC-FE 构建会运行 `pnpm run build:test`，其中包括现有敏感 chunk 扫描器。DSH 使用仅含依赖的 `images/dsh/runtime/package.json` 部署根目录，其中包含长期运行的 `data-aid` profile 加载的直接 HMR 和 timer 依赖，以及其随附 agent preset 加载的 persona 和 authenticated data-aid 包。离线 manifest 验证器会拒绝缺失任何直接运行时 Loader 依赖的情况。镜像构建会生成仅含生产依赖的 `/runtime`，删除自有的 `src`／测试树和所有测试树，拒绝残留 symlink，并且只将 `/runtime` 复制到最终 stage。最终 stage 为 UID／GID `10001:10001` 创建可写的 `/home/dsh`，以该用户运行 `node --expose-internals apps/cli/lib/bin.js --profile data-aid --dump-config` 导入已构建 CLI，随后删除冒烟状态。最终命令使用相同的已构建入口和 Node 选项，因为 Cordis HMR 会加载 Node internals；其中绝不包含仓库 `/workspace`、TypeScript 源码、`tsx`、dev dependency 或密钥值。

每个 manifest 镜像都在 `@sha256:` 后使用有意保持未解析的 `${DSH_IMAGE_DIGEST}`、`${DIC_BE_IMAGE_DIGEST}` 或 `${DIC_FE_IMAGE_DIGEST}` token。请在 Git 外生成的 render 中，用 registry digest 的 64 个十六进制字符替换每个 token。同一 render 或环境 overlay 还必须替换 ConfigMap 中非密钥的 `${MAXCOMPUTE_ENDPOINT}`、`${MAXCOMPUTE_PROJECT}` 和 `${DATA_QUERY_MAXCOMPUTE_QUOTA}` 值。不要应用含未解析值的文件，不要改用 image tag 或 `latest`。替换前运行仓库的离线源门禁；替换后，`scripts/verify-cluster.ps1` 会要求每个 workload 镜像严格匹配 `@sha256:[0-9a-f]{64}`。

## 离线验证

在仓库根目录运行：

```sh
node deploy/controlled-data-query/scripts/validate-manifests.mjs
pnpm exec vitest run scripts/controlled-data-query-manifest.spec.ts
```

这些检查直接解析 YAML，不需要 `kubectl` 或 `kustomize`。它们会拒绝 literal Secret、seed／reference 参数、可变镜像、参数化 DDL 命令、缺失的 workload／service／policy、缺失的 probe／resource，以及弱化的容器安全设置。

## 治理与验收输入

任务 15 和 16 使用 [`acceptance/input.template.json`](acceptance/input.template.json) 中有意设为无效的 schema 示例，并遵循 [`acceptance/README.md`](acceptance/README.zh.md) 中的流程。将模板复制到 Git 外受访问控制的路径，并使用 `node deploy/controlled-data-query/scripts/validate-acceptance-input.mjs <absolute-input-path>` 进行验证。以关闭方式失败的验证器要求 key 完全匹配、真实的单表 MaxCompute reference、100 行／30 秒限制、已发布及被拒绝的 resource、权威 staff scope mapping、彼此不同的 subject、准确的默认拒绝 policy、固定日期的只读 benchmark、expected row、稳定的 rejection／fault code、已批准的 rollback procedure，以及仓库外 evidence directory。它会拒绝 placeholder、open subject、wildcard policy、credential、包含密钥的 field、mutation SQL 和不完整的 cross-reference；验证成功时只输出 count 和 canonical SHA-256 fingerprint。

应用不会公开治理写入 API。环境所有者必须从 `dic-be` 运行仅供管理员使用的 `python -m app.data_query.governance_publisher`：默认模式是只读 plan；apply 则要求准确的 acceptance SHA、change ticket、approval reference 和新的仓库外 snapshot。apply 输出中的 acceptance、desired 和 snapshot SHA 值会成为外部 rollback approval；rollback 会重新验证同一输入，并在 snapshot 或数据库发生 drift 时拒绝执行。由于当前 governance ORM 不会持久化 definition，它们仍是人工评审材料。输入验证和本地 publisher 测试只是准备工作：它们无法完成任务 15 或 16，也不能替代 acceptance README 中列出的外部证据。

## 部署顺序

1. 验证此源代码树，构建全部三个 immutable image，扫描这些镜像，并准备位于仓库外、已替换 digest 的测试 overlay。
2. 确认全部四个 ExternalSecret 均已协调为同名运行时 Secret，验证每个 Secret 只含门禁定义的 key allowlist，并按 [ROTATION.md](ROTATION.md) 的要求确认 DIC-BE 能接受新旧 assertion key。
3. 应用 ConfigMap、ExternalSecret、Service、NetworkPolicy 和 Deployment。public 与 broker 进程是由 `APP_SURFACE` 选择的独立 Deployment，而不是同一个 Pod 上的两个 Service。两个 DIC-BE Deployment 都使用 `gunicorn` 覆盖镜像 entrypoint，因此支持 seed／reference 的 `entrypoint.sh` 绝不会在生产 workload 中运行。
4. 单独创建 `dic-be-ddl` Job。它唯一执行的命令是不带参数的 `python -m app.core.init_db`，且只创建 schema。等待其完成，并在认为任务 14.2 完成前验证指定测试数据库中全部必需的 table、index 和 unique constraint。
5. 平台 ingress 只能配置到 `dic-be-public:8000` 和 `dic-fe:8080`。绝不能通过 public／browser ingress 路由 DSH 或 `dic-be-broker`。
6. 运行 `scripts/verify-cluster.ps1`。它检查 rollout、ExternalSecret、DDL 完成状态、policy、已解析 image、DSH readiness、cross-surface 404 和未知 `kid` rejection。采集其输出和 database schema evidence；本仓库不声称这些检查已经运行。

## 网络控制与风险

默认拒绝同时覆盖 ingress 和 egress。Broker ingress 只接受 DSH Pod；DSH ingress 只接受 public-worker Pod；public 和 frontend ingress 只接受带标签的 ingress controller。显式 policy 允许 DNS、public 到 DSH 的 3081 端口、DSH 到 broker 的 8000 端口，以及只连接 `data-platform` namespace 中带 `app.kubernetes.io/name=tidb` 标签 Pod 的 TiDB TCP／4000。由于可移植 Kubernetes NetworkPolicy 无法选择公共 DNS 名称，DSH 模型提供方和 broker MaxCompute HTTPS 保留固定端口 443 到 `0.0.0.0/0` 的 egress；生产环境应使用 egress gateway 或批准的 CIDR 替换这两条 HTTPS rule。TiDB 绝不使用 `ipBlock`。rollout 前必须确认 CNI 如何处理源自 node 的 kubelet probe。

DIC-BE readiness 在进程加载时验证配置、连接 TiDB，并要求全部八个 `dq_*` 表都存在。Liveness 不访问依赖。DSH readiness 表示封闭 Cordis composition 及其准确的 health route 已加载；它不会调用 DIC-BE、模型提供方或 MaxCompute。这些选择可以避免级联 probe 流量，但仍需使用集群验证器执行端到端依赖检查。

## 回滚

首先停止新的浏览器流量。将 DIC-FE 回滚到上一 digest 或移除其 ingress，然后将 `dic-be-public`、DSH 和 `dic-be-broker` 回滚到之前的 immutable digest。应用回滚期间不要重新运行 DDL Job。本版本 schema 变更均为 additive；除非另行评审的数据库 rollback 明确证明数据安全，否则应予保留。assertion 失败时，遵循 [ROTATION.md](ROTATION.md)：先恢复 DIC-BE acceptance，再更改 DSH active key。重新运行 readiness、cross-surface 404、未知 `kid`、network-policy 和 no-unexpected-job 检查后，才能重新开放流量。
