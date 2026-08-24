# @deepseek-ai/dsh-authenticated-principal-data-aid

[English](README.md) | 中文

`DataAidGatewayAuthenticator` 是 `@deepseek-ai/dsh-authenticated-principal` 的 data-aid Service Provider。它先执行部署提供的网关信任校验，再严格解析现有的 `gk-service-user` 和可选 `gk-service-app` header，随后调用拥有既有身份映射与鉴权 SQL／服务的 resolver。

本包有意不把 `X-Forwarded-Host` 或 `gk-service-user` 的存在本身当作证明。`DataAidMseGatewayAuthenticator` 提供受支持的 MSE 部署验证器：只有当 `@deepseek-ai/dsh-client-connection` 为 Fetch request 记录了已配置的直连 TCP proxy IP 时，才接受访问者 header。MSE 或企业 SSO proxy 负责钉钉登录、移除浏览器传入的身份 header，并向上游注入已验证的 header。校验返回 false、访问者 header 缺失或格式错误、身份映射缺失、权限事实缺失或 resolver 失败，全部按认证失败拒绝，不会降级为匿名身份。

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

部署提供的 query callback 必须返回该 limit 产生的完整结果集；不能在 resolver 看到结果前静默分页或截断行。
resolver 只接受恰好一行。它验证两个映射 id 和全部权限值都是非空字符串，保留诸如 `"0"` 的字符串值，并拆分逗号分隔的团队与组织 code。零行、多行、格式错误的行、缺少权限值以及查询失败，都会经 `DataAidGatewayAuthenticator` fail closed。

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

### MSE 钉钉部署

`@deepseek-ai/dsh-authenticated-principal-data-aid/mse-gateway` 为 MSE／企业 SSO 拓扑导出 `DataAidMseGatewayAuthenticator`。其 `trustedProxyAddresses` 选项是 DSH 实际观测到的非空且不重复的直连 IP literal 列表；IPv4-mapped IPv6 peer address 会归一化为 IPv4 literal。它会拒绝 hostname、proxy forwarding header、人工构造的 Fetch request 和缺失的 bridge metadata。生产 overlay 位于 [`apps/cli/config/data-aid-mse`](../../../apps/cli/config/data-aid-mse/README.md)。它要求明确的权限分区，并以 `exposeTools: false` 挂载原始 MaxCompute MCP bridge。

### Loopback smoke test

`@deepseek-ai/dsh-authenticated-principal-data-aid/loopback-test` 导出用于隔离 DSH Web 冒烟测试的 `DataAidLoopbackTestAuthenticator`，配置位于 [`apps/cli/config/data-aid-test`](../../../apps/cli/config/data-aid-test/README.md)。DSH Web 绑定在本地 `127.0.0.1`；其 HTTP bridge 向认证 plugin 提供固定内部 origin `http://dsh.internal`，Provider 要求该 origin 和明确的测试密钥。它不能验证 MSE 或反向代理边界，绝不能作为生产 Provider 使用。

## 本地直连问数测试

`@deepseek-ai/dsh-authenticated-principal-data-aid/direct-query-tools` 为本地单用户测试注册 `data_query_maxcompute` 和 `data_query_hologres`。每个封装只接受一条无分号的 `SELECT` 或 `WITH` 语句，只调用已部署服务的读查询 MCP 操作，并限制到达模型的序列化结果。两个 MCP bridge 都必须设置 `exposeTools: false`。

该能力有意不依赖 Principal 或授权 broker。它使用本地 MCP service identity，因此只能绑定 loopback 使用。WSL 组合位于 [`apps/cli/config/data-aid-direct-test`](../../../apps/cli/config/data-aid-direct-test/README.md)；不得用于共享、LAN、反向代理或公开访问。

## 模型体验

无，因为网关 header、resolver 输出和鉴权失败都属于对模型隐藏的 transport 与服务状态。

#### KV Cache 影响

与模型前缀缓存无关；Provider 不会向模型可见内容追加身份或权限字段。

## 已知限制与暂缓事项

- **MSE 身份边界由基础设施负责**——`DataAidMseGatewayAuthenticator` 验证直连 proxy peer，但 MSE／企业 SSO 仍必须终止 TLS、执行钉钉登录、移除客户端身份 header，并在 DSH 收到请求前注入已验证的 header。
- **MCP 工具约定由部署负责**——可选 adapter 需要已部署 SELECT 工具的原始名称及其同步结构化结果字段；不支持的工具输入或结果格式会导致认证失败，不会解析文本回退。
- **本集成只支持 HTTP**——ACP 和其他进程边界需要各自的认证 transport 适配器，本 Provider 有意不启用它们。

## 经授权的模型数据查询

`@deepseek-ai/dsh-authenticated-principal-data-aid/turn-principal` 只在同步、已认证的 prompt 插入与其匹配的运行中 Agent turn 之间传递 Principal。它按精确的 Agent 与消息身份在进程内保存引用；消息被 claim 或 discard 时删除排队引用，`agent/turn-stopping` 时删除活动引用，Agent dispose 时清除全部引用。它不会把 Principal 或 scope 持久化到 Session 或 Agent event。一个 turn claim 到不同 Principal 时会被拒绝。

`@deepseek-ai/dsh-authenticated-principal-data-aid/data-query-tool` 在 Data Aid agent preset 中注册模型可见的 `data_query` 能力。模型只能提供只读 SQL。工具从活动 Principal 派生 `ddUserId`、映射 id、角色、团队、组织和不透明授权 scope，将取消信号转发给 `ctx.mcpClients`，并把这些事实发送给一个独立 broker。缺少 turn 身份、Principal 冲突、MCP 失败、部分响应、非表格数据、计数不一致、超过 `maxRows` 的结果以及超过 `maxResultChars` 的 JSON 结果都会被拒绝。

broker 是鉴权决策点。它必须在服务端执行只读 SQL 以及所接收身份对应的表、列、join、谓词和行权限；DSH 不解析或授权模型 SQL。其 `authorized_query` 响应必须在 `structuredContent` 中包含 `success: true`、`complete: true`、`truncated: false`、相等的 `rowCount`／`rowsReturned`、字符串 `columns` 和矩形 `rows`。不得把此工具指向 `maxcompute-authority.execute_sql` bridge：该 bridge 仅用于认证请求，不能授予业务数据访问权。

随附的 `data-aid` preset 只包含 `data_query`。生产 overlay 要求独立的 `DATA_AID_QUERY_MCP_URL` 与 `DATA_AID_QUERY_MCP_TOKEN`，保持两个 MCP bridge 都为 `exposeTools: false`，并默认选择该 preset。`DATA_AID_QUERY_PROJECT`、`DATA_AID_QUERY_MAX_CU`、`DATA_AID_QUERY_TIMEOUT_SECONDS`、`DATA_AID_QUERY_MAX_ROWS` 和 `DATA_AID_QUERY_MAX_RESULT_CHARS` 是必填部署配置；不得将任何凭据写入源码管理。
