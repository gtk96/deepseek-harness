# `@deepseek-ai/dsh-data-aid`

[English](README.md) | 中文

用于受控语义问数的封闭 Profile Bundle。[`cordis.patch.yml`](cordis.patch.yml) 直接应用于空 profile 根，只挂载最小 Agent／LLM 服务、随附的 `data-aid` preset roster、`dataQuery` Runtime、DIC-BE HTTP Provider、可信 turn binding、一个专用 WebServer carrier 与严格的服务认证 turn ingress。它不继承 `dsh-base` 或 `dsh-web-app`，也不包含 Shell、文件系统、Web 工具、浏览器应用、通用 API、terminal、workflow、subagent、MCP、MaxCompute／Hologres server 或直查配置行。

CLI 会使用本 bundle 自动初始化 `dsh --profile data-aid`。通过[部署样例](../../../apps/cli/config/data-aid-mse/README.zh.md)记录的 `DATA_AID_QUERY_*` 与 `DATA_AID_INGRESS_*` 环境变量配置 DIC-BE endpoint、assertion issuer／audience、key ring、active `kid`、上限及 ingress listener／path／service identity／service token。缺失或弱安全配置会在 Loader 启动期间失败。该 profile 禁用用户 preset 根；CLI 只提供安装自身持有的 preset 根，其中 `data-aid` composition 贡献唯一模型可见工具 `data_query`。

bundle ingress 在读取 body 之前，通过精确的 `X-DSH-Service-Identity` 值和部署 secret bearer token 认证固定 DIC-BE workload。它只接受 `{principal, conversationId, turnId, question}`，创建使用随机内部 Session id 的 Agent 时挂载默认 preset，并在同步消息插入外围建立 `DataAidTurnPrincipalService.withTurn()`；只有 question 会到达模型。listener 默认绑定 `127.0.0.1`；显式绑定可达 interface 时，部署必须提供 TLS 终止、可信网络策略、速率控制与 secret rotation。该 profile 不暴露浏览器或通用公网入口，也不回退到 MSE visitor header。

同一专用监听器默认提供精确的 `GET /healthz/live` 与 `GET /healthz/ready` 路由。存活探针证明 Node HTTP 进程可响应，就绪探针证明封闭 Cordis 组合已完成；可用 `DATA_AID_HEALTH_LIVE_PATH` 和 `DATA_AID_HEALTH_READY_PATH` 替换路径。这些探针不会增加浏览器或通用 API。


## 模型体验

通过随附的 `data-aid` preset 间接产生影响：模型获得分析师 persona 和精确一个工具 `data_query`。bundle 不贡献其它模型可见文本。

#### KV Cache 影响

profile 为其创建的每个 Agent 固定同一份 preset 和工具 schema 前缀；查询参数与结果在该前缀之后变化。

## 已知限制与暂缓事项

- **Ingress 外围控制仍在仓库之外**——bundle 会认证并限制其精确服务路由，而 TLS、service-mesh authorization、rate limiting 与 secret rotation 仍由部署负责。
- **真实 DIC-BE 与 MaxCompute 验收仍在本仓之外**——keyless composition 与 snapshot test 证明随附装配和 wire 行为，不证明生产数据集、用户授权或云端作业。
