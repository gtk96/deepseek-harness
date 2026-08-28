---
description: "用于经 DIC-BE 执行服务认证、Principal 绑定语义问数的封闭 dsh profile。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-data-aid`

[English](README.md) | 中文

## 概述

在 DIC-BE 后方嵌入封闭受控问数运行时时，使用 `dsh --profile data-aid`。该 profile 挂载最小 Agent 与 LLM 服务、随附 `data-aid` preset、`dataQuery` runtime 与 DIC-BE provider、可信 turn binding、一个专用 WebServer carrier、健康探针及服务认证 turn ingress。它不继承 `dsh-base` 或 `dsh-web-app`，也不包含 shell、文件系统、Web 工具、浏览器应用、通用 API、terminal、workflow、subagent、MCP、数据源 server 或直查配置行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

CLI 会为 `dsh --profile data-aid` 初始化本 bundle。通过[部署样例](../../../apps/cli/config/data-aid-mse/README.zh.md)记录的 `DATA_AID_QUERY_*`、`DATA_AID_INGRESS_*`、`DATA_AID_TURN_CALLBACK_*` 与 `DATA_AID_HEALTH_*` 环境变量配置 DIC-BE endpoint、assertion issuer 与 audience、key ring、active `kid`、请求上限、ingress listener 与路径、service identity 与 token、callback 及健康路径。缺失或弱安全配置会在 Loader 启动期间失败。

```sh
dsh --profile data-aid
```

该 profile 禁用用户 preset 根。CLI 只提供安装自身持有的 preset 根，其中 `data-aid` composition 贡献唯一模型可见工具 `data_query`。只把 DIC-BE 部署为内部 ingress 的调用方；本 profile 不是浏览器或公网 API surface。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

专用 ingress 在读取 body 前，通过精确的 `X-DSH-Service-Identity` 值和部署 secret bearer token 认证固定 DIC-BE workload。它接受有界的 Principal、conversation、turn、question 与可选授权语义目录字段；使用默认 preset 创建带随机内部 Session id 的 Agent；并在同步消息插入外围建立 `DataAidTurnPrincipalService.withTurn()`。存在目录时，一条已记录的用户消息携带 `catalog + "\n\n---\n\n" + question`；request-local Principal 不会复制到 Session 状态。

listener 默认绑定 `127.0.0.1`。显式绑定可达 interface 时，部署必须提供 TLS 终止、可信网络策略、速率控制与 secret rotation。精确的存活和就绪路由共用该 carrier，且不会增加浏览器或通用 API。存活探针证明 Node HTTP 进程可响应，就绪探针证明封闭 Cordis composition 已完成。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 完整封闭 profile 配置树及其环境驱动的部署配置 |
| [`src/index.ts`](src/index.ts) | Bundle 包入口 |
| [`src/invariant.ts`](src/invariant.ts) | 静态 bundle composition 的不变式伴生插件 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [受控问数部署样例](../../../apps/cli/config/data-aid-mse/README.zh.md)——环境变量契约与封闭 profile 启动方式。
- [已认证 Data Aid adapter](../../identity/authenticated-principal-data-aid/README.zh.md)——ingress、turn binding、callback 与模型可见工具行为。
- [Data-query 子系统](../../../docs/subsystems/data-query.zh.md)——公开服务与受控语义请求词汇。

-----

<a id="model-experience"></a>
## 模型体验

通过随附的 `data-aid` preset 间接影响；该 preset 提供分析师 persona 与唯一的 `data_query` 工具。

#### KV Cache 影响

固定 persona 与工具 schema 构成稳定前缀；每轮授权目录、问题、查询与结果只扩展该轮后缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Ingress 外围控制仍由部署负责** — bundle 会认证并限制其精确服务路由，而 TLS、service-mesh authorization、rate limiting 与 secret rotation 仍属于部署职责。
- **真实 DIC-BE 与治理数据验收仍在仓库之外** — keyless composition 与 snapshot 证明随附装配和 wire 行为，不证明生产数据集、用户授权决定或云端查询作业。
- **该 profile 刻意不允许用户 preset 扩展** — 增加工具需要显式的可信 profile 变更，并会改变封闭运行时的安全审查。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
