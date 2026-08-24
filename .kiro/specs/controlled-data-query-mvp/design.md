# 受控问数 MVP — 设计文档

## 1. 概述

受控问数采用 `dic-fe → dic-be → DSH → dic-be Query Broker → MaxCompute` 的闭环。`dic-be` 是用户身份、数据权限、语义治理、数据源凭据、查询执行和审计的唯一权威；DSH 是 Agent 推理与模型工具宿主；`dic-fe` 只提供会话界面。

设计的核心不是阻止模型“写坏 SQL”，而是让模型根本没有提交 SQL、物理表、身份和权限的接口。模型只能产生语义查询意图；`dic-be` 在每次查询时重新授权并从治理记录编译只读 SQL。

## 2. 目标与非目标

### 2.1 目标

- 在数智中心提供可轮询的自然语言问数会话。
- 保证浏览器和模型无法伪造身份或扩大数据权限。
- 保证 DSH 不接触数据源 AK/SK，也不加载原始数据源 MCP。
- 支持 MaxCompute 单数据集聚合查询，限制为 100 行和 30 秒。
- 对身份、授权、编译、执行和结果形成可关联审计。
- 提供可使用真实 MaxCompute 数据验收的部署路径。

### 2.2 非目标

- 不支持 Hologres、Join、自由 SQL、DML、DDL 或明细导出。
- 不让 DSH 成为权限源、语义目录源或数据源凭据持有者。
- 不复用现有 `/v1/data-api/query` 作为 Query Broker。
- 不以 Mock 结果替代真实数据验收。

## 3. 总体架构

```text
┌──────────────┐       trusted login        ┌──────────────────────────────┐
│    dic-fe    │ ─────────────────────────▶ │            dic-be            │
│ conversation │   REST: conversation/turn  │ identity / turn / governance │
└──────────────┘ ◀───────────────────────── │ policy / audit / credentials │
                         polling             └──────────────┬───────────────┘
                                                           │ trusted service call
                                                           │ principal + turn context
                                                           ▼
                                            ┌──────────────────────────────┐
                                            │             DSH              │
                                            │ Agent + only `data_query`    │
                                            │ no MaxCompute/Holo AK/SK     │
                                            └──────────────┬───────────────┘
                                                           │ semantic query
                                                           │ short-lived assertion
                                                           ▼
                                            ┌──────────────────────────────┐
                                            │ dic-be Query Broker          │
                                            │ verify → authorize → compile │
                                            │ execute → bound → audit      │
                                            └──────────────┬───────────────┘
                                                           │ read-only SQL
                                                           ▼
                                            ┌──────────────────────────────┐
                                            │ MaxCompute                   │
                                            └──────────────────────────────┘
```

### 3.1 信任边界

| 边界 | 可信输入 | 不可信输入 | 强制措施 |
|---|---|---|---|
| 浏览器 → dic-be | 网关认证上下文、服务端登录 JWT | 请求体、查询参数、浏览器 Header | 输入白名单、资源归属检查 |
| dic-be → DSH | 服务网络、工作负载身份、服务端注入的最终用户主体 | 浏览器直连、请求体自报主体 | 网络策略、DSH Authenticated Principal Provider |
| 模型 → `data_query` | 无 | 所有工具参数 | 仅语义 Schema、服务端轮次上下文 |
| DSH → Query Broker | 短期签名断言 | HTTP Body 与外部 Header | 验签、受众、时效、绑定、JTI 防重放 |
| Query Broker → MaxCompute | dic-be 运行环境凭据、治理映射 | 模型生成内容 | 默认拒绝授权、编译器白名单、只读执行 |

## 4. 组件设计

### 4.1 dic-fe

新增独立的智能问数路由、页面和 API Client。页面负责：创建会话、提交问题、展示轮次状态、轮询结果、展示权限或能力限制错误。页面不得保存或传递用户 ID、数据集权限、SQL、DSH 地址或数据源凭据。

### 4.2 dic-be 会话应用服务

职责：

- 从现有鉴权上下文获取用户 ID。
- 创建并校验会话归属。
- 创建轮次并持久化原始问题。
- 把可信主体和轮次上下文派发给 DSH。
- 接收 DSH 最终回答，更新轮次状态。
- 对外投影安全响应，不暴露内部查询计划。

DSH 派发通过 `DshTurnClient` 抽象实现。MVP 可使用非流式 HTTP/RPC；派发在后台任务中运行，浏览器通过轮询读取结果。生产部署必须把后台任务替换为具备重试与所有权的任务队列或现有工作流机制，避免 Web Worker 重启丢失轮次。

### 4.3 DSH Authenticated Principal 与轮次上下文

DSH 入站由部署持有的 Authenticated Principal Provider 验证来自 `dic-be` 的服务调用，并创建不可变主体。主体只在请求与 Agent 轮次内存中存在，不写入模型参数。

新增轮次上下文服务保存 `{conversationId, turnId, principal}` 到当前 Agent 轮次。`data_query` 执行时从该服务读取上下文；轮次停止、丢弃、冲突或 Agent 销毁时立即清除。一个轮次若绑定不同主体或不同 `turnId`，执行必须失败关闭。

### 4.4 DSH `dataQuery` 能力

能力分为三个角色：

1. **Service Definition**：定义 `DataQueryRequest`、`DataQueryResult`、Provider 注册和显式选择规则。
2. **dic-be HTTP Provider**：签发短期身份断言、发送语义请求、拒绝重定向并验证响应。
3. **Tool Consumer**：定义模型可见的 `data_query` Schema、展示意图和结果边界。

问数专用 Profile 只挂载这三个角色、认证与 Agent 必需插件。Profile 必须禁用其它模型工具，并通过真实 Loader 组合测试证明最终工具清单精确等于 `['data_query']`。

### 4.5 dic-be Query Broker

Query Broker 的处理顺序固定如下：

1. 验证身份断言。
2. 校验断言中的会话、轮次和主体与数据库记录一致。
3. 原子消费 `jti`。
4. 从权威用户资料解析数据角色与行级范围。
5. 加载已发布数据集、指标、维度和授权策略。
6. 执行默认拒绝授权。
7. 把语义查询编译为只读 MaxCompute SQL。
8. 应用服务端强制过滤、行数、时间和资源上限。
9. 使用 dic-be 凭据执行。
10. 验证完整结果、写审计并返回安全结果。

任何步骤失败都不得继续到后续步骤。

### 4.6 MaxCompute 执行 Provider

执行 Provider 接收内部 `ReadOnlyQueryPlan`，不接受浏览器、模型或 DSH 的 SQL。Provider 使用 `dic-be` 配置中的 MaxCompute 凭据，并强制：

- 只读查询；
- 30 秒端到端超时；
- 100 行最大结果；
- 可用时设置 CU/Quota 上限；
- 超时取消作业；
- 返回完整性、行列和字节数元数据。

未配置凭据或 Provider 时返回 `DQ_EXECUTOR_UNAVAILABLE`，不得回退 Mock。

## 5. 数据模型

| 表 | 关键字段 | 用途 |
|---|---|---|
| `dq_dataset` | `code`, `source_type`, `source_ref`, `status`, `max_rows`, `timeout_seconds`, `scope_mapping_json` | 发布的数据集与执行限制 |
| `dq_metric` | `dataset_code`, `code`, `source_field`, `aggregation`, `status` | 指标治理映射 |
| `dq_dimension` | `dataset_code`, `code`, `source_field`, `data_type`, `operators_json`, `status` | 维度、过滤和类型治理 |
| `dq_access_policy` | `subject_type`, `subject_value`, `resource_type`, `resource_code`, `effect`, `valid_from`, `expires_at`, `status` | 显式 allow/deny |
| `dq_conversation` | `conversation_id`, `owner_user_id`, `status`, timestamps | 会话归属 |
| `dq_turn` | `turn_id`, `conversation_id`, `requester_user_id`, `question`, `status`, `answer_json`, `error_code`, timestamps | 轮次状态与安全结果 |
| `dq_audit_log` | `event_type`, `outcome`, `actor_user_id`, `conversation_id`, `turn_id`, `detail_json`, timestamp | 最小化审计 |
| `dq_assertion_nonce` | `jti`, `subject`, `conversation_id`, `turn_id`, `expires_at` | 并发安全的防重放 |

所有外部 ID 使用 UUID/ULID 等不透明值。`dq_assertion_nonce.jti` 必须唯一。治理表不得自动从资产表产生 `published` 或 `allow` 记录。

## 6. 接口设计

### 6.1 浏览器接口

#### 创建会话

```http
POST /v1/data-query/conversations
```

请求体为空。用户身份来自鉴权上下文。

```json
{
  "code": 200,
  "bizCode": 0,
  "msg": "success",
  "data": {
    "conversationId": "01J...",
    "status": "active"
  }
}
```

#### 创建轮次

```http
POST /v1/data-query/conversations/{conversationId}/turns
Content-Type: application/json

{
  "question": "最近 7 天各家族支付金额是多少？"
}
```

请求模型使用 `extra=forbid`。任何 `userId`、`datasetCode`、`sql`、`authorization` 或执行参数均导致参数错误。

```json
{
  "code": 200,
  "bizCode": 0,
  "msg": "success",
  "data": {
    "turnId": "01J...",
    "conversationId": "01J...",
    "status": "queued"
  }
}
```

#### 查询轮次

```http
GET /v1/data-query/turns/{turnId}
```

成功结果示例：

```json
{
  "code": 200,
  "bizCode": 0,
  "msg": "success",
  "data": {
    "turnId": "01J...",
    "status": "succeeded",
    "answer": "最近 7 天……",
    "result": {
      "columns": ["family_name", "pay_amount"],
      "rows": [["A", 1200.5]],
      "rowCount": 1
    },
    "errorCode": ""
  }
}
```

### 6.2 模型工具接口

工具名固定为 `data_query`。

```json
{
  "datasetCode": "order_summary",
  "metricCodes": ["pay_amount"],
  "dimensionCodes": ["family_name"],
  "filters": [
    {
      "dimensionCode": "country_code",
      "operator": "in",
      "value": ["US", "CA"]
    }
  ],
  "timeRange": {
    "dimensionCode": "pay_date",
    "startInclusive": "2026-08-14",
    "endExclusive": "2026-08-21"
  },
  "orderBy": [
    {
      "fieldCode": "pay_amount",
      "direction": "desc"
    }
  ],
  "limit": 100
}
```

Tool Schema 对每个对象使用 `additionalProperties: false`。`metricCodes` 至少一个且去重；字段数量、过滤数量、`in` 值数量和字符串长度必须有配置上限。

### 6.3 DSH → Query Broker 内部接口

```http
POST /v1/internal/data-query/query
X-DSH-Principal-Assertion: <compact JWT>
Content-Type: application/json
```

Body 与模型语义请求相同，但不含身份、会话、轮次、SQL、超时或物理映射。会话和轮次只来自已签名断言。

成功响应：

```json
{
  "columns": ["family_name", "pay_amount"],
  "rows": [["A", 1200.5]],
  "rowCount": 1,
  "complete": true,
  "truncated": false
}
```

响应不包含 SQL、作业 ID、物理表名、凭据或内部审计详情。

## 7. 身份断言协议

MVP 使用 HS256 服务间断言，并通过部署秘密管理保存密钥。该密钥只用于 DSH → dic-be 调用，不是数据源凭据。生产配置使用 `kid` 支持当前和上一把密钥平滑轮换。

Header：

```json
{
  "alg": "HS256",
  "typ": "JWT",
  "kid": "2026-08-a"
}
```

Payload：

```json
{
  "iss": "dsh-data-query",
  "aud": "dic-be:data-query",
  "sub": "trusted-sso-user-id",
  "jti": "random-128-bit-or-more",
  "iat": 1787299200,
  "exp": 1787299260,
  "conversationId": "01J...",
  "turnId": "01J..."
}
```

验证规则：

- 只接受配置允许的 `alg` 和 `kid`。
- Payload 只允许上述声明，避免歧义字段。
- `iss`、`aud` 精确匹配。
- `exp > now`，`iat` 不得晚于允许时钟偏差，`exp - iat <= 60s`。
- `sub`、`jti`、`conversationId`、`turnId` 非空且长度受限。
- 会话拥有者、轮次请求者和 `sub` 必须相同，轮次必须属于会话。
- 在授权前插入唯一 `jti`；唯一键冲突返回重放错误。
- 断言原文不得写日志或审计。

数据角色不放入断言。`dic-be` 使用 `sub` 查询权威员工、角色和数据范围，避免 DSH 成为授权来源。

## 8. 授权算法

授权输入包括权威主体、语义请求和当前有效治理记录。算法按以下顺序运行：

1. 查找编码匹配且状态为 `published` 的数据集。
2. 验证数据源为 `maxcompute`，`maxRows <= 100`，`timeoutSeconds <= 30`。
3. 验证主体对数据集存在匹配 `allow` 且不存在匹配 `deny`。
4. 验证每个指标、维度、过滤维度和排序字段已发布并属于数据集。
5. 对每个资源分别执行 `deny` 优先、显式 `allow` 必须存在的规则。
6. 解析数据集要求的行级范围，并从权威主体生成强制过滤。
7. 验证 `limit`、过滤操作和值类型。
8. 输出不可变 `AuthorizedSemanticQuery`；失败只输出稳定原因码。

授权检查使用语义编码，不使用物理表或字段名。物理映射只在授权完成后由编译器读取。

## 9. 编译器设计

编译器接收 `AuthorizedSemanticQuery` 和发布快照，输出内部 `ReadOnlyQueryPlan`。

- 数据源引用只允许 `project.table` 或按 MaxCompute Schema 模式明确配置的标识符路径。
- 指标聚合只允许治理枚举，例如 `sum`、`count`、`avg`、`min`、`max`。
- 维度与过滤字段只来自发布映射。
- 用户值通过参数绑定或安全字面量编码，不与 SQL 字符串直接拼接。
- 服务端行级过滤始终存在于最终 `WHERE`，并与用户过滤使用 `AND` 合并。
- 只生成 `SELECT ... FROM single_source [WHERE] [GROUP BY] [ORDER BY] LIMIT n`。
- 编译完成后可执行 AST/关键字防御检查，但其作用是纵深防御，不能替代语义构造。
- SQL 只存在于 dic-be 内存与数据源调用，不返回、不写审计。

## 10. 状态机与失败语义

### 10.1 轮次状态

```text
queued → running → succeeded
                 ↘ denied
                 ↘ failed
                 ↘ timed_out
```

终态不可回退。重试创建新的执行尝试和新的 `jti`，但仍关联原 `turnId`；同一轮次同时只允许一个活动执行租约。

### 10.2 稳定错误码

| 错误码 | 含义 | 是否可重试 |
|---|---|---|
| `DQ_UNAUTHENTICATED` | 浏览器用户未认证 | 否，重新登录 |
| `DQ_ASSERTION_INVALID` | 断言签名、受众或声明无效 | 否 |
| `DQ_ASSERTION_EXPIRED` | 断言过期 | 是，由 DSH 新签发 |
| `DQ_ASSERTION_REPLAYED` | `jti` 已消费 | 否 |
| `DQ_TURN_BINDING_MISMATCH` | 主体、会话或轮次不一致 | 否 |
| `DQ_POLICY_DENIED` | 默认拒绝策略未通过 | 否，申请授权 |
| `DQ_SEMANTIC_INVALID` | 语义字段、过滤或排序无效 | 否，修改问法 |
| `DQ_COMPILATION_FAILED` | 治理映射无法安全编译 | 否，修复治理记录 |
| `DQ_EXECUTOR_UNAVAILABLE` | 真实执行器或凭据未配置 | 是，修复部署 |
| `DQ_QUERY_TIMEOUT` | 超过 30 秒 | 可调整问法后重试 |
| `DQ_SOURCE_FAILED` | MaxCompute 执行失败 | 视故障而定 |
| `DQ_RESULT_INVALID` | 部分、截断或超限结果 | 否，平台排查 |
| `DQ_AGENT_FAILED` | DSH 推理失败 | 是 |

外部信息不包含内部异常栈。服务端日志通过 `turnId` 关联详细诊断。

## 11. 审计设计

推荐事件：`conversation.created`、`turn.created`、`turn.dispatched`、`assertion.accepted`、`assertion.rejected`、`query.authorized`、`query.compiled`、`query.started`、`query.completed`、`query.failed`、`turn.completed`。

`detail_json` 仅存语义编码、原因码、行数、耗时和结果字节数。写入前递归移除键名包含 `sql`、`authorization`、`token`、`cookie`、`secret`、`password`、`accessKey`、`ak` 或 `sk` 的字段。审计脱敏不能代替调用方避免生成敏感字段。

## 12. 配置

### 12.1 dic-be

- DSH assertion issuer、audience、key ring、最大 TTL、时钟偏差。
- DSH 内部端点网络访问策略。
- MaxCompute endpoint、project、AK/SK、quota。
- Query Broker 最大行数 100、超时 30 秒、结果字节上限。
- DSH turn client endpoint、服务身份和派发超时。

### 12.2 DSH

- Query Broker base URL 和固定 path。
- assertion issuer、audience、active `kid`、key ring、TTL。
- Provider timeout、max rows、max result bytes。
- 专用问数 Profile 与唯一工具装配。

### 12.3 dic-fe

- 仅配置 `dic-be` 现有 API base；不得配置 DSH 或数据源地址。

所有部署可变上限必须是经过验证的配置字段，不得散落硬编码。

## 13. 测试策略

### 13.1 dic-be

- 纯领域测试：发布状态、deny 优先、逐资源 allow、行数和数据源限制。
- Schema 测试：浏览器与 DSH 输入拒绝额外字段、SQL和身份。
- 断言测试：篡改、错误 `kid`/`iss`/`aud`、未来 `iat`、过期、超长 TTL、重放和并发重放。
- 仓储测试：唯一 nonce、会话归属、策略有效期。
- 编译器测试：标识符、聚合、过滤值、强制范围、无 Join、无写操作。
- 执行器测试：超时、取消、超限、部分结果和未配置失败。
- HTTP 组合测试：真实 FastAPI 路由、鉴权中间件、统一响应和安全投影。

### 13.2 DSH

- Service Definition：Provider 选择、重复注册、缺失、不可用和 disposal。
- HTTP Provider：固定 URL、拒绝重定向、AbortSignal、JWT 声明、非 2xx、非法 JSON、超限响应。
- Tool Consumer：Schema 不含 SQL/身份、轮次上下文绑定、冲突主体拒绝、完整结果限制。
- 真实 Cordis Loader 组合：问数 Profile 最终模型工具清单精确为 `data_query`。
- Keyless snapshot：真实 runnable example 展示一次工具调用、成功结果和拒绝结果。

### 13.3 dic-fe

- API Client 请求结构、轮询停止、错误映射和会话归属。
- 页面组件状态：空白、排队、运行、成功、拒绝、失败和超时。
- 构建与路由 smoke test。

### 13.4 真实验收

使用测试环境真实 MaxCompute 数据集和真实授权主体执行。授权查询结果与人工基准 SQL 对比；拒绝场景通过 dic-be 审计和 MaxCompute 作业列表证明未提交作业。Mock、单元测试和静态检查不能替代该步骤。

## 14. 上线顺序

1. 部署数据库表和治理管理能力，不发布任何数据集或授权。
2. 部署 dic-be Query Broker，保持执行器或策略关闭。
3. 部署 DSH 专用 Profile，验证唯一工具和断言链路。
4. 部署 dic-fe 入口，仅对测试用户可见。
5. 发布一个测试数据集和最小授权策略。
6. 完成真实验收后逐步扩大用户范围。
7. 若出现权限或审计异常，撤销数据集/策略发布即可立即默认拒绝，无需依赖 DSH 下线。

## 15. 待部署输入

实现不依赖以下信息即可完成，但真实验收前必须提供：首批 MaxCompute 项目与表、指标和维度口径、行级权限映射、授权与未授权试用用户、测试环境 DSH/dic-be 服务地址、服务间密钥来源、MaxCompute 凭据引用以及预期结果基准。
