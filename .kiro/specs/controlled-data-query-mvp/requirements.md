# 受控问数 MVP — 需求文档

## 1. 简介

本功能在数智中心提供自然语言问数入口。`dic-fe` 只与 `dic-be` 通信；`dic-be` 负责可信用户身份、数据权限、语义目录、数据源凭据、查询执行与审计；DeepSeek Harness（DSH）只负责 Agent 推理和工具编排。浏览器与模型均不得接触 MaxCompute/Hologres AK/SK、原始 MCP 工具或自由 SQL。

MVP 仅支持 MaxCompute、单数据集、只读语义查询，返回不超过 100 行，数据源执行不超过 30 秒。没有显式发布的数据集、字段和授权策略时一律拒绝。

## 2. 术语

- **可信主体**：由数智中心网关或服务端鉴权链路确认的最终用户，使用稳定的单点用户 ID 标识。
- **语义数据集**：经过治理并显式发布、可用于问数的数据集定义，映射到一个 MaxCompute 表或视图。
- **指标**：经过治理的聚合表达式，例如支付金额求和或订单数计数。
- **维度**：经过治理的分组或过滤字段，例如日期、家族或组织。
- **Query Broker**：`dic-be` 内负责授权、语义编译、数据源执行、结果限制和审计的组件。
- **身份断言**：DSH 为单次 `data_query` 调用签发的短期、受众绑定、不可重放的服务间令牌。
- **轮次**：用户在一个问数会话中提交的一次自然语言问题及其处理结果。

## 3. 需求

### 需求 1：可信身份与系统边界

**用户故事：** 作为数据安全负责人，我希望最终用户身份和数据权限只由可信后端确定，从而防止浏览器或模型伪造身份、角色和授权范围。

#### 验收标准

1. WHEN 浏览器调用问数接口 THEN `dic-be` SHALL 仅从现有受信网关头或登录 JWT 获取用户身份，不得从请求体、查询参数或模型参数读取用户 ID。
2. WHEN `dic-be` 调用 DSH THEN 调用链 SHALL 使用受信服务网络和服务身份，浏览器不得直接访问 DSH 问数入口。
3. WHEN DSH 调用 Query Broker THEN DSH SHALL 提供短期身份断言，断言至少包含 `iss`、`aud`、`sub`、`jti`、`iat`、`exp`、`conversationId` 和 `turnId`。
4. WHEN Query Broker 接收身份断言 THEN `dic-be` SHALL 验证签名、签发方、受众、有效期、会话绑定、轮次绑定和 `jti` 未被使用。
5. WHEN Query Broker 进行授权 THEN `dic-be` SHALL 根据断言中的 `sub` 查询权威用户与数据角色，不得信任 DSH、模型或浏览器提交的角色和数据范围。
6. IF 断言密钥未配置、断言无效或 `jti` 已使用 THEN Query Broker SHALL 在访问治理目录或数据源前拒绝请求。
7. DSH SHALL NOT 持有 MaxCompute/Hologres AK/SK；`dic-fe`、浏览器会话、模型上下文和工具参数 SHALL NOT 包含这些凭据。

### 需求 2：会话与轮次体验

**用户故事：** 作为数智中心用户，我希望创建问数会话、提交自然语言问题并查看处理状态和回答。

#### 验收标准

1. WHEN 用户创建会话 THEN `dic-be` SHALL 创建由当前可信用户拥有的会话并返回不透明的 `conversationId`。
2. WHEN 用户向自己的活动会话提交问题 THEN 请求体 SHALL 只允许非空 `question`，并 SHALL 拒绝额外的身份、数据集、SQL、授权或执行配置字段。
3. WHEN 用户访问不属于自己的会话或轮次 THEN `dic-be` SHALL 返回统一的“不存在或无权访问”错误，不得泄露资源是否存在。
4. WHEN 问题被接受 THEN `dic-be` SHALL 创建不透明的 `turnId`，把轮次置为 `queued`，并异步派发到 DSH。
5. WHEN DSH 开始、完成或失败 THEN `dic-be` SHALL 按 `queued → running → succeeded|failed|denied|timed_out` 更新轮次状态。
6. WHEN 用户查询轮次 THEN `dic-be` SHALL 返回状态、最终自然语言回答、受控结果摘要和稳定错误码，不得返回 SQL、身份断言或数据源凭据。
7. MVP SHALL 支持轮询获取结果；流式回答不属于 MVP。

### 需求 3：DSH Agent 与唯一模型工具

**用户故事：** 作为平台工程师，我希望 DSH 只向问数 Agent 暴露受控的 `data_query` 工具，从而避免模型绕过 Query Broker。

#### 验收标准

1. WHEN 问数 Agent 被装配 THEN 其模型可见工具集合 SHALL 精确包含 `data_query`，不得包含 MaxCompute/Hologres MCP、Shell、文件系统、通用 HTTP、代码执行或其它查询工具。
2. `data_query` 参数 SHALL 只包含语义数据集、指标、维度、过滤条件、时间范围、排序和行数限制，不得包含 SQL、物理表名、物理字段名、用户身份、权限范围、服务地址、超时或凭据。
3. WHEN `data_query` 执行 THEN 工具 SHALL 从 DSH 的可信轮次上下文获取主体、`conversationId` 和 `turnId`，不得从模型参数获取这些值。
4. WHEN DSH 构造身份断言 THEN 有效期 SHALL 不超过 60 秒，`aud` SHALL 固定为 Query Broker，且每次调用 SHALL 使用新的随机 `jti`。
5. WHEN Query Broker 返回结果 THEN DSH SHALL 只向模型暴露完整且受限的列、行和安全元数据；不得暴露 SQL、执行凭据、内部错误栈或未经限制的原始响应。
6. IF Query Broker 返回部分结果、截断标志、非法列行结构或超出结果体积限制 THEN `data_query` SHALL 失败，不得把不完整结果当作成功结果提供给模型。
7. DSH SHALL 将模型可见输入和工具结果写入其现有会话日志，以满足可重放要求，但 SHALL NOT 记录身份断言或密钥。

### 需求 4：语义治理与默认拒绝

**用户故事：** 作为数据管理员，我希望只有显式发布和授权的数据资产可以用于问数。

#### 验收标准

1. WHEN 数据集状态不是 `published` THEN Query Broker SHALL 拒绝查询。
2. WHEN 数据集数据源不是 `maxcompute` THEN MVP SHALL 拒绝查询。
3. WHEN 指标、维度、过滤维度或排序字段未发布或不属于所选数据集 THEN Query Broker SHALL 拒绝查询。
4. WHEN 主体缺少数据集以及每个请求指标、维度和过滤维度的显式 `allow` 策略 THEN Query Broker SHALL 拒绝查询。
5. WHEN 同一主体同时匹配 `allow` 和 `deny` THEN `deny` SHALL 优先。
6. 授权策略 SHALL 支持直接用户和服务端解析的数据角色两类主体；未知主体类型 SHALL 不匹配任何授权。
7. 过期、草稿、禁用或未来生效的授权策略 SHALL 不参与授权。
8. IF 数据集要求行级范围 THEN Query Broker SHALL 从 `dic-be` 的权威用户资料生成强制过滤条件；模型提交的过滤不得扩大该范围。
9. 数据集发布操作 SHALL 校验物理表、指标表达式、维度映射、行级范围映射、最大行数和超时配置完整，否则 SHALL 拒绝发布。
10. 系统 SHALL NOT 根据现有资产目录或指标知识库自动开放查询权限。

### 需求 5：语义查询能力

**用户故事：** 作为业务用户，我希望按已授权指标、维度和时间范围查询汇总数据，而不需要编写 SQL。

#### 验收标准

1. MVP SHALL 支持一个请求选择一个语义数据集、至少一个指标、零个或多个维度。
2. MVP SHALL 支持对已授权维度使用 `eq`、`in`、`between`、`gte` 和 `lte` 过滤操作；每种操作的值类型和数量 SHALL 被严格校验。
3. MVP SHALL 支持一个已治理日期或时间维度的起止范围，结束时间 SHALL 使用排他语义。
4. MVP SHALL 支持按已选择的指标或维度升序/降序排序；未选择字段不得用于排序。
5. 请求 `limit` SHALL 在 1 到数据集 `maxRows` 之间，且数据集 `maxRows` SHALL 不超过 100。
6. MVP SHALL NOT 支持自由 SQL、多数据集 Join、子查询、窗口函数、自定义表达式、明细导出、DML 或 DDL。
7. IF 自然语言问题无法映射为上述语义请求 THEN DSH SHALL 解释能力限制并请求用户澄清，不得猜测物理表或生成自由 SQL。

### 需求 6：只读编译与 MaxCompute 执行

**用户故事：** 作为平台运维人员，我希望所有数据访问都由 `dic-be` 使用受控凭据执行并受到资源限制。

#### 验收标准

1. WHEN 查询通过授权 THEN Query Broker SHALL 仅从已发布治理记录解析物理项目、表、字段和聚合表达式。
2. 编译器 SHALL 只生成一个 MaxCompute 表或视图上的 `SELECT` 聚合查询，不得拼接模型或浏览器提供的 SQL 片段。
3. 编译器 SHALL 对所有物理标识符执行严格白名单校验和引用，拒绝包含空白、分隔符、注释或表达式的非法映射。
4. 编译器 SHALL 把服务端行级过滤与用户语义过滤使用 `AND` 合并，且用户过滤不得替换服务端过滤。
5. 执行器 SHALL 使用仅存在于 `dic-be` 运行环境的 MaxCompute 凭据。
6. 执行器 SHALL 强制只读模式、最大 100 行、最大 30 秒，并在可用时设置 MaxCompute 资源或成本上限。
7. WHEN 查询超时 THEN `dic-be` SHALL 尝试取消数据源作业并返回稳定超时错误。
8. WHEN 数据源返回超过限制、部分结果或无法确认完整性 THEN Query Broker SHALL 把调用标记为失败，不得静默截断后宣称成功。
9. IF 真实执行器或凭据未配置 THEN Query Broker SHALL 返回稳定的“执行器不可用”错误，不得返回模拟数据或伪造成功。
10. MVP SHALL 不执行 Hologres 查询；后续接入必须作为独立数据源 Provider 设计和验收。

### 需求 7：审计、隐私与可观测性

**用户故事：** 作为审计人员，我希望还原每次问数的主体、授权决策和执行结果，同时避免审计系统成为敏感信息泄漏源。

#### 验收标准

1. 系统 SHALL 审计会话创建、轮次创建、DSH 派发、断言接受或拒绝、授权允许或拒绝、编译、执行、超时、失败和轮次完成事件。
2. 每条审计记录 SHALL 包含事件类型、结果、可信用户 ID、会话 ID、轮次 ID、数据集编码、指标/维度编码、行数、耗时和稳定错误码中适用的字段。
3. 审计记录 SHALL NOT 包含 AK/SK、身份断言、Cookie、Authorization、原始 SQL、完整查询结果或内部错误栈。
4. 对问题文本的审计 SHALL 只记录长度和不可逆摘要；业务需要保存的原始问题 SHALL 仅存在于受访问控制的轮次记录中。
5. `jti` 消费记录 SHALL 具有唯一约束，并至少保留到断言过期；并发重复请求只能有一个成功消费。
6. 授权拒绝 SHALL 在提交 MaxCompute 作业前完成，并可通过审计证明没有数据源执行事件。
7. 系统 SHALL 提供按 `turnId` 和时间范围关联应用日志、审计记录及 MaxCompute 作业 ID 的能力；作业 ID 不得暴露给浏览器或模型。

### 需求 8：错误处理与结果安全

**用户故事：** 作为前端和 Agent 开发者，我希望收到稳定、可分类且不泄密的错误。

#### 验收标准

1. 系统 SHALL 为未认证、断言无效、断言重放、会话不匹配、策略拒绝、语义无效、编译失败、执行器不可用、执行超时、数据源失败和结果超限定义稳定错误码。
2. 浏览器响应 SHALL 使用现有统一响应结构，并只提供用户可理解的信息；内部诊断 SHALL 留在服务端日志。
3. DSH Provider SHALL 拒绝 HTTP 重定向，避免身份断言或请求数据被自动转发到另一来源。
4. DSH Provider SHALL 拒绝非 2xx、非 JSON、字段缺失、额外协议字段、部分结果、超限结果和响应体超限。
5. WHEN 用户无权限 THEN 前端 SHALL 显示权限不足和申请授权提示，不得展示内部策略详情或资源是否存在。
6. WHEN 问题超出 MVP 能力 THEN 回答 SHALL 清楚说明不支持的能力，并建议可执行的单数据集汇总问法。

### 需求 9：配置与部署安全

**用户故事：** 作为部署负责人，我希望安全相关配置显式、可轮换且缺失时快速失败。

#### 验收标准

1. DSH 与 `dic-be` SHALL 从秘密管理或环境变量读取服务间断言密钥，不得提交到代码、配置样例、日志或前端产物。
2. 生产环境 SHALL 在启动时校验断言签发方、受众、密钥、有效期、Query Broker URL、MaxCompute 凭据和超时上限；缺失或弱默认值 SHALL 导致启动失败。
3. 身份断言 SHALL 支持 `kid` 和至少当前/上一把密钥的平滑轮换；未知 `kid` SHALL 被拒绝。
4. Query Broker 内部端点 SHALL 只允许 DSH 工作负载网络访问，并同时执行应用层断言验证。
5. DSH 专用问数 Profile SHALL 不挂载原始 MCP Client、MaxCompute/Hologres MCP Server 或直接查询工具。
6. 发布产物 SHALL 使用构建后的代码和锁定依赖，不得依赖开发源码解释器或本地未声明包。

### 需求 10：真实验证与上线验收

**用户故事：** 作为项目负责人，我希望通过真实 MaxCompute 数据和真实用户权限验证系统，而不是只依赖 Mock 或静态检查。

#### 验收标准

1. 上线前 SHALL 明确至少一个测试环境语义数据集、两个指标、两个维度、一个授权用户、一个未授权用户和预期结果基准。
2. 授权用户的真实问数 SHALL 产生真实 MaxCompute 作业，结果 SHALL 与相同口径的人工基准查询一致。
3. 未授权用户、未发布指标和越权维度的请求 SHALL 被拒绝，且 SHALL 证明没有提交 MaxCompute 作业。
4. 重放同一身份断言 SHALL 只有第一次请求可进入授权流程，后续请求 SHALL 返回重放错误。
5. 浏览器网络面板、DSH 会话日志、应用日志和审计表 SHALL 不出现 AK/SK、原始身份断言或原始 SQL。
6. DSH 实际装配后的模型工具清单 SHALL 精确等于 `data_query`。
7. 真实查询 SHALL 验证 100 行上限、30 秒超时、取消路径、完整结果校验和非授权错误展示。
8. `dic-be`、DSH 和 `dic-fe` SHALL 分别通过定向单元测试、真实组合测试、构建检查和部署后健康检查。
9. IF 缺少真实数据集、授权主体或测试环境凭据 THEN 项目状态 SHALL 明确标记为“代码完成但真实验收未完成”，不得宣称功能上线可用。

## 4. MVP 范围外

以下能力不在本 Spec 的 MVP 范围：Hologres 查询、跨数据集 Join、自由 SQL、明细级批量导出、用户自定义指标、写操作、流式回答、长期记忆、自动开放资产、面向公网的 DSH 入口，以及由模型决定用户身份或数据权限。
