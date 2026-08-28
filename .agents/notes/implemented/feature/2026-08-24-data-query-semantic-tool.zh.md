# Agent Note: 基于 data-query 能力的语义化 data_query 工具

Status: implemented

[English](2026-08-24-data-query-semantic-tool.md) | 中文

## 问题

早期模型可见问数能力接受 SQL，并依赖 raw MCP broker。受控问数 MVP 要求唯一语义工具：参数不能选择物理执行，身份不能由模型或 DSH Session 数据伪造，而且 HTTP Provider 在取消、畸形数据和密钥轮换下都必须与已部署 DIC-BE 协议一致。

## 决策

专用 preset 精确只暴露 `data_query`，不暴露任何 raw MCP 能力。其 closed parameter root 把本地可表达的全部上限投影进模型 schema：目录 code 长度／pattern、字段／过滤／排序数量、code 数组唯一性、过滤值长度／数量以及 1–100 行范围；跨字段语义仍由宿主校验。Consumer 只从 `DataAidTurnPrincipalService` 获取 `principalId`、`conversationId` 与 `turnId`；ingress 在同步 Agent 消息插入外围调用 `withTurn()`。该服务按精确 Agent 与消息身份管理排队状态，拒绝不同 binding，以及以任一顺序混入 bound 与 unbound claimed message 的 turn，并在 claim／discard、turn stop、Agent dispose 和服务 dispose 时清理状态。它绝不从 Session id 或内部 turn number 派生业务 id。

DIC-BE Provider 使用部署 key ring 与 active `kid` 进行 HS256 签名。JWT header 精确包含 `alg`、`typ` 与 `kid`；claims 精确包含 `iss`、`aud`、`sub`、`jti`、`iat`、`exp`、`conversationId` 与 `turnId`，TTL 硬上限为 60 秒。请求 timeout 与行数硬上限分别为 30 秒和 100。响应必须精确包含 `{columns, rows, rowCount, complete:true, truncated:false}`；额外字段、畸形 JSON、行数不一致、重定向和截断都会 fail closed。cell 接受嵌套的普通稠密 JSON object 与 array，同时使用迭代式深度／节点上限、有界字符串、finite 且可无损表示的数值，以及 wire 与规范化结果的 UTF-8 byte 上限阻止病态结果。

CLI 把 `data-aid` 作为可自动初始化的 profile 随附，其唯一 bundle 直接应用于空根。该 bundle 挂载最小 Agent／LLM 栈、安装自身持有的 preset roster、受控 runtime 与 Provider、可信 turn binding、专用 WebServer carrier 与一个严格 ingress；它不继承 `dsh-base` 或 `dsh-web-app`。ingress 在读取有 byte 上限的 body 前认证配置的固定服务身份与 bearer secret，只接受 `{principal, conversationId, turnId, question}`，使用随机内部 Session id 把业务 conversation 映射到 Agent，挂载默认 preset，并在 `agent.followup()` 外同步调用 `withTurn()`；只有 question 进入 Session／模型输入。

terminal callback 把已经记录的 `data_query` 错误作为权威查询结果，即使后续模型步骤失败：稳定的策略与语义拒绝仍为 denied，超时仍为 timed out，其它查询错误仍为 failed。成功查询结果不会覆盖后续 Agent 错误，因为模型可见回答步骤仍未完成。该顺序避免 provider 在被拒工具调用之后失败时，把可审计的执行前拒绝错误转换为无关的 `DQ_AGENT_FAILED`。

真实 Loader composition test 解析该随附 profile 层，证明不加载 MCP 或直查模块且唯一工具是 `data_query`；它发送不会创建 Agent 的错误 identity 与额外字段 HTTP 请求，再发送一个接受请求，捕获 active trusted binding，验证 Principal／conversation／turn 值不出现在 Session event 或记录的模型请求中，并验证 ingress route／Agent disposal。固定 expected 文件快照完整 `data_query` schema。keyless runnable Agent snapshot 通过相同 Consumer 与 Provider 执行两个 trusted turn：一个治理成功结果和一个 fake broker HTTP 策略拒绝。包内 tsdown entry 把每个已声明 Loader subpath 生成为独立文件，plain-Node smoke 从 examples workspace 导入这些 package export。

## 替代方案

- **保留模型可见 SQL 或 raw MCP。** 否决：模型可以选择物理 authority，专用语义目录无法强制执行。
- **从 DSH Session 状态派生业务 id。** 否决：这些 id 属于 DIC-BE dispatch，本地派生会伪造授权上下文。
- **只捕获环境 Principal。** 否决：它无法证明授权本次查询的精确 DIC-BE conversation 与 turn。
- **复用 MSE visitor header 或把 `conversationId` 用作 Agent Session id。** 否决：visitor header 通过直连 proxy 认证浏览器，而不是 workload dispatch；业务 conversation Session id 则会到达模型 adapter metadata。
- **接受兼容响应超集或字符上限。** 否决：DIC-BE 指定五个字段并按 byte 限制；宽松解析会掩盖协议漂移并错误处理多字节数据。
- **始终让最终 Agent reason 覆盖已完成的工具错误。** 否决：provider 在可审计的 broker 拒绝之后失败时会抹掉真实授权结果，即使根本没有提交数据源作业。

## 后果

部署可以通过重叠 verification entry 并切换 active `kid` 来轮换 assertion key。工具输入与成功结果保持有界且确定；abort 与 timeout 会取消底层 HTTP 工作。缺少 trusted turn 状态时，`data_query` 不可用，不会退回 Session 派生身份。

封闭 profile 现可接收通过服务认证的 DIC-BE `{principal, conversationId, turnId, question}` dispatch，而无需挂载旧的 MSE visitor-header 或 MaxCompute MCP 身份路径。精确服务身份与 bearer token 是部署配置；路由拒绝额外字段，只在进程内保留业务 id 用于授权，并在 turn 状态缺失或冲突时 fail closed。listener 默认绑定 loopback。TLS 终止、service-mesh／网络授权、速率控制、secret rotation 及真实 DIC-BE／MaxCompute 验收仍属于部署工作。
