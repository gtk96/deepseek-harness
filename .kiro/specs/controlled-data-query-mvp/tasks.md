# 受控问数 MVP — 实施任务

> 本任务清单以 [需求文档](requirements.md) 和 [设计文档](design.md) 为准。现有工作树包含未提交的探索性实现；执行任务前必须逐文件核对，不得盲目保留、覆盖或删除。

- [ ] 1. 整理当前分支与现有实现
  - 确认 `dic-be`、`dic-fe` 和 DSH 分别位于 `feat/controlled-data-query-mvp` 或约定的同名功能分支。
  - 记录三个仓库的 `git status`，逐文件对照 Spec 分类为保留、修改或移除。
  - 确认未提交内容不包含凭据、真实身份断言、原始生产 SQL 或误写的环境配置。
  - 运行现有定向测试建立基线；不得以删除失败测试恢复绿色。
  - _Requirements: 9.1, 9.6, 10.8_
  - ⏳ 2026-08-24 评审要求重新打开：先前标记完成不充分，证据按评审补齐中（见下）。未重新确认前不得继续任务 2–7。

### 任务 1 证据记录（评审后补充，2026-08-24）

**① 分支与 SHA**
- 三仓库均于 `feat/controlled-data-query-mvp`。
- DSH：功能基线 `3e435bdb4b`（Merge upstream/master，稳定不漂移）。功能工作已全部提交至分支；**复现变更清单用 `git diff --name-status 3e435bdb4b...HEAD`**（本记录落笔时 = 164 文件 / +7723 −100；HEAD 会随后续提交推进，故不在此钉死单一 SHA）。
- dic-be：head `fd723ebb2430437e42a5dfdd6c2a6404ebb69718`，未提交 25 路径（见 ③）。
- dic-fe：head `7651cb4a11aa7a2f308ca832308d63b8fa01e650`，工作树干净。

**② DSH 未提交内容**
- 全部已提交（`git log --oneline 3e435bdb4b..HEAD` 为提交清单）；`dic-be/`、`dic-fe/` 为独立仓库已 gitignore（`git check-ignore dic-be` 通过）。

**③ dic-be 25 路径逐文件分类（保留=基座待后续任务完善；修改=与 Spec 冲突必须改）**
| 路径 | 分类 | 对应 Spec Task | 依据 |
|---|---|---|---|
| `app/core/config.py` | **修改** | T5.1/T9.3 | 单 `dsh_assertion_secret`，Spec 要求 key ring + 轮换；弱默认须启动失败 |
| `app/core/init_db.py` | 修改 | T3.1 | 需建 `dq_*` ORM 表 |
| `app/data_query/infrastructure/assertion.py` | **修改** | T5.2/T5.3 | 断言必填含 `dataRoles`（Spec 要求角色由 dic-be 按 `sub` 权威解析，不得信任断言里的 role）；缺 `kid`、`conversationId`、`turnId`；单 secret |
| `tests/test_data_query_assertion.py` | **修改** | T5.4 | 随 assertion.py 重写 |
| `app/data_query/domain/models.py`、`policy.py` | 保留 | T2.1/T2.2 | 领域模型/授权策略基座 |
| `app/data_query/domain/error_code.py` | 保留 | T8.1 | 稳定错误码 |
| `app/data_query/infrastructure/broker.py`、`repo.py` | 保留 | T6/T3.3 | Query Broker/仓储事务基座 |
| `app/data_query/application/service.py`、`audit.py` | 保留 | T2/T4/T7 | 会话轮次服务/审计（含脱敏键清单） |
| `app/data_query/interfaces/router.py`、`schemas.py` | 保留 | T4.2/T4.1,T6.1 | 会话 API/严格 schema |
| `app/data_query/init_db.py`、`__init__.py`×5（data_query、application、domain、infrastructure、interfaces） | 保留 | T3.1 | 初始化 |
| 其余 `tests/test_data_query_*.py`（6 个） | 保留 | T2.3/T6.1/T6.4/T7 | 定向测试 |

**④ 基线命令与结果（实际运行）**
- DSH：`node_modules/.bin/vitest run packages/api/gateway packages/client/connection packages/host/apiproxy packages/mcp/mcp-client packages/llm/llm-deepseek packages/bundle/headless` → **865 passed / 45 文件**；`node_modules/.bin/vitest run packages/identity/data-query packages/identity/data-query-dic-be packages/identity/authenticated-principal packages/identity/authenticated-principal-data-aid` → **97 passed**；`node_modules/.bin/tsc -b packages/identity/data-query/tsconfig.json packages/identity/data-query-dic-be/tsconfig.json packages/identity/authenticated-principal/tsconfig.json packages/identity/authenticated-principal-data-aid/tsconfig.json` → exit 0。
- dic-be：`python -m pytest -q` → **290 passed / 214 failed / 6 warnings**（记录当前工作树基线；未通过干净基线对照归因这些失败）；`pytest tests/test_data_query_*.py` → **33 passed / 0 failed**。
- dic-fe：`pnpm install` 后 `node_modules/.bin/vitest run` → **261 passed / 33 文件**。

**⑤ 敏感信息扫描（命令与结果）**
- 命令：`grep -rniE "access[_-]?key|secret[_-]?key|password[=:][^ ']|LTAI|AKID|dsak|Bearer [a-zA-Z0-9]{20,}" apps/cli/config packages/identity .kiro dic-be/app/data_query dic-be/tests/test_data_query*.py --include="*.yml" --include="*.yaml" --include="*.mjs" --include="*.md" --include="*.ts" --include="*.py" | grep -viE "process\.env|os\.getenv|settings\.|config\.|getenv|\$\{|placeholder|replace|test-|fixture|_password\b|audit.*redact|键名包含"`
- 结果（精确重放）：第一阶段无过滤产出 **5 条候选**——3 条为规范/命令文本自引用（文本本身含关键词），2 条为 `dic-be/app/data_query/application/audit.py` 的脱敏键名清单条目（`access*key`/`access_key` 类，非凭据）；人工核验 5 条均非凭据/真实 JWT/生产 SQL。完整过滤管道后无凭据候选。`.env.example` 为空值示例。

**⑥ 待办（评审遗留）**
- [ ] 上述证据核验后再勾选任务 1（README 陈旧引用已随本记录提交）。

- [ ] 2. 完成 dic-be 语义治理领域模型
  - [ ] 2.1 定义数据集、指标、维度和授权策略领域值对象
    - 定义发布状态、MaxCompute 数据源、物理映射、指标聚合、维度类型与允许过滤操作。
    - 定义用户/数据角色主体、allow/deny 和有效期。
    - 保持领域对象与 SQLAlchemy 实体解耦。
    - _Requirements: 4.1–4.10, 5.1–5.6_
  - [ ] 2.2 实现默认拒绝授权函数
    - 按数据集、指标、维度、过滤维度和排序字段逐项授权。
    - 实现 deny 优先、未知主体不匹配、过期策略不生效。
    - 输出不可变 `AuthorizedSemanticQuery` 和稳定拒绝原因码。
    - _Requirements: 4.1–4.8, 8.1_
  - [ ] 2.3 增加领域属性测试与示例测试
    - 覆盖空策略、混合 allow/deny、重复字段、极限 limit 和非 MaxCompute 数据集。
    - _Requirements: 4.1–4.8, 5.5_

- [ ] 3. 完成 dic-be 治理与会话持久化
  - [ ] 3.1 定义并创建 `dq_*` ORM 表
    - 创建 `dq_dataset`、`dq_metric`、`dq_dimension`、`dq_access_policy`、`dq_conversation`、`dq_turn`、`dq_audit_log` 和 `dq_assertion_nonce`。
    - 为业务编码、会话/轮次 ID 和 `jti` 建立唯一约束；为审计查询建立索引。
    - _Requirements: 2.1–2.6, 4.1–4.10, 7.1–7.7_
  - [ ] 3.2 接入统一数据库初始化
    - `create_schema` 只创建表，不写默认数据集或授权。
    - `seed_reference` 和 `seed_mock` 不得自动开放数据访问。
    - _Requirements: 4.10, 9.6_
  - [ ] 3.3 实现仓储与事务
    - 会话和轮次按可信用户读取。
    - `jti` 使用唯一键和事务保存点原子消费，并清理过期 nonce。
    - 审计与状态更新在明确提交点发布。
    - _Requirements: 1.4–1.6, 2.3–2.6, 7.5_
  - [ ] 3.4 增加真实数据库方言集成测试
    - 使用隔离 TiDB/MySQL 测试库验证唯一约束、并发重放和时间字段。
    - 不以 SQLite 行为代替 TiDB 唯一键与事务验证。
    - _Requirements: 7.5, 10.4_

- [ ] 4. 实现浏览器会话 API
  - [ ] 4.1 实现严格输入输出 Schema
    - 创建会话请求不接受身份字段。
    - 创建轮次只接受 1–2000 字符的 `question`，`extra=forbid`。
    - 轮次响应不包含 SQL、断言、作业 ID 或凭据。
    - _Requirements: 1.1, 2.1–2.6_
  - [ ] 4.2 实现会话、轮次与状态路由
    - 实现 `POST /v1/data-query/conversations`。
    - 实现 `POST /v1/data-query/conversations/{conversationId}/turns`。
    - 实现 `GET /v1/data-query/turns/{turnId}`。
    - 所有资源读取执行拥有者匹配。
    - _Requirements: 2.1–2.7_
  - [ ] 4.3 实现轮次后台派发抽象
    - 定义 `DshTurnClient`，传递可信主体和轮次上下文，不把主体放入浏览器可控请求体。
    - 使用有所有权的后台执行机制；进程重启后可恢复或明确失败。
    - _Requirements: 1.2, 2.4–2.6_
  - [ ] 4.4 增加 FastAPI 真实路由测试
    - 覆盖鉴权中间件、跨用户访问、额外字段拒绝和统一错误结构。
    - _Requirements: 1.1, 2.2–2.6, 8.2_

- [ ] 5. 实现 DSH 身份断言验证与防重放
  - [ ] 5.1 增加断言配置
    - 配置 issuer、audience、key ring、active/accepted `kid`、最大 TTL 和时钟偏差。
    - 生产环境缺少密钥或使用弱默认值时启动失败。
    - _Requirements: 1.3–1.6, 9.1–9.3_
  - [ ] 5.2 实现严格 JWT 验证器
    - 只接受 HS256 和已配置 `kid`。
    - 严格验证声明集合、签名、`iss`、`aud`、`iat`、`exp` 和最大 60 秒 TTL。
    - 禁止把断言原文写入异常、日志或审计。
    - _Requirements: 1.3–1.6, 7.3, 9.3_
  - [ ] 5.3 实现会话/轮次绑定与原子 nonce 消费
    - 验证 `sub` 等于会话拥有者和轮次请求者。
    - 在授权前消费 `jti`，并发冲突返回 `DQ_ASSERTION_REPLAYED`。
    - _Requirements: 1.4–1.6, 7.5, 10.4_
  - [ ] 5.4 增加安全测试
    - 覆盖篡改、未知 `kid`、错误 issuer/audience、未来签发、过期、超长 TTL、额外声明、会话错绑和并发重放。
    - _Requirements: 1.4–1.6, 10.4_

- [ ] 6. 实现 Query Broker 内部 API
  - [ ] 6.1 定义语义查询 Schema
    - 支持 dataset、metrics、dimensions、filters、timeRange、orderBy 和 limit。
    - 所有层级拒绝额外字段；禁止 SQL、物理标识符、身份和执行配置。
    - 对字段数、过滤数、`in` 值数和字符串长度设置配置上限。
    - _Requirements: 3.2–3.3, 5.1–5.7_
  - [ ] 6.2 实现 `/v1/internal/data-query/query`
    - 先验签、绑定和防重放，再解析权威用户角色并授权。
    - 内部端点绕过浏览器登录中间件时必须由专用断言依赖接管，不得匿名放行。
    - _Requirements: 1.3–1.6, 4.1–4.8_
  - [ ] 6.3 实现安全响应与稳定错误码
    - 成功只返回列、行、行数、完整性和截断标志。
    - 失败映射到设计文档错误码，不返回 SQL、作业 ID或内部栈。
    - _Requirements: 3.5–3.6, 8.1–8.6_
  - [ ] 6.4 增加 HTTP 组合测试
    - 使用真实 FastAPI 应用和 mocked MaxCompute Provider 验证调用顺序和响应投影。
    - 证明无效断言与策略拒绝不会调用执行器。
    - _Requirements: 6.9, 7.6, 10.3_

- [ ] 7. 实现安全语义编译器
  - [ ] 7.1 编译数据集、指标和维度
    - 物理映射只来自已发布治理快照。
    - 只允许单来源 SELECT、受限聚合和严格引用的标识符。
    - _Requirements: 6.1–6.4_
  - [ ] 7.2 编译过滤、时间范围和排序
    - 按维度数据类型校验值，使用参数绑定或安全编码。
    - 用户过滤与服务端行级过滤使用 `AND` 合并。
    - 排序字段必须属于已选择的指标或维度。
    - _Requirements: 4.8–4.9, 5.2–5.4, 6.4_
  - [ ] 7.3 增加编译器安全测试
    - 覆盖注入字符、注释、非法项目/表/字段、空指标、Join 尝试、越权过滤和行级范围不可移除。
    - 断言生成 SQL 不包含 DML/DDL 或多语句。
    - _Requirements: 5.6, 6.2–6.4_

- [ ] 8. 实现 MaxCompute 只读执行 Provider
  - [ ] 8.1 定义执行接口和显式配置解析
    - 输入为内部 `ReadOnlyQueryPlan`，不公开 SQL 接口给 DSH。
    - 配置 MaxCompute endpoint/project/quota/credential reference、30 秒超时、100 行和成本上限。
    - _Requirements: 6.5–6.6, 9.2_
  - [ ] 8.2 实现真实执行、取消和完整结果读取
    - 强制只读参数，超时取消作业。
    - 检查总行数、返回行数、列宽、响应字节和 complete/truncated。
    - 未配置时返回 `DQ_EXECUTOR_UNAVAILABLE`，不使用 Mock 回退。
    - _Requirements: 6.6–6.9_
  - [ ] 8.3 实现执行审计
    - 记录数据集编码、语义字段、作业关联 ID、耗时、行数和错误码。
    - 作业 ID 只在服务端日志/审计可见；不记录 SQL、凭据或完整结果。
    - _Requirements: 7.1–7.7_
  - [ ] 8.4 增加执行 Provider 测试
    - 覆盖成功、超时取消、数据源失败、超限、部分结果、空结果和多字节体积限制。
    - _Requirements: 6.7–6.9, 8.4_

- [ ] 9. 实现 DSH `dataQuery` Service Definition
  - [ ] 9.1 创建完整能力包
    - 定义 `DataQueryRequest`、`DataQueryResult`、`DataQueryProvider` 和运行时服务。
    - Provider 选择必须显式或在唯一可用时自动选择；缺失、不可用、歧义和重复注册均失败。
    - Registry contribution 返回 disposer，并验证 HMR 清理。
    - _Requirements: 3.1–3.6_
  - [ ] 9.2 增加 package invariant、README 和类型文档
    - README 说明配置、失败、限制、扩展点和 Model Experience。
    - invariant 说明并验证可观测的注册关系，或给出包特定的空理由。
    - _Requirements: 3.1–3.7, 9.5–9.6_
  - [ ] 9.3 增加 Runtime 单元测试
    - 覆盖 Provider 选择、重复注册、调用取消、结果边界和 disposal。
    - _Requirements: 3.5–3.6_

- [ ] 10. 实现 DSH dic-be HTTP Provider
  - [ ] 10.1 实现配置与身份断言签发
    - 配置 base URL、固定 path、issuer、audience、key ring、active `kid`、TTL、timeout 和结果限制。
    - 从可信 Principal 与轮次上下文构造 claims，每次使用新 `jti`。
    - _Requirements: 1.3–1.7, 3.3–3.4, 9.1–9.3_
  - [ ] 10.2 实现安全 HTTP 调用
    - 使用原生 `fetch` POST，固定 JSON Header，`redirect: 'error'`，传递 AbortSignal。
    - 不读取模型提供的 URL、Header、身份或资源上限。
    - _Requirements: 3.2–3.5, 8.3–8.4_
  - [ ] 10.3 验证完整响应
    - 拒绝非 2xx、非法 JSON、协议额外字段、partial/truncated、行列不一致、超过 100 行或响应体超限。
    - _Requirements: 3.5–3.6, 8.4_
  - [ ] 10.4 增加 HTTP 线缆测试
    - 使用本地测试服务器证明重定向目标未被访问。
    - 解码测试断言并核对 claims；覆盖 abort、错误状态和超限响应。
    - _Requirements: 3.4–3.6, 8.3–8.4_

- [ ] 11. 改造 DSH 模型工具与问数 Profile
  - [ ] 11.1 将 `data_query` 改为语义参数
    - 删除模型 SQL 参数和 MCP server/tool/project 配置。
    - 从可信轮次服务读取主体、会话和轮次，调用 `ctx.dataQuery`。
    - 更新模型可见描述、调用卡片和结果卡片。
    - _Requirements: 3.1–3.7, 5.1–5.7_
  - [ ] 11.2 建立问数专用 Profile
    - 只装配认证、轮次上下文、dataQuery Runtime、dic-be Provider、Tool Consumer 和 Agent 必需插件。
    - 禁用 Shell、FS、Web、Subagent、Workflow、Terminal、MCP 和直接数据查询工具。
    - _Requirements: 3.1, 9.5_
  - [ ] 11.3 增加真实 Loader 组合测试与快照
    - 从测试 `cordis.yml` 启动真实应用，断言模型工具精确等于 `['data_query']`。
    - 通过 fake dic-be 执行一次成功、一次策略拒绝并记录 keyless transcript snapshot。
    - 验证 fiber disposal 后工具与 Provider 注册消失。
    - _Requirements: 3.1–3.7, 10.6, 10.8_

- [ ] 12. 实现 dic-fe 智能问数页面
  - [ ] 12.1 新增 API Client
    - 封装创建会话、创建轮次和查询轮次三个接口。
    - 请求仅发送 question；复用现有 Axios 身份注入和 401 处理。
    - _Requirements: 1.1–1.2, 2.1–2.7_
  - [ ] 12.2 新增路由和页面
    - 创建独立 `service/data-query` 路由及菜单元数据。
    - 页面包含会话消息、问题输入、排队/运行状态、表格结果和最终回答。
    - _Requirements: 2.1–2.7_
  - [ ] 12.3 实现轮询与错误体验
    - 指数或固定受限轮询，在终态、离开页面和取消时停止。
    - 映射权限不足、能力不支持、超时和系统失败，不展示内部细节。
    - _Requirements: 2.5–2.7, 8.2, 8.5–8.6_
  - [ ] 12.4 增加前端测试与构建验证
    - 覆盖 API 请求体、轮询清理、所有终态和路由可达性。
    - _Requirements: 2.2–2.7, 10.8_

- [ ] 13. 完成审计与安全检查
  - [ ] 13.1 统一审计事件与脱敏
    - 覆盖完整生命周期事件，递归移除敏感键。
    - 问题审计仅存长度和不可逆摘要，原文仅在受控轮次表。
    - _Requirements: 7.1–7.7_
  - [ ] 13.2 验证无敏感信息泄漏
    - 检查浏览器响应、前端产物、DSH 会话日志、应用日志和审计表。
    - 添加自动测试扫描 AK/SK、JWT、Authorization、Cookie 和 SQL 字段。
    - _Requirements: 1.7, 7.3–7.4, 10.5_
  - [ ] 13.3 验证拒绝早于执行
    - 对未认证、重放、未授权、未发布和越权字段场景断言 MaxCompute Provider 调用次数为零。
    - _Requirements: 4.1–4.8, 7.6, 10.3_

- [ ] 14. 完成测试环境部署
  - [ ] 14.1 配置服务间信任
    - 创建和注入 assertion key ring、DSH/dic-be 工作负载网络策略和服务地址。
    - 验证密钥轮换、未知 `kid` 拒绝和旧密钥宽限期。
    - _Requirements: 9.1–9.4_
  - [ ] 14.2 创建数据库 Schema
    - 在明确的测试 TiDB 执行建表并核对表、索引和唯一约束。
    - 不运行开放权限的 Mock seed。
    - _Requirements: 4.10, 7.5_
  - [ ] 14.3 部署构建产物并执行健康检查
    - 构建并部署 dic-be、DSH Profile 和 dic-fe。
    - 验证内部端点不可由浏览器网络访问。
    - _Requirements: 9.4–9.6, 10.8_

- [ ] 15. 配置首批真实治理数据
  - 明确一个 MaxCompute 测试项目和单表/视图数据集。
  - 发布至少两个指标、两个维度、过滤/时间维度和行级范围映射。
  - 配置一个授权用户、一个未授权用户和必要的数据角色策略。
  - 记录人工基准 SQL 和固定业务日期的预期结果；基准 SQL 仅存在于验收材料，不进入模型或浏览器。
  - _Requirements: 4.1–4.10, 10.1–10.2_

- [ ] 16. 执行真实端到端验收
  - [ ] 16.1 验证授权成功路径
    - 从真实 dic-fe 登录并提问，确认生成真实 MaxCompute 作业。
    - 对比返回结果与人工基准，核对轮次、DSH transcript 和审计关联。
    - _Requirements: 10.2, 10.7_
  - [ ] 16.2 验证拒绝路径
    - 使用未授权用户、未发布指标、越权维度和重放断言。
    - 从审计和 MaxCompute 作业记录证明拒绝场景未提交作业。
    - _Requirements: 10.3–10.4_
  - [ ] 16.3 验证限制和故障路径
    - 验证 100 行、30 秒、取消、数据源故障、DSH 故障和结果完整性失败。
    - _Requirements: 6.6–6.9, 10.7_
  - [ ] 16.4 验证无泄漏与唯一工具
    - 检查浏览器开发者工具、服务日志、审计和 DSH 日志。
    - 记录实际工具清单为 `['data_query']`。
    - _Requirements: 10.5–10.6_

- [ ] 17. 完成发布判定与回滚准备
  - 汇总实际运行的测试、构建、部署和真实查询证据。
  - 若真实数据、主体或凭据未提供，明确标记“真实验收未完成”，不得宣布上线。
  - 准备撤销数据集/授权发布、禁用前端入口和轮换服务密钥的回滚步骤。
  - _Requirements: 9.3, 10.8–10.9_
