# Claude Code ↔ kiro-cli 自主交接约定

数智中心 MVP 的任务作业采用双工具闭环：

- **Claude Code** 负责任务实现（按 `.kiro/specs/controlled-data-query-mvp/tasks.md` 逐项推进）。
- **kiro-cli** 负责评审（读 spec 与实现，产出结论）。
- 两者**不直接进程通信**，通过本目录 + `tasks.md` 的共享文件交接。

## 交接协议

```
1. 实现：Claude Code 完成任务 N → 在 tasks.md 勾选并写入证据
2. 触发：Claude Code 或用户调用 kiro-cli（见 review-prompt.template.md）
3. 评审：kiro-cli 读 spec + 实现 → 写结论到本目录
4. 反馈：Claude Code 读结论文件 → 修订或进入任务 N+1
```

## 评审结论文件

- 命名：`<任务编号>-<日期>.md`，例如 `task2-2026-08-24.md`
- 格式：见下（与 review-prompt.template.md 一致）

```markdown
# 任务 <N> 评审 — <标题>

**状态**：approved | rejected | needs-changes

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
# 用户手动触发（把 <任务编号> 换掉）
kiro-cli chat "依据 .kiro/reviews/review-prompt.template.md 评审任务 <任务编号>"

# Claude Code 在任务边界触发（结论落文件后我会自动读）
# 见 review-prompt.template.md 的参数说明
```

## 约定

- 结论文件只在评审产生时写入/覆盖；历史结论保留（命名带日期）。
- `tasks.md` 是唯一任务状态源；评审结论不反向修改 spec。
- P1 阻断未清前不进入下一任务。
