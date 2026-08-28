# 受控问数 MVP — 实施任务

> 本任务清单以 [需求文档](requirements.md) 和 [设计文档](design.md) 为准。现有工作树包含未提交的探索性实现；执行任务前必须逐文件核对，不得盲目保留、覆盖或删除。

- [x] 1. 整理当前分支与现有实现
  - 确认 `dic-be`、`dic-fe` 和 DSH 分别位于 `feat/controlled-data-query-mvp` 或约定的同名功能分支。
  - 记录三个仓库的 `git status`，逐文件对照 Spec 分类为保留、修改或移除。
  - 确认未提交内容不包含凭据、真实身份断言、原始生产 SQL 或误写的环境配置。
  - 运行现有定向测试建立基线；不得以删除失败测试恢复绿色。
  - _Requirements: 9.1, 9.6, 10.8_
  - ✅ 2026-08-24 经复审确认：分支与逐文件分类、基线测试、无测试删除、差异格式及敏感信息扫描证据均已核验，任务 1 通过。

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
- 结果（精确重放）：第一阶段无过滤产出 **4 条候选**——2 条为规范/命令文本自引用（命令文本本身含模式串），2 条为 `dic-be/app/data_query/application/audit.py` 的脱敏键名清单条目（非凭据）；人工核验 4 条均非凭据/真实 JWT/生产 SQL。完整过滤管道后无凭据候选。`.env.example` 为空值示例。

**⑥ 待办（评审遗留）**
- [x] 上述证据已于 2026-08-24 完成复审核验（README 陈旧引用已随本记录提交）。

- [x] 2. 完成 dic-be 语义治理领域模型
  - [x] 2.1 定义数据集、指标、维度和授权策略领域值对象
    - 定义发布状态、MaxCompute 数据源、物理映射、指标聚合、维度类型与允许过滤操作。
    - 定义用户/数据角色主体、allow/deny 和有效期。
    - 保持领域对象与 SQLAlchemy 实体解耦。
    - _Requirements: 4.1–4.10, 5.1–5.6_
  - [x] 2.2 实现默认拒绝授权函数
    - 按数据集、指标、维度、过滤维度和排序字段逐项授权。
    - 实现 deny 优先、未知主体不匹配、过期策略不生效。
    - 输出不可变 `AuthorizedSemanticQuery` 和稳定拒绝原因码。
    - _Requirements: 4.1–4.8, 8.1_
  - [x] 2.3 增加领域属性测试与示例测试
    - 覆盖空策略、混合 allow/deny、重复字段、极限 limit 和非 MaxCompute 数据集。
    - _Requirements: 4.1–4.8, 5.5_

  - ✅ 2026-08-24 完成交付：定义闭合治理值与不可变 `AuthorizedSemanticQuery`，实现默认拒绝、deny 优先、权威 staff 数据角色与行级范围、严格 filters/timeRange/orderBy 校验、非选择维度安全编译、稳定 `DQ_*` 响应及持久化映射 fail-closed；工作树与隔离 HEAD archive 均为 93 个聚焦测试通过，`compileall` 与 `git diff --check` 通过。实现提交：dic-be `aedc6a7`（分支 `feat/task2-semantic-governance`）。
  - ✅ 2026-08-25 独立终审通过：`.kiro/reviews/task2-2026-08-25-r2.md` 状态为 `approved`，P1/P2 均为 0；闭合治理值、ORM 映射失败关闭及 15 个内部原因的互斥穷尽外部分类经 **198 passed**、13 个非法治理值对抗和分类全集检查验证。

- [x] 3. 完成 dic-be 治理与会话持久化
  - [x] 3.1 定义并创建 `dq_*` ORM 表
    - 创建 `dq_dataset`、`dq_metric`、`dq_dimension`、`dq_access_policy`、`dq_conversation`、`dq_turn`、`dq_audit_log` 和 `dq_assertion_nonce`。
    - 为业务编码、会话/轮次 ID 和 `jti` 建立唯一约束；为审计查询建立索引。
    - _Requirements: 2.1–2.6, 4.1–4.10, 7.1–7.7_
  - [x] 3.2 接入统一数据库初始化
    - `create_schema` 只创建表，不写默认数据集或授权。
    - `seed_reference` 和 `seed_mock` 不得自动开放数据访问。
    - _Requirements: 4.10, 9.6_
  - [x] 3.3 实现仓储与事务
    - 会话和轮次按可信用户读取。
    - `jti` 使用唯一键和事务保存点原子消费，并清理过期 nonce。
    - 审计与状态更新在明确提交点发布。
    - _Requirements: 1.4–1.6, 2.3–2.6, 7.5_
  - [x] 3.4 增加真实数据库方言集成测试
    - 使用隔离 TiDB/MySQL 测试库验证唯一约束、并发重放和时间字段。
    - 不以 SQLite 行为代替 TiDB 唯一键与事务验证。
    - _Requirements: 7.5, 10.4_

  - ✅ 2026-08-24 完成交付：八张 `dq_*` 表、全局治理编码/业务 ID/nonce 命名唯一约束、完整审计索引、可信用户仓储、单向轮次状态与审计原子提交、nonce 保存点防重放、严格安全结果投影和纯 DDL 初始化均已实现。旧 nonce `jti VARCHAR(128)` 通过 MySQL 5.7/TiDB 兼容的阻断式幂等 DDL 收敛为 64。
  - ✅ 验证证据：完整 data-query + `test_ddl_compat.py` + 真实 `mysql:5.7.44` 隔离库为 **125 passed / 1 个既有 TestClient 弃用告警**；集成测试反射全部命名唯一约束、全部审计索引和 nonce/turn JTI 列宽，通过 `before_cursor_execute` 证明第二条 nonce INSERT 在首事务提交前已发出并阻塞，最终仅一次成功；`compileall`、`git diff --check`、临时凭据扫描均 PASS。独立终审结论：**PASS，P0/P1/P2 均无**。

- [x] 4. 实现浏览器会话 API
  - [x] 4.1 实现严格输入输出 Schema
    - 创建会话请求不接受身份字段。
    - 创建轮次只接受 1–2000 字符的 `question`，`extra=forbid`。
    - 轮次响应不包含 SQL、断言、作业 ID 或凭据。
    - _Requirements: 1.1, 2.1–2.6_
  - [x] 4.2 实现会话、轮次与状态路由
    - 实现 `POST /v1/data-query/conversations`。
    - 实现 `POST /v1/data-query/conversations/{conversationId}/turns`。
    - 实现 `GET /v1/data-query/turns/{turnId}`。
    - 所有资源读取执行拥有者匹配。
    - _Requirements: 2.1–2.7_
  - [x] 4.3 实现轮次后台派发抽象
    - 定义 `DshTurnClient`，传递可信主体和轮次上下文，不把主体放入浏览器可控请求体。
    - 使用有所有权的后台执行机制；进程重启后可恢复或明确失败。
    - _Requirements: 1.2, 2.4–2.6_
  - [x] 4.4 增加 FastAPI 真实路由测试
    - 覆盖鉴权中间件、跨用户访问、额外字段拒绝和统一错误结构。
    - _Requirements: 1.1, 2.2–2.6, 8.2_

  - ✅ 2026-08-24 完成交付：三条浏览器路由使用严格输入/输出模型和真实鉴权，owner 联查统一隐藏跨用户与不存在资源；`dq_turn` 持久化 outbox、条件 claim、可配置租约、固定 DSH HTTP Client 和 lifespan-owned worker 支持 pending 恢复及过期活动轮次明确失败，已有终态不被覆盖。生产启动拒绝非法 URL、空白服务身份和非有限/非法时间配置，环境模板已补齐。
  - ✅ 验证证据：Task 4 定向 **43 passed**；完整 data-query + DDL + 真实 `mysql:5.7.44` **149 passed**。真实 MySQL `SELECT ... FOR UPDATE` 证明 finish-vs-expire 第二事务阻塞且只产生一个终结结果/一条审计；`compileall`、`git diff --check`、凭据扫描 PASS。独立终审：**PASS，P0/P1/P2 均无**。

- [x] 5. 实现 DSH 身份断言验证与防重放
  - [x] 5.1 增加断言配置
    - 配置 issuer、audience、key ring、active/accepted `kid`、最大 TTL 和时钟偏差。
    - 生产环境缺少密钥或使用弱默认值时启动失败。
    - _Requirements: 1.3–1.6, 9.1–9.3_
  - [x] 5.2 实现严格 JWT 验证器
    - 只接受 HS256 和已配置 `kid`。
    - 严格验证声明集合、签名、`iss`、`aud`、`iat`、`exp` 和最大 60 秒 TTL。
    - 禁止把断言原文写入异常、日志或审计。
    - _Requirements: 1.3–1.6, 7.3, 9.3_
  - [x] 5.3 实现会话/轮次绑定与原子 nonce 消费
    - 验证 `sub` 等于会话拥有者和轮次请求者。
    - 在授权前消费 `jti`，并发冲突返回 `DQ_ASSERTION_REPLAYED`。
    - _Requirements: 1.4–1.6, 7.5, 10.4_
  - [x] 5.4 增加安全测试
    - 覆盖篡改、未知 `kid`、错误 issuer/audience、未来签发、过期、超长 TTL、额外声明、会话错绑和并发重放。
    - _Requirements: 1.4–1.6, 10.4_

  - ✅ 2026-08-24 完成交付：生产 key ring/active+accepted kid 与弱配置快速失败、canonical HS256 JWT 严格解析、精确八项 claims、禁止 `dataRoles`、稳定断言错误码、owner/requester/sub 绑定、保存点 nonce 消费和授权前独立提交均已实现；nonce 保留至 `exp+skew`，异常/审计不含 token。
  - ✅ 验证证据：Task 5 定向 **36 passed**；完整 data-query + DDL + 真实 `mysql:5.7.44` **175 passed**。真实 MySQL 完整验签+绑定并发得到一次 accepted、一次 replay、一行 nonce、两条脱敏审计；`compileall`、`git diff --check`、凭据扫描 PASS。独立终审：**PASS，P0/P1/P2 均无**。

- [x] 6. 实现 Query Broker 内部 API
  - [x] 6.1 定义语义查询 Schema
    - 支持 dataset、metrics、dimensions、filters、timeRange、orderBy 和 limit。
    - 所有层级拒绝额外字段；禁止 SQL、物理标识符、身份和执行配置。
    - 对字段数、过滤数、`in` 值数和字符串长度设置配置上限。
    - _Requirements: 3.2–3.3, 5.1–5.7_
  - [x] 6.2 实现 `/v1/internal/data-query/query`
    - 先验签、绑定和防重放，再解析权威用户角色并授权。
    - 内部端点绕过浏览器登录中间件时必须由专用断言依赖接管，不得匿名放行。
    - _Requirements: 1.3–1.6, 4.1–4.8_
  - [x] 6.3 实现安全响应与稳定错误码
    - 成功只返回列、行、行数、完整性和截断标志。
    - 失败映射到设计文档错误码，不返回 SQL、作业 ID或内部栈。
    - _Requirements: 3.5–3.6, 8.1–8.6_
  - [x] 6.4 增加 HTTP 组合测试
    - 使用真实 FastAPI 应用和 mocked MaxCompute Provider 验证调用顺序和响应投影。
    - 证明无效断言与策略拒绝不会调用执行器。
    - _Requirements: 6.9, 7.6, 10.3_
  - 验证证据（2026-08-24）：完整 data-query + DDL + 真实 `mysql:5.7.44` 回归 203 passed；真实 FastAPI/SQLite/HS256 assertion/nonce + mocked compiler/executor 覆盖成功、篡改、重放、policy deny，executor 仅成功请求调用一次；`compileall`、`git diff --check` 通过；独立终审 FINAL PASS，P0/P1/P2 均无。Task 7/8 前默认 compiler/executor 明确失败关闭。

- [x] 7. 实现安全语义编译器
  - [x] 7.1 编译数据集、指标和维度
    - 物理映射只来自已发布治理快照。
    - 只允许单来源 SELECT、受限聚合和严格引用的标识符。
    - _Requirements: 6.1–6.4_
  - [x] 7.2 编译过滤、时间范围和排序
    - 按维度数据类型校验值，使用参数绑定或安全编码。
    - 用户过滤与服务端行级过滤使用 `AND` 合并。
    - 排序字段必须属于已选择的指标或维度。
    - _Requirements: 4.8–4.9, 5.2–5.4, 6.4_
  - [x] 7.3 增加编译器安全测试
    - 覆盖注入字符、注释、非法项目/表/字段、空指标、Join 尝试、越权过滤和行级范围不可移除。
    - 断言生成 SQL 不包含 DML/DDL 或多语句。
    - _Requirements: 5.6, 6.2–6.4_
  - 验证证据（2026-08-24）：参数化计划使过滤值与 SQL 完全分离；compiler/policy/真实路由定向 145 passed；完整 data-query + DDL + 真实 `mysql:5.7.44` 264 passed；`compileall`、`git diff --check` 通过；独立终审 FINAL PASS，P0/P1/P2 均无。Task 8 executor 保持失败关闭。

- [x] 8. 实现 MaxCompute 只读执行 Provider
  - [x] 8.1 定义执行接口和显式配置解析
    - 输入为内部 `ReadOnlyQueryPlan`，不公开 SQL 接口给 DSH。
    - 配置 MaxCompute endpoint/project/quota/credential reference、30 秒超时、100 行和成本上限。
    - _Requirements: 6.5–6.6, 9.2_
  - [x] 8.2 实现真实执行、取消和完整结果读取
    - 强制只读参数，超时取消作业。
    - 检查总行数、返回行数、列宽、响应字节和 complete/truncated。
    - 未配置时返回 `DQ_EXECUTOR_UNAVAILABLE`，不使用 Mock 回退。
    - _Requirements: 6.6–6.9_
  - [x] 8.3 实现执行审计
    - 记录数据集编码、语义字段、作业关联 ID、耗时、行数和错误码。
    - 作业 ID 只在服务端日志/审计可见；不记录 SQL、凭据或完整结果。
    - _Requirements: 7.1–7.7_
  - [x] 8.4 增加执行 Provider 测试
    - 覆盖成功、超时取消、数据源失败、超限、部分结果、空结果和多字节体积限制。
    - _Requirements: 6.7–6.9, 8.4_
  - 验证证据（2026-08-24）：Task 7–8 executor/审计/HTTP/配置定向 223 passed；完整 data-query + DDL + 真实 `mysql:5.7.44` 334 passed；`compileall`、`git diff --check`、凭据扫描通过；独立终审 FINAL PASS，P0/P1/P2 均无。fake SDK 覆盖 late-submit/timeout/cancel stop、真实 Tunnel Normal、bounded reader、UTF-8 字节、恶意 jobId 和禁 mock 回退；未访问真实 MaxCompute，云端 DATE/DATETIME cast、quota 与 Tunnel 行为留待 Task 15–16 测试项目验收。

- [x] 9. 实现 DSH `dataQuery` Service Definition
  - [x] 9.1 创建完整能力包
    - 定义 `DataQueryRequest`、`DataQueryResult`、`DataQueryProvider` 和运行时服务。
    - Provider 选择必须显式或在唯一可用时自动选择；缺失、不可用、歧义和重复注册均失败。
    - Registry contribution 返回 disposer，并验证 HMR 清理。
    - _Requirements: 3.1–3.6_
  - [x] 9.2 增加 package invariant、README 和类型文档
    - README 说明配置、失败、限制、扩展点和 Model Experience。
    - invariant 说明并验证可观测的注册关系，或给出包特定的空理由。
    - _Requirements: 3.1–3.7, 9.5–9.6_
  - [x] 9.3 增加 Runtime 单元测试
    - 覆盖 Provider 选择、重复注册、调用取消、结果边界和 disposal。
    - _Requirements: 3.5–3.6_

  - ✅ 2026-08-25 完成交付并通过独立评审：`@deepseek-ai/dsh-data-query` 已完成纯语义 `DataQueryRequest`、独立可信 `DataQueryContext`（品牌化 conversation/turn id + 可信 GK 主体 id）、五字段 `DataQueryResult`、开放式 `DataQueryError`、显式或唯一可用 Provider 选择、重复注册拒绝、effect disposer/HMR 清理和取消信号透传。请求与结果类型均无 SQL、job id、断言或身份可控字段；Service Definition 不签发断言。`.kiro/reviews/task9-2026-08-25-r1.md` 状态为 `approved`，P1/P2/P3 均为 0。
  - 独立评审实测：定向 Vitest **9 passed**；定向 TypeScript、oxlint、tsdown 构建、plain Node ESM smoke、源码与构建产物 invariant、README Model Experience/limitations、双语 pairing、runtime closure、config catalog、package paths 和 `git diff --check` 均通过；`publint` 仅报告仓库既有 `./src/*` 未打包 warning。
  - 全局门禁边界：`verify-export-jsdoc`、workspace constraints 和 `verify-type-equiv` 仍分别被本任务范围外的 MCP Client、两个 client 空目录及 Typert 文档漂移阻断；输出均未命中 `packages/identity/data-query`，不得据此宣称全仓门禁全绿。

- [x] 10. 实现 DSH dic-be HTTP Provider
  - [x] 10.1 实现配置与身份断言签发
    - 配置 base URL、固定 path、issuer、audience、key ring、active `kid`、TTL、timeout 和结果限制。
    - 从可信 Principal 与轮次上下文构造 claims，每次使用新 `jti`。
    - _Requirements: 1.3–1.7, 3.3–3.4, 9.1–9.3_
  - [x] 10.2 实现安全 HTTP 调用
    - 使用原生 `fetch` POST，固定 JSON Header，`redirect: 'error'`，传递 AbortSignal。
    - 不读取模型提供的 URL、Header、身份或资源上限。
    - _Requirements: 3.2–3.5, 8.3–8.4_
  - [x] 10.3 验证完整响应
    - 拒绝非 2xx、非法 JSON、协议额外字段、partial/truncated、行列不一致、超过 100 行或响应体超限。
    - _Requirements: 3.5–3.6, 8.4_
  - [x] 10.4 增加 HTTP 线缆测试
    - 使用本地测试服务器证明重定向目标未被访问。
    - 解码测试断言并核对 claims；覆盖 abort、错误状态和超限响应。
    - _Requirements: 3.4–3.6, 8.3–8.4_

- [x] 11. 改造 DSH 模型工具与问数 Profile
  - [x] 11.1 将 `data_query` 改为语义参数
    - 删除模型 SQL 参数和 MCP server/tool/project 配置。
    - 从可信轮次服务读取主体、会话和轮次，调用 `ctx.dataQuery`。
    - 更新模型可见描述、调用卡片和结果卡片。
    - _Requirements: 3.1–3.7, 5.1–5.7_
  - [x] 11.2 建立问数专用 Profile
    - 只装配认证、轮次上下文、dataQuery Runtime、dic-be Provider、Tool Consumer、专用 HTTP carrier、strict service-authenticated turn ingress 和 Agent 必需插件。
    - ingress 在读取有上限的 body 前校验固定服务 identity 与 bearer token，只接受 `{principal, conversationId, turnId, question}`，使用随机内部 Session id 创建 Agent，并在同步消息插入外围调用 `withTurn()`。
    - 禁用 Shell、FS、Web 工具、浏览器／通用 API、Subagent、Workflow、Terminal、MCP 和直接数据查询工具；Principal 与业务 IDs 不进入模型或 Session event。
    - _Requirements: 3.1, 9.5_
  - [x] 11.3 增加真实 Loader 组合测试与快照
    - 从测试 `cordis.yml` 启动真实应用，断言模型工具精确等于 `['data_query']`。
    - 通过真实 Loader/WebServer HTTP 请求验证错误服务身份、错误 token 与额外字段拒绝，再验证有效 dispatch 的 trusted binding、模型输入脱敏及 ingress fiber disposal。
    - 通过 fake dic-be 执行一次成功、一次策略拒绝并记录 keyless transcript snapshot；固定完整 `data_query` 模型 schema expected 文件。
    - 验证 fiber disposal 后 ingress route、Agent、工具与 Provider 注册消失。
    - _Requirements: 3.1–3.7, 10.6, 10.8_

  - 实现证据（2026-08-24）：turn-principal、schema DSL/raw validator、递归 Provider、固定 schema snapshot 与真实 Loader/HTTP composition focused suite 5 files / 63 tests 通过；Data Aid keyless transcript snapshot 与 plain-Node built export smoke 通过；host face tsc、13 个本轮 TypeScript 文件 scoped lint、auth package 多 entry build、Cordis config、runtime closure、package invariant、config/tool catalog 和 Agent Note gates 通过。
  - 范围说明：真实 DIC-BE／MaxCompute 环境验收、TLS 终止、service-mesh／网络授权、rate limiting 与 secret rotation 仍由部署负责，不属于本任务完成证据。

- [x] 12. 实现 dic-fe 智能问数页面
  - [x] 12.1 新增 API Client
    - 封装创建会话、创建轮次和查询轮次三个接口。
    - 请求仅发送 question；复用现有 Axios 身份注入和 401 处理。
    - _Requirements: 1.1–1.2, 2.1–2.7_
  - [x] 12.2 新增路由和页面
    - 创建独立 `service/data-query` 路由及菜单元数据。
    - 页面包含会话消息、问题输入、排队/运行状态、表格结果和最终回答。
    - _Requirements: 2.1–2.7_
  - [x] 12.3 实现轮询与错误体验
    - 指数或固定受限轮询，在终态、离开页面和取消时停止。
    - 映射权限不足、能力不支持、超时和系统失败，不展示内部细节。
    - _Requirements: 2.5–2.7, 8.2, 8.5–8.6_
  - [x] 12.4 增加前端测试与构建验证
    - 覆盖 API 请求体、轮询清理、所有终态和路由可达性。
    - _Requirements: 2.2–2.7, 10.8_

  - ✅ 2026-08-25 完成交付并通过独立复审：`.kiro/reviews/task12-2026-08-25-r2.md` 状态为 `approved`，P1/P2 均为 0。共享 Axios 三接口、仅 question 请求体、`service/data-query` 页面与菜单、四终态及有界轮询、离开/取消清理、安全错误分类、结果表格和最终回答均已验证；`DQ_COMPILATION_FAILED` 固定映射为系统失败而非误导用户改写问法。
  - ✅ 验证证据：Task 12 定向 **7 files / 37 passed**；`vue-tsc --noEmit`、作用域 ESLint、production build（2632 modules）、问数可达 chunk 敏感信息扫描和 `git diff --check` 均通过。实际部署健康与真实环境联调保留给 Task 14–16。

- [x] 13. 完成审计与安全检查
  - [x] 13.1 统一审计事件与脱敏
    - 覆盖完整生命周期事件，递归移除敏感键。
    - 问题审计仅存长度和不可逆摘要，原文仅在受控轮次表。
    - _Requirements: 7.1–7.7_
  - [x] 13.2 验证无敏感信息泄漏
    - 检查浏览器响应、前端产物、DSH 会话日志、应用日志和审计表。
    - 添加自动测试扫描 AK/SK、JWT、Authorization、Cookie 和 SQL 字段。
    - _Requirements: 1.7, 7.3–7.4, 10.5_
  - [x] 13.3 验证拒绝早于执行
    - 对未认证、重放、未授权、未发布和越权字段场景断言 MaxCompute Provider 调用次数为零。
    - _Requirements: 4.1–4.8, 7.6, 10.3_

  - ✅ 2026-08-25 完成交付并通过第五轮独立复审：`.kiro/reviews/task13-2026-08-25-r5.md` 状态为 `approved`，P1/P2/P3 均为 0。DSH→dic-be 轮次从 queued 经 running 收敛到全部终态，callback 认证、三重绑定、严格 DTO、有界 body、幂等和终态不可回退均已验证；Query Broker、授权拒绝和轮次生命周期审计统一脱敏并可按 turnId、适用的安全 jobId 和稳定错误码关联。
  - ✅ 验证证据：dic-be Task 13 聚焦回归 **96 passed**（主会话核心集合 **91 passed**），其中 success、compilation failure、executor unavailable、timeout、source failure 和 result failure 均通过真实文件型 SQLite、未 mock 的 `repo.add_audit_log`、最终 `QueryAuditLog.detail_json` 与结构化应用日志跨面扫描；queued/running/succeeded/denied/failed/timed_out 浏览器投影、DSH 完整 Session/model/transcript、dic-fe 可达生产 chunk 均自动扫描 AK/SK、JWT、Authorization、Cookie 和 SQL。DSH **5 files / 34 passed**，dic-fe scanner/container **2 files / 7 passed**，相关 `tsc`、oxlint、`vue-tsc`、ESLint、production build（2632 modules）、`compileall`、Agent Note 格式/双语配对和三仓 `git diff --check` 均通过。真实 FastAPI/SQLite 的未认证、重放、未授权、未发布和越权字段拒绝均在本地 fake MaxCompute adapter 前保持零调用；该证据不冒充真实 MaxCompute 云端零作业，真实环境证明保留给 Task 15–16。

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

  - 工件准备与本地实测（2026-08-25，**不构成真实 Kubernetes Task 14 完成**）：已准备 public/broker 独立 workload、DSH 与前端生产构建、ExternalSecret remoteRef、纯 DDL Job、默认拒绝 NetworkPolicy、readiness/liveness、轮换与回滚 runbook、离线 manifest gate 和集群验证脚本；应用级测试证明 dic-be 两面交叉路径 404。`validate-manifests.mjs` 实测通过 **28 resources / 10 exact policies**，manifest Vitest **15 passed**（includes four HMR launch-path mutations and one missing-persona runtime-dependency mutation），与 acceptance 联合 **36 passed**，`kubectl kustomize` 成功渲染 test overlay **1024 行**；host TypeScript、scoped oxlint、`node --check`、Agent Note **608** 格式、部署双语 pairing 和 `git diff --check` 均通过。Docker Desktop Linux daemon 已在本机启动，三个本地非发布镜像均完成实际构建；DSH 最新镜像以最终 UID/GID `10001:10001`、无 `/workspace`、无受禁开发/测试目录、无 runtime symlink 的生产闭包通过完整构建和 final-user dump-config。真实长生命周期启动发现并修复专用 runtime manifest 遗漏 Cordis HMR/timer 与 shipped preset persona 直接依赖及 HMR 要求 Node `--expose-internals` 的问题；Dockerfile 默认 CMD、Kubernetes command/args、validator、回归和部署文档现保持一致。移除 Compose 的临时 DSH command 覆盖并强制重建后，实际容器参数来自镜像默认 CMD `node --expose-internals apps/cli/lib/bin.js --profile data-aid`，DSH 仍为 healthy。`.kiro/reviews/task14-dsh-local-deployment-2026-08-25-r2.md` 独立终审为 `APPROVED`，P1/P2/P3 均为 0。
  - 本地非 Kubernetes Docker Compose smoke（2026-08-25，**不构成目标 TiDB/MaxCompute/集群验收**）：使用一次性未输出且不提交的本地秘密启动 `mysql:5.7.44`、纯 DDL、broker、DSH、public 和 frontend；DDL `Exited (0)` 且仅建表，mysql/broker/DSH/public/frontend 均 healthy。仅 public `127.0.0.1:18000` 与 frontend `127.0.0.1:18080` 暴露；broker/DSH/mysql 的实际 HostPort binding 合计为 **0**，frontend 无法解析 broker。public live/ready、frontend `/healthz` 与 SPA 均为 200；public 的 broker/callback 路由、broker 的 browser route 均为 404，未认证 browser 与错误 DSH service identity 均为 401。数据库只读核对为 **8 张 `dq_*` 表**、四张治理表 **0 行**，保持默认拒绝; Real-provider validation then used a Git-external DeepSeek credential: official Provider e2e 1 passed / 6 skipped; after adding the shipped persona as a direct runtime dependency and rebuilding, DSH ingress returned 202/accepted=true and a browser turn reached queued -> running -> succeeded with answerLength=16. A correctly UTF-8 encoded business question reached assertion.accepted/query.authorized and failed closed as DQ_AGENT_FAILED against the empty governance catalog; response forbidden-key and sensitive-pattern counts were zero. MaxCompute 明确关闭且后端网络 internal，因此此 smoke 只证明健康、隔离和失败关闭，不证明任何真实查询成功。
  - ⛔ 真实部署硬阻塞（2026-08-25）：上述基础镜像经 DaoCloud 公共 Docker Hub proxy 获取，仅用于本地 build smoke，不构成受信发布供应链证据，也未推送任何镜像。当前仍无受信 registry/push 权限和三个 registry immutable digest；kubectl v1.36.1/kustomize v5.8.1 可见，但 `KUBECONFIG` 未设置、`~/.kube/config` 不存在、current context 和 context 列表均为空；ClusterSecretStore/真实 secret、测试 TiDB、MaxCompute endpoint/project/quota/credential reference 及 ingress/egress 平台值也未提供。因此未执行集群 apply、目标 TiDB DDL、密钥轮换、rollout 或集群健康检查，14、14.1、14.2、14.3 均保持未勾选。

- [ ] 15. 配置首批真实治理数据
  - 明确一个 MaxCompute 测试项目和单表/视图数据集。
  - 发布至少两个指标、两个维度、过滤/时间维度和行级范围映射。
  - 配置一个授权用户、一个未授权用户和必要的数据角色策略。
  - 记录人工基准 SQL 和固定业务日期的预期结果；基准 SQL 仅存在于验收材料，不进入模型或浏览器。
  - _Requirements: 4.1–4.10, 10.1–10.2_

  - 🧰 验收输入与受控发布准备（2026-08-25，**不构成 Task 15 完成**）：新增故意无效的 Git 外输入模板、fail-closed validator 和不注册 HTTP/seed 的管理员 publisher。validator 对单一 `project.table`、闭合治理值、权威 staff scope、精确 allow/deny policy、固定日期 benchmark/预期结果、100 行/30 秒及故障回滚执行 exact-key 和语义绑定，拒绝占位符、凭据、开放主体、变更 SQL、仓库内证据路径及数据库无法无损保存的亚秒 policy 时间戳；合成 acceptance **21 passed**，与 manifest 联合为 **36 passed**。publisher 默认只读 plan；apply 绑定 acceptance SHA、变更单、审批引用和独占 pending→commit→final snapshot，rollback 重验 acceptance、外部 desired/snapshot SHA、精确闭包及数据库 drift；`definition` 仅是 acceptance SHA 覆盖的人工评审材料，不写入当前 ORM。SQLite/文件安全回归 **14 passed**，覆盖同字节真实固定 validator、审批不匹配零副作用、幂等 reconcile、全局 code collision、commit/finalization failure、snapshot 重复 ID/业务键/错误类型/foreign policy、伪造 scope、错误外部 SHA、desired mismatch、微秒前态恢复和漂移拒绝；Ruff 与 compileall 通过。另在一次性本地 `mysql:5.7.44` 隔离容器中，完整 data-query 方言集合与新增 publisher 锁/apply/rollback 回归 **3 passed**：证明锁连接独立于写事务、并发 publisher 被拒、释放后可重取，以及四表真实 MySQL 往返；容器、锁和表均清理。`.kiro/reviews/task15-publisher-2026-08-25-r1.md` 与 `.kiro/reviews/task15-publisher-mysql-2026-08-25-r1.md` 独立终审均为 `approved`，P1/P2/P3 均为 0；这些批准仅覆盖 publisher 代码、本地 SQLite/文件和 MySQL 5.7 回归，不证明目标 TiDB、真实治理值或 MaxCompute。
  - ⛔ 真实治理数据硬阻塞（2026-08-26）：源码明确包含环境配置入口：DSH 有 tracked `apps/cli/config/data-aid-mse/.env.example`，dic-be 有 tracked `.env.example` 与 `.env.development.example` 并通过 Pydantic 加载运行目录 `.env`，dic-fe 有四个 tracked mode env 文件。此前称“工作区没有 `.env`”不准确；准确状态是 DSH/dic-be 文件中的受控问数真实 endpoint、project、AK/SK、TiDB 账号等值为空或占位，dic-fe env 只配置前端构建/API 路径。当前主机进程未设置 TiDB、MaxCompute 或 KUBECONFIG 关键变量；被 Git 忽略的本地 Compose `.env` 仅提供本地 MySQL、服务间信任和已验证的 DeepSeek 配置，运行中 broker 明确 `DATA_QUERY_MAXCOMPUTE_ENABLED=false` 且没有 MaxCompute endpoint/project/AK/SK/quota。Kubernetes 源码给出了 TiDB Service 地址、ExternalSecret remoteRef 和 MaxCompute render placeholder，但尚无 ClusterSecretStore 解析结果、目标项目值或集群证据。仓库仍只有测试 fixture，未发现可作为真实口径的项目、表/视图、固定业务日期、人工基准 SQL、预期结果或真实授权与未授权主体；真实发布必须由环境负责人通过受控数据库变更完成并保留前态/回滚，不得猜测物理字段、口径、主体或写入开放权限 mock seed，因此 Task 15 保持未勾选。

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

  - 🧰 验收矩阵准备（2026-08-25，**不构成 Task 16 完成**）：同一 out-of-tree 输入必须预先固定授权成功基准，以及未授权用户 `DQ_POLICY_DENIED`、未发布指标 `DQ_SEMANTIC_INVALID`、越权维度 `DQ_POLICY_DENIED`、断言重放 `DQ_ASSERTION_REPLAYED`；限制/故障控制固定为 100 行、`DQ_QUERY_TIMEOUT`、MaxCompute 作业取消、`DQ_SOURCE_FAILED`、`DQ_AGENT_FAILED`、`DQ_RESULT_INVALID`，每项均要求获批 procedure/rollback。校验器不会执行这些步骤，也不会访问浏览器、数据库、secret manager、集群或 MaxCompute。
  - ⛔ 真实端到端验收硬阻塞（2026-08-25）：Task 14 的测试集群部署和 Task 15 的真实治理数据/主体均未具备，也没有 MaxCompute 作业列表访问能力，故无法产生授权成功真实作业或证明拒绝路径云端零作业。Task 13 的本地 fake adapter 零调用、keyless snapshot 和 SQLite 审计证据，以及本次合成输入校验均不得替代本任务，16、16.1–16.4 均保持未勾选。

- 本地真实 MaxCompute 现状更新（2026-08-27，**不改变 Task 14–16 的未勾选状态**）：已从 Git 外配置安全加载真实 MaxCompute endpoint/project/AK/SK，仅向 broker workload 注入；public 的 MaxCompute 执行开关为 false 且无 AK/SK，broker 的 5 个必需字段完整，显式空 quota 使用项目默认资源组。broker 独占 `data-egress`，DSH 独占 `model-egress`，broker/DSH/MySQL HostPort 均为 0；五个 Compose 服务 healthy，页面、frontend health 和 public readiness 均为 HTTP 200。仅在本地 MySQL 发布 `giikin.dim_fin_currency_all` 对应的一个数据集、一个指标、一个分区维度及授权/未授权主体；授权链路经 public→DSH/DeepSeek→broker→真实只读 MaxCompute 达到 `queued→running→succeeded`，结果为 1 列 1 行且与独立 PyODPS 基准完全一致，响应敏感模式计数为 0，审计包含 authorized/compiled/started/completed/succeeded。未授权主体达到 `queued→running→denied`、`DQ_POLICY_DENIED`、无结果、敏感模式计数为 0；审计有 `query.authorized=denied`、无 `query.started`、`turn.completed=denied`。DSH callback 已修复为稳定 broker 拒绝优先于后续模型收尾错误，并经 6 个聚焦测试、包 typecheck、oxlint 和重建后的生产镜像实测。上述证据不包含真实 dic-fe 登录会话、目标 Kubernetes/TiDB、受信 registry/digest、集群密钥轮换、Task 15 要求的至少两个指标/两个维度，也未覆盖 Task 16.2–16.4 的全部拒绝、重放、限制、故障、浏览器开发者工具和唯一工具清单，因此不得作为 Task 14、15、16 或其子任务的完成证据。

- [ ] 17. 完成发布判定与回滚准备
  - 汇总实际运行的测试、构建、部署和真实查询证据。
  - 若真实数据、主体或凭据未提供，明确标记“真实验收未完成”，不得宣布上线。
  - 准备撤销数据集/授权发布、禁用前端入口和轮换服务密钥的回滚步骤。
  - _Requirements: 9.3, 10.8–10.9_
