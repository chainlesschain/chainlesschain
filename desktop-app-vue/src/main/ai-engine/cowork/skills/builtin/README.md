# Builtin Skills

此目录包含应用内置的技能。内置技能具有最低优先级，可以被 marketplace、managed（用户全局）或 workspace（项目级）技能覆盖。

## 当前内置技能 (40)

### 原有技能 (15)

| 技能                  | 类别        | Handler | 说明                                      |
| --------------------- | ----------- | ------- | ----------------------------------------- |
| code-review           | development | ✅      | 代码审查（多文件扫描、评分、建议）        |
| git-commit            | development | ✅      | Git 提交（diff分析、conventional commit） |
| explain-code          | learning    | ✅      | 代码讲解（函数提取、复杂度、依赖分析）    |
| browser-automation    | automation  | ✅      | 浏览器自动化（导航、点击、填表、截图）    |
| computer-use          | automation  | ✅      | 桌面操作控制（截图、鼠标键盘、视觉定位）  |
| workflow-automation   | automation  | ✅      | 工作流自动化（条件分支、循环、并行）      |
| web-scraping          | data        | ✅      | 网页数据采集（表格、链接、文本提取）      |
| data-analysis         | data        | ✅      | 数据分析（CSV/JSON处理、统计）            |
| memory-management     | knowledge   | ✅      | 永久记忆管理（保存、搜索、日记）          |
| smart-search          | knowledge   | ✅      | 智能搜索（向量+BM25混合搜索）             |
| remote-control        | remote      | ✅      | 远程设备控制（命令、文件、剪贴板）        |
| security-audit        | security    | ✅      | 代码安全审计（OWASP、密钥检测）           |
| devops-automation     | devops      | ✅      | DevOps自动化（CI/CD、Docker）             |
| test-generator        | development | ✅      | 测试生成（单元测试、Mock、覆盖率）        |
| performance-optimizer | development | ✅      | 性能优化（瓶颈识别、优化建议）            |

### 新增技能 v0.36.0 (15)

| 技能                  | 类别          | Handler | 说明                                      |
| --------------------- | ------------- | ------- | ----------------------------------------- |
| repo-map              | development   | ✅      | 代码库结构映射（AST符号索引、全局感知）   |
| refactor              | development   | ✅      | 多文件代码重构（重命名、提取、移动）      |
| doc-generator         | documentation | ✅      | 文档自动生成（JSDoc、API参考、序列图）    |
| api-tester            | testing       | ✅      | IPC/API测试（发现、生成、健康检查）       |
| onboard-project       | development   | ✅      | 项目入门分析（架构理解、快速上手指南）    |
| lint-and-fix          | development   | ✅      | Lint自动修复循环（ESLint→修复→重复）      |
| test-and-fix          | testing       | ✅      | 测试自动修复循环（运行→分析→修复→重复）   |
| dependency-analyzer   | analysis      | ✅      | 依赖分析（导入图、影响分析、CVE可达性）   |
| db-migration          | database      | ✅      | 数据库迁移（Schema检查、迁移脚本、漂移）  |
| project-scaffold      | development   | ✅      | 项目脚手架（模块/页面/技能的样板生成）    |
| env-doctor            | devops        | ✅      | 环境诊断（运行时、端口、服务健康检查）    |
| context-loader        | knowledge     | ✅      | 智能上下文预加载（意图分析、相关文件）    |
| vulnerability-scanner | security      | ✅      | 依赖漏洞扫描（CVE、可达性、SBOM、许可证） |
| release-manager       | devops        | ✅      | 发布管理（版本计算、Changelog、Tag）      |
| mcp-server-generator  | development   | ✅      | MCP服务器生成（从描述生成完整MCP服务器）  |

### 高级技能 v0.36.1 (10)

| 技能               | 类别        | Handler | 说明                                            |
| ------------------ | ----------- | ------- | ----------------------------------------------- |
| architect-mode     | development | ✅      | 架构模式（规划→审查→执行两阶段架构设计）        |
| bugbot             | testing     | ✅      | Bug扫描（16种模式、4级严重度、scan/diff/watch） |
| commit-splitter    | development | ✅      | 提交拆分（语义分组Git变更为原子提交）           |
| diff-previewer     | development | ✅      | Diff预览（Git差异解析、分支对比、变更统计）     |
| fault-localizer    | testing     | ✅      | 故障定位（堆栈解析、git blame交叉、修复建议）   |
| rules-engine       | development | ✅      | 规则引擎（加载/验证/应用项目编码规则）          |
| impact-analyzer    | analysis    | ✅      | 影响分析（导入图BFS、爆炸半径、测试映射）       |
| research-agent     | knowledge   | ✅      | 研究代理（库对比、错误解决、依赖评估）          |
| screenshot-to-code | development | ✅      | 截图转代码（图像分析→Vue/React/HTML生成）       |
| task-decomposer    | development | ✅      | 任务分解（复杂任务→子任务DAG、依赖分析）        |

## 目录结构

每个技能是一个独立的子目录，包含 `SKILL.md` 文件和 `handler.js`（100% Handler 覆盖率）：

```
builtin/
├── README.md
├── code-review/
│   ├── SKILL.md
│   └── handler.js
├── browser-automation/
│   ├── SKILL.md
│   └── handler.js
└── ...（共40个技能目录）
```

## SKILL.md 格式 (Agent Skills Open Standard)

```markdown
---
name: example-skill
display-name: Example Skill
description: A brief description of the skill
version: 1.0.0
category: general
user-invocable: true
tags: [example, demo]
capabilities: [example_task]
tools:
  - tool_name_1
  - tool_name_2
instructions: |
  Detailed instructions for AI on when and how to use this skill.
examples:
  - input: "/example-skill arg1"
    output: "Expected result description"
dependencies: [other-skill]
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.txt, .md]
---

# Detailed Usage Instructions

Write detailed instructions here in Markdown format.
```

## 技能层级优先级

| 层级        | 目录                                | 优先级   |
| ----------- | ----------------------------------- | -------- |
| bundled     | `skills/builtin/`                   | 0 (最低) |
| marketplace | marketplace 安装的技能              | 1        |
| managed     | `~/.chainlesschain/skills/`         | 2        |
| workspace   | `<project>/.chainlesschain/skills/` | 3 (最高) |

同名技能会被高优先级层级覆盖。

## Handler 契约

```javascript
module.exports = {
  async init(skill) {
    // 初始化（可选），skill 为 MarkdownSkill 实例
  },
  async execute(task, context, skill) {
    // 执行技能逻辑
    // task: { action, params, ... }
    // context: 执行上下文
    // skill: MarkdownSkill 实例
    return { success: true, result: ... };
  }
};
```
