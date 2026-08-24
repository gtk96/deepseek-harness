# Claude Code ↔ kiro-cli 评审交接约定

数智中心 MVP 的任务作业采用双工具闭环：

- **Claude Code** 负责任务实现（按 `.kiro/specs/controlled-data-query-mvp/tasks.md` 逐项推进）。
- **kiro-cli** 负责评审（读取 spec 与实现，产出结论）。
- 两者**不直接进程通信**，通过本目录 + `tasks.md` 的共享文件交接；命令调用方负责把本轮报告路径交给 Claude Code 回读。

## 交接协议

```text
1. 实现：Claude Code 完成任务 N → 在 tasks.md 勾选并写入证据
2. 触发：Claude Code 或用户调用 kiro-cli（见 review-prompt.template.md）
3. 评审：kiro-cli 读取 spec + 实现 → 新建本轮结论文件，不覆盖历史报告
4. 返回：kiro-cli 在最终响应中返回报告的准确路径、状态和 P1 数量
5. 回读：调用方确保 Claude Code 读取该准确路径；不得仅凭“最新文件”猜测
6. 处置：Claude Code 逐项修订或说明异议；需要复审时触发下一轮报告
```

如果由用户手动触发评审，用户需把 kiro-cli 返回的报告路径交给 Claude Code；如果由 Claude Code 调用，则 Claude Code 必须等待命令结束并读取返回路径。命令失败、未返回路径或报告文件不存在时，本轮交接不视为完成。注意 `kiro-cli chat` 是交互式 TUI：由 Claude Code 触发时需确保其输出可被脚本捕获（否则改由你中转返回路径）；由你手动触发时直接照抄返回路径即可。

## 评审结论文件

- 命名：`task<任务编号>-<YYYY-MM-DD>-r<轮次>.md`，例如 `task2-2026-08-24-r1.md`。
- 轮次：同一任务同一天从 `r1` 开始，取现有最大轮次加一；每轮必须新建文件，禁止覆盖。
- 格式：见下（与 `review-prompt.template.md` 一致）。

```markdown
# 任务 <N> 评审 — <标题>

**状态**：approved | rejected | needs-changes
**评审轮次**：r<轮次>
**实现范围**：<本轮实际检查的目录、文件或提交>

## 验收核验（对照 requirements.md）
| 验收标准 | 结果 | 证据 |
|---|---|---|

## 逐文件结论（对照 design.md）
| 文件 | 保留/修改/缺失 | 依据 |
|---|---|---|

## 发现（按严重度）
### P1 阻断
### P2 需修
### P3 建议

## 证据清单
- （实际运行的命令与结果，不用摘要代替）

## 待办
- [ ] ...
```

## 触发命令

```bash
# 用户或 Claude Code 触发；只需提供任务编号，日期、轮次和实现范围由评审 agent 确定
kiro-cli chat "依据 .kiro/reviews/review-prompt.template.md 评审任务 <任务编号>；完成后返回报告文件的准确路径"
```

## 约定

- 每次评审只新建一个结论文件；不得修改或删除历史结论。
- `tasks.md` 是唯一任务状态源；评审 agent 不修改 spec、任务状态或实现代码。
- Claude Code 必须读取本轮命令返回的准确报告路径，并逐项处理待办；不能只扫描目录后假定某个文件是本轮报告。
- `rejected` 或 P1 阻断未清前不进入下一任务；`needs-changes` 修订后应产生新一轮报告。
- `approved` 表示本轮已验证范围通过，不代表未纳入实现范围的内容已验证。
