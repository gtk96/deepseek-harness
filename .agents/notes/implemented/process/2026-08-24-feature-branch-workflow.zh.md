# Agent Note: 基于功能分支的贡献工作流

Status: implemented

[English](2026-08-24-feature-branch-workflow.md) | 中文

## 问题

贡献约定描述了 PR 历史与标签，却从未说明工作应从哪里开始。整套功能的探索性实现未提交地堆积在 master 工作区，后续改动也一直落在 master，直到事后才把工作区挪到功能分支。AGENTS.md 的词数预算也没有给这条规范留出明文空间。

## 决策

AGENTS.md 的 Conventions 写入规则：**只开功能分支，绝不直接提交到 master**。非平凡工作在功能分支（此处为 `feat/controlled-data-query-mvp`）上开始；master 保持干净，只通过评审后的合入推进。规则以预算允许的最少措辞陈述。

## 替代方案

- **上调 AGENTS.md 词数上限。** 否决：上限的存在就是为了让文件保持精简，相邻内容压缩后本规范即可容纳。
- **只把规范记在 note 里，不进 AGENTS.md。** 否决：贡献者决定在哪工作，读的是 AGENTS.md 而非 note。
- **保持不写。** 否决：触发本次对话的 master 工作区，正是这条规范要防止的失败。

## 后果

贡献者与 Agent 现在有明确指示：非平凡工作前先开功能分支。既有的探索性实现已随工作区完整迁到 `feat/controlled-data-query-mvp`。master 不再是隐式的工作面。
