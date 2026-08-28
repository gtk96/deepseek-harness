# 受控数据查询验收输入

[English](README.md) | 中文

此目录只包含任务 15 和 16 使用的 schema 示例。`input.template.json` 有意设置为无效，且不包含真实的 project、table、subject、policy、SQL、result、credential 或 evidence path。验证器成功只能证明输入内部完整，不能证明已发布治理 row、已部署集群、已运行 MaxCompute job，或任务 15／16 已通过。

## 在 Git 外准备输入

1. 将 `input.template.json` 复制到所有仓库 checkout 之外、受访问控制的绝对路径。
2. 使用 dataset owner、security owner 和 test-environment owner 批准的值替换每个 placeholder。输入本身和 evidence directory 均须位于 Git 外。
3. `credentialRef` 中只能填写 `secret-manager://store/reference` locator。绝不能在此文件中填写 access key、secret key、bearer value、cookie、JWT、password、secret payload 或 Kubernetes Secret。
4. 使用一个真实的 MaxCompute `project.table`、固定的业务日期、单条只读 benchmark query，以及独立计算的 expected result（不超过 100 行）。query 只能从该 table 读取，必须使用每个选中 semantic code 作为准确的 `AS` alias，并在验证器接受的子集内准确复现 semantic filter、authoritative scope、fixed-date equality、dimension grouping、requested ordering 和 limit。Expected column 按 semantic request 顺序排列，dimension 在前，metric 在后。query 和 result 均属于验收材料，不得复制到仓库日志。
5. 指定彼此不同且已认证的 authorized user 和 unauthorized user。根据权威 staff record 配置 authorized user：`authority_data_role` 提供 data role，row scope 则只使用验证器接受的已批准 `scopeMappings.source` field。
6. 为每个 fault-control procedure 和 rollback 获取书面批准。验证器绝不会执行 procedure。

在仓库根目录验证 Git 外的文件：

```powershell
node deploy/controlled-data-query/scripts/validate-acceptance-input.mjs E:\secure-acceptance\controlled-data-query.json
```

验证器需要 Node.js 和本地 Git。它只会执行一条不经 shell、限时五秒的 `git rev-parse`，以证明传入的仓库根目录是规范 checkout 的顶层目录；它不会运行 hook 或访问 remote。成功输出只包含 validation count 和 canonical SHA-256 fingerprint。验证失败会报告 JSON path 和 error category，不会报告被拒绝的值。将 fingerprint 与 change ticket 一起保存，使 governance publication 和任务 16 evidence 能关联到经过评审的准确输入。

Policy 的 `validFrom` 和 `expiresAt` 值只能是 `null`，或精确到整秒、带 `Z` 或显式 numeric offset 的规范 ISO timestamp。当前 TiDB／MySQL ORM column 未声明 fractional-second precision，因此会拒绝 subsecond value；publisher 会将接受的 offset 规范化为 naive UTC，且不会截断已批准的数据。

## 发布治理数据

data-query 应用有意不公开 governance-write HTTP API。其仅供管理员使用的 CLI 是从 `dic-be` checkout 运行的 `python -m app.data_query.governance_publisher`；它不会注册到 application bootstrap、`init_db` 或任何 seed stage。输入中的 `definition` field 仍是 acceptance SHA 覆盖的人工评审材料，因为当前 governance ORM 不会持久化 definition。不要声称这些 definition 已写入 TiDB。

首先运行 CLI，且只传入 `--input <absolute-path>`。此模式是 database read-only plan：它通过固定的 parent Node validator 验证准确的输入 byte、检测全局 metric／dimension code collision，并且只输出 row count 以及 acceptance／desired SHA 值。它仍需要指定测试数据库的环境配置；绝不能在命令行中放置 DSN 或 password。

Apply 会真实修改测试数据库，执行前必须立即获得 environment owner 的明确确认。传入 `--apply`、验证器输出的准确 `--approve-input-sha256`、外部 `--change-ticket` 和 `--approval-ref` 值，以及作为 `evidenceDirectory` 新直接子项的 `--snapshot`。该工具会持有 MySQL／TiDB global publication lock、执行单个 transaction、验证 post-state、在 commit 前写入 pending snapshot，并且只在 commit 后将其提升为最终 snapshot。将安全输出中的 acceptance、desired 和 snapshot SHA 值记录到外部 change ticket。`.pending` artifact 不是成功证据；它表示 commit 结果需要 database owner 进行 reconciliation。

Rollback 必须重新验证未改变的 acceptance input，并要求传入 `--rollback`、`--approve-input-sha256`、`--expect-desired-sha256`、`--expect-snapshot-sha256`、相同的 ticket／approval reference，以及最终 snapshot。遇到任何 mismatch、malformed／cross-dataset snapshot closure 或 current-state drift 时，它都会拒绝操作，然后才会以 atomic 方式恢复之前的 row。database auto-increment high-water mark 不会恢复。

Apply 前，导出现有 row，或以其他方式记录每个受影响 code 的现有 row，并评审生成的 plan。Snapshot file 包含 physical mapping 和 authorization subject：将其保存在受访问控制的 evidence directory 中，绝不能放入 Git 或普通日志。不要添加 public seed endpoint，也不要使用 mock／open wildcard policy。

## 必需的验收证据

任务 15 evidence 必须证明 controlled database publication、authoritative subject resolution、准确的 default-deny policy 和 MaxCompute metadata check。任务 16 evidence 还必须证明：浏览器使用真实 job identifier 成功；benchmark-result 相等；因 policy、unpublished-metric、denied-dimension 和 assertion-replay 而拒绝时没有新的 MaxCompute job；100 行和 30 秒限制；已批准的 cancellation 和 fault case；实际 DSH tool list 为 `['data_query']`；并且 browser output、application log、audit row 和 DSH transcript 均已完成 sensitive-data scan。

将带 timestamp 的 command output、screenshot、audit extract、MaxCompute job-list comparison、rollback evidence 和 fingerprint 保存在 `evidenceDirectory` 下。只能为人工展示进行 redact；必须保留受访问控制的 original。绝不能把本地 fake adapter、SQLite test、静态 manifest 门禁、本地 image smoke 或此 validator 声称为真实 MaxCompute 或 cluster acceptance。
