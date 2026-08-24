# identity/ — 共享身份

[English](README.md) | 中文

跨产品领域共享的身份值。匿名关联与已认证 request-local 账户事实属于不同能力；已认证 Principal 不是匿名用户 id。

| 包 | 职责 | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.zh.md) | 为遥测、反馈和 DeepSeek 请求持久化一个限定于 Harness home 的匿名关联 id | — |
| [`authenticated-principal/`](authenticated-principal/README.zh.md) | 提供不持久化的 request-local 已认证账户与数据鉴权事实 | `authenticatedPrincipal` |
| [`authenticated-principal-data-aid/`](authenticated-principal-data-aid/README.zh.md) | 适配可信 data-aid 网关访问者及部署提供的身份／权限 resolver | `authenticatedPrincipal` |
| [`data-query/`](data-query/README.zh.md) | 受控语义数据查询的 Service Definition 与 provider 注册表 | `dataQuery` |
| [`data-query-dic-be/`](data-query-dic-be/README.zh.md) | 为语义查询签发短期 Principal 断言的 dic-be HTTP provider | — |
