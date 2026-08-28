---
description: "Data Aid authentication, trusted-turn ingress, callbacks, health probes, and controlled-query adapters for DIC-BE deployments."
kind: "package-reference"
---

# @deepseek-ai/dsh-authenticated-principal-data-aid

[English](README.md) | 中文

## 概述

`DataAidGatewayAuthenticator` 是 `@deepseek-ai/dsh-authenticated-principal` 的 data-aid Service Provider。它先执行部署提供的网关信任校验，再严格解析现有的 `gk-service-user` 和可选 `gk-service-app` header，随后调用拥有既有身份映射与鉴权 SQL／服务的 resolver。

本包有意不把 `X-Forwarded-Host` 或 `gk-service-user` 的存在本身当作证明。`DataAidMseGatewayAuthenticator` 提供受支持的 MSE 部署验证器：只有当 `@deepseek-ai/dsh-client-connection` 为 Fetch request 记录了已配置的直连 TCP proxy IP 时，才接受访问者 header。MSE 或企业 SSO proxy 负责钉钉登录、移除浏览器传入的身份 header，并向上游注入已验证的 header。校验返回 false、访问者 header 缺失或格式错误、身份映射缺失、权限事实缺失或 resolver 失败，全部按认证失败拒绝，不会降级为匿名身份。

## 目录

- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## 网关访问者解析

解析器遵循 data-aid 当前表示：每个 header 是包含 UTF-8 JSON 的标准 Base64。`gk-service-user` 必须解码为带非空字符串 `id` 的对象；`gk-service-app` 可选，但存在时必须解码为其可选 `clientId` 为非空字符串的对象。要求使用规范 padding 与有效 UTF-8。Fetch 对重复 header 的合并值无法通过严格 Base64 校验，因此 Provider 不会任意选择重复身份中的一个。

解析器只向 resolver 暴露带 brand 的 `ddUserId` 与可选 `clientId`，不会把原始访问者对象复制到 Principal。resolver 只在 Provider 内收到原始 request；Remote wire `args` 保持不变。

## Resolver seam

```ts
import type {
  DataAidGatewayVisitor,
  DataAidPrincipalResolution,
} from '@deepseek-ai/dsh-authenticated-principal-data-aid'

interface DataAidPrincipalResolver {
  resolve(input: {
    visitor: DataAidGatewayVisitor
    request: Request
    signal: AbortSignal
  }): DataAidPrincipalResolution | undefined | Promise<DataAidPrincipalResolution | undefined>
}
```

resolver 以 `ddUserId` 开始，执行既有的 `gk_userid`／`gimp_staff_id` 映射，并按既有 data-aid 权威结果原样返回 `dataRole`、`teamCodes` 和 `dataOrgCodes`。返回 `undefined` 表示请求未被授权。

### 已确认的 MaxCompute 表 resolver

`createDataAidTablePrincipalResolver` 为已确认的 MaxCompute 快照提供固定 resolver。它要求部署显式提供两个 hook，不会隐式选择分区：

```ts
import {
  createDataAidTablePrincipalResolver,
  type DataAidAuthorityPartitionResolver,
  type DataAidAuthorityQuery,
} from '@deepseek-ai/dsh-authenticated-principal-data-aid'

declare const resolveCurrentAuthorityPartition: DataAidAuthorityPartitionResolver
declare const executeMaxComputeSelect: DataAidAuthorityQuery

const principalResolver = createDataAidTablePrincipalResolver({
  resolvePartition: resolveCurrentAuthorityPartition,
  query: executeMaxComputeSelect,
})
```

`resolvePartition` 返回明确的 `dt`（`YYYYMMDD`）和 `ht`（`HH`）快照。`query` 接收 `buildDataAidAuthoritySql` 生成的 SQL 及本次 request 的 `AbortSignal`，并返回原始结果行。注册在 `ctx.tools` 中、对模型可见的 MCP 工具不能用于模型调用之前的认证步骤。

### 直接 MaxCompute MCP query

`createDataAidMaxComputeMcpQuery` 适配 `@deepseek-ai/dsh-mcp-client/mcp-clients` 提供的直接 `ctx.mcpClients` registry。它在模型循环前调用一个配置好的原始 MCP SELECT 工具；该 bridge 必须设置 `exposeTools: false`，使鉴权工具永远不会进入模型工具目录。

```ts
import {
  createDataAidMaxComputeMcpQuery,
  createDataAidTablePrincipalResolver,
} from '@deepseek-ai/dsh-authenticated-principal-data-aid'
import type { McpClientRegistry } from '@deepseek-ai/dsh-mcp-client/mcp-clients'

export function principalResolver(mcpClients: McpClientRegistry) {
  return createDataAidTablePrincipalResolver({
    resolvePartition: () => ({ dt: '20260819', ht: '14' }),
    query: createDataAidMaxComputeMcpQuery(mcpClients, {
      serverName: 'maxcompute-authority',
      toolName: 'execute_sql',
      project: 'giikin',
      maxCU: 10,
      timeoutSeconds: 30,
    }),
  })
}
```

配置的 MCP 工具必须接受 `project`、`sql`、`async: false`、`maxCU` 和 `timeout`，并返回包含 `success: true`、`truncated: false`、相等的 `rowCount`／`rowsReturned` 及完整 `data` 数组的 `structuredContent`。MCP 错误、仅文本响应、截断、计数不一致与字段缺失都会 fail closed。

生成的 SQL 读取 `ods_pl_gimp__gk_dingtalk_user_hourly`（别名 `i`）和 `dmr_pty_staff_attribute_authority_hourly`（别名 `a`）。它要求 `i.gk_userid = a.gimp_staff_id`、`i.dd_userid = a.dd_staff_id`、`i.status = '1'`、`a.staff_status = '1'`，并要求两张表使用相同的 `dt`／`ht`。查询返回 `i.gk_userid`、`a.gimp_staff_id`、作为请求见证的 `i.dd_userid` 与 `a.dd_staff_id`、JSON `$.data_role` 的 `data_role`、JSON `$.area_ids` 的 `team_codes`，以及 JSON `$.data_org` 的 `data_org_code`。`LIMIT 2` 保留足够的结果，以区分零行、单行和多行匹配。

部署提供的 query callback 必须返回该 limit 产生的完整结果集；不能在 resolver 看到结果前静默分页或截断行。resolver 只接受恰好一行。它验证两个映射 id 和全部权限值都是非空字符串，保留诸如 `"0"` 的字符串值，并拆分逗号分隔的团队与组织 code。零行、多行、格式错误的行、缺少权限值以及查询失败，都会经 `DataAidGatewayAuthenticator` fail closed。

## 组合

Provider 是一个 Service plugin，需要两个可信同进程配置 hook。部署可以通过带 `!!js` 的 Cordis 配置条目或小型 composition plugin 提供它们。可选 MCP 路径会在 Principal Provider 之前挂载直接 registry 和专用的非模型 bridge：

```yaml
- id: mcp-clients
  name: '@deepseek-ai/dsh-mcp-client/mcp-clients'

- id: mcp-maxcompute-authority
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: maxcompute-authority
    transport: streamable-http
    url: !!js process.env.DATA_AID_MAXCOMPUTE_MCP_URL
    headers:
      Authorization: !!js '`Bearer ${process.env.DATA_AID_MAXCOMPUTE_MCP_TOKEN}`'
    exposeTools: false
    failOnStartupError: true

- id: authenticated-principal
  name: '@deepseek-ai/dsh-authenticated-principal-data-aid'
  config:
    verifyGatewayRequest: !!js ./deployment/auth.js#verifyGatewayRequest
    resolver: !!js ./deployment/data-aid.js#principalResolver
```

Provider 注册 `ctx.authenticatedPrincipal`。Typert Gateway 会在调用前认证 Fetch request，并且只在本次调用返回的生命周期内建立 Principal。

### MSE 钉钉 Provider

`@deepseek-ai/dsh-authenticated-principal-data-aid/mse-gateway` 为旧版或外部 MSE／企业 SSO 组合导出 `DataAidMseGatewayAuthenticator`；这些组合另行选择可选的 MaxCompute MCP 权限 adapter。其 `trustedProxyAddresses` 选项是 DSH 实际观测到的非空且不重复的直连 IP literal 列表；IPv4-mapped IPv6 peer address 会归一化为 IPv4 literal。它会拒绝 hostname、proxy forwarding header、人工构造的 Fetch request 和缺失的 bridge metadata。

随附的封闭 [`data-aid` profile](../../../packages/bundle/data-aid/README.zh.md) 不挂载该 Provider 或任何 MCP 包。DIC-BE 负责浏览器身份，并通过下文独立认证的严格 turn ingress 调用 DSH；该服务路由不接受浏览器 visitor header。

### 严格 DIC-BE turn ingress

`@deepseek-ai/dsh-authenticated-principal-data-aid/dic-be-turn-ingress` 是封闭 profile 挂载的生产服务 transport。它只暴露一个配置的精确 `POST` path。DIC-BE 必须发送配置好的 `X-DSH-Service-Identity`、`Authorization: Bearer <service token>` 与 `Content-Type: application/json`；系统在读取有 byte 上限的 body 之前完成认证。JSON object 必须精确包含 `principal`、`conversationId`、`turnId` 与 `question`。未知字段、重复／合并的服务身份 header、格式错误的 identifier、未归一化的 question、过大 body 与错误 credential 都会被拒绝，且不会回显请求值。

ingress 在进程内保存有界的 conversation→Agent 映射和已接受 turn 表，为每个 Agent 生成随机内部 Session id，并挂载 profile 默认 preset／model；只有通过 credential、raw SQL 与精确业务 ID 安全门禁的 question 才会作为 user message 插入。它在 `agent.followup()` 外同步调用 `DataAidTurnPrincipalService.withTurn()`，因此三个业务身份值只供宿主侧授权使用，绝不会出现在模型 message、工具参数、system text 或 Session event 中。完全相同的重复派发会直接接受而不创建另一个 Agent turn；冲突复用 `turnId` 会被拒绝。接受请求时返回不带 identifier 的 `202 {"accepted":true}`；失败只返回 `{"accepted":false}`。

绑定 message 被真实 claim 时，ingress 使用固定服务认证向配置好的 DIC-BE broker URL 回调 `running`。匹配的持久 `turn/end` 只生成一个终态投影：最终 assistant text、可选的严格三字段受控结果，或稳定错误码。running 与终态发送严格串行，并在配置上限内重试。回调 payload 使用进程内 binding，而不是读取 Session；answer／result 一旦包含 credential、raw SQL 或任一精确 binding 值就会失败关闭，不会持久化。DIC-BE 负责幂等状态校验和 accepted turn 完成看门狗，因此丢失回调最终收敛为 `timed_out`，不会永久停在非终态。

`DATA_AID_INGRESS_HOST` 默认是 `127.0.0.1`。多服务部署可显式绑定可达 interface，但随附 WebServer 不终止 TLS：service mesh 或 reverse proxy 必须提供 TLS、可信网络策略、请求速率控制和 secret 注入。`DATA_AID_INGRESS_SERVICE_TOKEN` 必须是部署生成且至少 32 UTF-8 byte 的 secret。该服务 credential 用于认证 DIC-BE workload，不能替代 DIC-BE 的用户认证或已签名 query assertion。

### Data Aid 工作负载健康检查

`@deepseek-ai/dsh-authenticated-principal-data-aid/data-aid-health` 在专用监听器上注册可配置的精确 `GET` 路由。内置 bundle 默认使用 `/healthz/live` 检查进程存活，使用 `/healthz/ready` 检查 Cordis 组合已完成。两者只返回小型、禁止缓存的 JSON，拒绝其他方法，且不会增加 fallback、浏览器 API 或通用公开路由。平台预留其他探针路径时，通过 `DATA_AID_HEALTH_LIVE_PATH` 和 `DATA_AID_HEALTH_READY_PATH` 配置。

### Loopback Provider

`@deepseek-ai/dsh-authenticated-principal-data-aid/loopback-test` 仍可用于旧版浏览器认证路径的隔离测试。DSH Web 绑定在本地 `127.0.0.1`；其 HTTP bridge 向认证 plugin 提供固定内部 origin `http://dsh.internal`，Provider 要求该 origin 和明确的测试密钥。它不能验证 MSE 或反向代理边界，绝不能作为生产 Provider 使用。用于 [`data-aid` profile](../../../apps/cli/config/data-aid-test/README.zh.md) 的受控 broker 冒烟 patch 不挂载它。

## 本地直连问数测试

`@deepseek-ai/dsh-authenticated-principal-data-aid/direct-query-tools` 为本地单用户测试注册 `data_query_maxcompute` 和 `data_query_hologres`。每个封装只接受一条无分号的 `SELECT` 或 `WITH` 语句，只调用已部署服务的读查询 MCP 操作，并限制到达模型的序列化结果。两个 MCP bridge 都必须设置 `exposeTools: false`。

该能力有意不依赖 Principal 或授权 broker。它使用本地 MCP service identity，因此只能绑定 loopback 使用。WSL 组合位于 [`apps/cli/config/data-aid-direct-test`](../../../apps/cli/config/data-aid-direct-test/README.zh.md)；不得用于共享、LAN、反向代理或公开访问。

## 网关行为

无，因为网关 header、resolver 输出和鉴权失败都属于对模型隐藏的 transport 与服务状态。

#### KV Cache 影响

与模型前缀缓存无关；Provider 不会向模型可见内容追加身份或权限字段。

## 网关部署职责

- **MSE 身份边界由基础设施负责**——`DataAidMseGatewayAuthenticator` 验证直连 proxy peer，但 MSE／企业 SSO 仍必须终止 TLS、执行钉钉登录、移除客户端身份 header，并在 DSH 收到请求前注入已验证的 header。
- **MCP 工具约定由部署负责**——可选 adapter 需要已部署 SELECT 工具的原始名称及其同步结构化结果字段；不支持的工具输入或结果格式会导致认证失败，不会解析文本回退。
- **网关集成只支持 HTTP**——ACP 和其他进程边界需要各自的认证 transport adapter，本 Provider 有意不启用它们。

## 经授权的模型数据查询

`@deepseek-ai/dsh-authenticated-principal-data-aid/turn-principal` 只把完整的服务认证 dispatch binding——`principalId`、`conversationId` 与 `turnId`——从同步 Agent 消息插入传递到匹配的运行中 turn。它按精确 Agent 与消息身份保存进程内引用，在 claim、discard、turn stop、Agent dispose 和服务 dispose 时移除排队与活动引用，并拒绝冲突 binding，以及以任一顺序混入 bound 与 unbound claimed message 的 turn。它绝不会从 DSH Session 或内部 turn number 派生业务 id。

`@deepseek-ai/dsh-authenticated-principal-data-aid/data-query-tool` 在 Data Aid agent preset 中注册唯一模型可见的 `data_query` 能力。其 closed root 只接受有界语义目录 code——一个数据集、不重复的指标与维度、finite 标量过滤、一个时间范围、已选字段排序与行数上限——绝不接受 SQL、物理标识符、身份、endpoint 或执行配置。工具从活动 trusted binding 读取全部三个身份字段，通过 `ctx.dataQuery` 派发宿主所有的 `DataQueryRequest`，并返回 broker 的完整五字段表格结果。缺失、格式错误、冲突或已经清理的生命周期状态都会 fail closed。

生产装配 `@deepseek-ai/dsh-data-query-dic-be` Provider。它签发 header 携带 active key-ring `kid`、payload 精确包含 `iss`、`aud`、`sub`、`jti`、`iat`、`exp`、`conversationId` 与 `turnId` 的 assertion。它只接受严格的 `{columns, rows, rowCount, complete:true, truncated:false}` 响应与完整且受 UTF-8 byte 上限约束的结果。每个 cell 可以是嵌套 JSON object 或 array，但所有数值必须 finite 且可无损表示，字符串有长度上限，对象与数组必须是普通稠密 JSON，并且逐 cell 深度与节点上限会阻止病态嵌套。DIC-BE 必须验证 assertion、一次性消费 `jti`，并在服务端执行全部数据集、字段、谓词与行级授权。不得把本 Provider 指向 `maxcompute-authority.execute_sql`；该 bridge 用于认证浏览器请求，不能授予业务数据访问权。

随附的 `data-aid` profile 从自身的封闭 bundle 启动；其 preset 精确只含 `data_query`，不含任何 raw MCP 能力。bundle 把 `DATA_AID_QUERY_ASSERTION_KEY_RING` 读取为 JSON object，并配合 `DATA_AID_QUERY_ASSERTION_ACTIVE_KID`；endpoint、assertion 上限、语义限制，以及专用服务 ingress 的 listener、path、identity、token、body 与 question 上限，使用 `apps/cli/config/data-aid-mse/.env.example` 展示的 `DATA_AID_QUERY_*` 和 `DATA_AID_INGRESS_*` 设置。不得将 key material 写入源码管理。


<a id="model-experience"></a>
## 模型体验

### `data_query`

#### 模型看到的内容

模型看到一个 closed `data_query` 语义工具 schema，接受治理过的数据集、指标、维度、过滤、时间范围、排序和行数上限字段；成功值是严格五字段表格结果，安全失败不会暴露 assertion、SQL、job id、endpoint 或身份。

#### Token 影响

稳定 schema 进入请求前缀；每次调用增加有界参数及受 Provider 行数和 UTF-8 byte 上限约束的结果。

#### KV Cache 影响

schema 在 turn 之间保持稳定，本身不会使前缀 cache 失效；每轮调用与结果只扩展会话后缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **Ingress 网络控制仍由部署持有**——随附严格路由会认证固定服务身份与 bearer secret，但其 WebServer 不提供 TLS、service-mesh policy、rate limiting 或 secret rotation。
- **真实 broker 与 MaxCompute 验收属于外部工作**——本地 HTTP 与 keyless snapshot 只证明 DSH composition 和协议处理，不证明生产授权、网络策略或治理数据正确性。
- **直连问数工具仍仅限本地**——独立 `data-aid-direct` preset 使用缺少逐用户业务数据授权的 service credential，不得通过共享或公网 listener 暴露。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
