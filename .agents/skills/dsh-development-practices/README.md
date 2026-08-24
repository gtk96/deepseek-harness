# dsh-development-practices

> 从 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提炼、可搬到任何仓库的工程纪律。

不是一套"从零搭项目"的工作流，而是**叠加在你已有流程上的 7 步检查法**：先搞清事实 → 定好边界 → 记好长期决定 → 带着证据做 → 按表面拿证据 → 审查 → 如实收尾。

---

## 它解决什么问题

很多团队的 AI 辅助开发流程能把代码写出来，却留不下"为什么这样做"、也说不清"到底验了什么"。Harness 两个月从 0 到 1 靠的不是写得快，而是四件事做得稳：**事实先摸清、决定有地方查、证据按表面拿、收尾不撒谎**。本仓库把这四件事抽成一个可移植的 Skill，任何项目 `npx` 一下就能用上。

## 什么是"非平凡改动"

命中以下任一，就按本 Skill 走一遍；都不命中，标 `not applicable` 走常规检查即可。不确定时，按非平凡处理。

| 算非平凡（要走 Skill） | 不算（直接过） |
| --- | --- |
| 改了运行时行为、UI/CLI 表现 | 只改格式、空格、导入顺序 |
| 改了架构、模块边界、跨文件契约 | 无歧义重命名、错别字 |
| 改了流程、门禁、测试策略 | 注释里加一句说明 |
| 改了落盘/网络/配置格式、持久化结构 | 文档里改个标点 |
| 改了以后会有人回头审视的决定 | 其他一眼能看出无风险的局部改动 |

一句话判断：**"半年后有人回来看，会想知道为什么这样改吗？"** 会，就值得留一条 Note。

## 包含什么

```
.
├── SKILL.md                          # 主流程（~130 行）——每次必读
└── references/                       # 按需加载，不必每次全读
    ├── defensive-checklist.md        # 定边界与实现时的防御自检
    ├── evidence-by-surface.md        # 按表面拿证据对照表
    ├── review-checklist.md           # 审查必拦项与人工必查
    ├── prose-checklist.md            # 文档与注释自检
    └── simplification-checklist.md   # 简化机会自检
```

主流程保持精简，细节只在命中相关变更时再读——和 [Agent Skills](https://agentskills.io) 的"按需加载"理念一致。

## 安装

### 方式一：npx 一键安装（推荐）

```bash
npx skills add czm15053/dsh-development-practices
```

使用 [skills.sh](https://skills.sh) 提供的 `npx skills` 工具，实测已覆盖 Codex / Claude Code / Cursor 等主流 Agent。默认安装到项目内的 `.agents/skills/dsh-development-practices` 并生成 `skills-lock.json` 锁定版本。

```bash
npx skills list          # 验证是否安装成功
npx skills add czm15053/dsh-development-practices -g   # 改为全局安装
```

### 方式二：本地复制 / 软链

```bash
# 复制
cp -r /path/to/dsh-development-practices /path/to/your-project/.agents/skills/

# 软链（便于跟随上游更新）
ln -s /path/to/dsh-development-practices /path/to/your-project/.agents/skills/dsh-development-practices

# Claude Code 项目
cp -r /path/to/dsh-development-practices /path/to/your-project/.claude/skills/
```

校验：`SKILL.md` 头部 `name: dsh-development-practices` 且 `description` 非空即为可发现。

## 快速开始

```bash
# 1. 安装
npx skills add czm15053/dsh-development-practices

# 2. 让 Agent 执行（或手动按 SKILL.md 逐节对照）
#    命中非平凡改动时，Agent 会自动按 §0–§6 走一遍
```

最小闭环只需要一条 Note：

```
.agents/notes/implemented/feature/2026-08-20-xxx.md
# Agent Note: xxx
Status: implemented
## Problem / Decision / Alternatives considered / Consequences
```

完整格式与生命周期见 `SKILL.md §3`。

## 怎么用

命中非平凡改动时，让 Agent 执行本 Skill（或手动逐节对照）：

1. **先探测再落地** — 有 `AGENTS.md`/`CLAUDE.md` 就读它，有 `docs/adr/` 等决策记录就沿用语义；没有再建最小 Note 树（轻量项目只建 `.agents/notes/implemented/<class>/`）。
2. **动手前摸清事实** — 入口、消费方、可观察表面、已有决定。
3. **先分类再定边界** — 决定要留什么证据；默认值、配置、边界校验、生命周期成对等按清单收敛。
4. **长期决定留痕** — 每个非平凡改动在同一提交/PR 内新增或更新至少一条 Note，含必写的 `Alternatives considered`。
5. **带着证据做** — 在真实消费入口上验，不用 normalizer 盖失败。
6. **按表面拿证据** — 源码与产物分开验，只挑相关表面做最小够用集；数据与元数据一起裁、一条证据链。
7. **审查与如实收尾** — 报告分开写：实际跑了什么 / 刻意没跑什么 / 已验证行为 / 剩余风险。

需求有分歧时，先把每个分支问清楚再写代码；追问本身不产代码。

## 轻量 / 完整双模式

| 模式 | 适合 | Note 目录 | 门禁 |
| --- | --- | --- | --- |
| **轻量** | 个人项目、一次性验证 | 只建 `implemented/<class>/`，`proposed` 需评审时再建 | 可后补 |
| **完整** | 团队长期仓库 | 建全套 `proposed/implemented/rejected/archived × 6 class` | 可接入校验脚本 |

空目录可随手删掉，用到再建——这正是为了解决"一上来一堆空文件夹"的噪音。

## 参考

- 来源：`deepseek-ai/deepseek-harness` 的 `AGENTS.md`、`docs/defensive-patterns.md`、`docs/testing.md`、`.agents/notes` 树与 `.agents/skills` 实践
- 通用 Skill 规范：[Agent Skills](https://agentskills.io) / [Claude Code Skills](https://code.claude.com/docs/en/skills)

## 友链

- [LinuxDo](https://linux.do) — 真诚、友善、团结、专业的新生代 AI 社区

## 许可

与来源仓库保持一致，见来源仓库的 `LICENSE`。
