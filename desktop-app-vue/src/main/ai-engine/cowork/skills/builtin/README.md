# Builtin Skills

此目录包含应用内置的技能。内置技能具有最低优先级，可以被 marketplace、managed（用户全局）或 workspace（项目级）技能覆盖。

## 当前内置技能 (15)

| 技能                  | 类别        | Handler | 说明                                     |
| --------------------- | ----------- | ------- | ---------------------------------------- |
| code-review           | development | -       | 代码审查                                 |
| git-commit            | development | -       | Git 提交                                 |
| explain-code          | learning    | -       | 代码讲解                                 |
| browser-automation    | automation  | ✅      | 浏览器自动化（导航、点击、填表、截图）   |
| computer-use          | automation  | ✅      | 桌面操作控制（截图、鼠标键盘、视觉定位） |
| workflow-automation   | automation  | ✅      | 工作流自动化（条件分支、循环、并行）     |
| web-scraping          | data        | ✅      | 网页数据采集（表格、链接、文本提取）     |
| data-analysis         | data        | -       | 数据分析（CSV/JSON处理、统计）           |
| memory-management     | knowledge   | ✅      | 永久记忆管理（保存、搜索、日记）         |
| smart-search          | knowledge   | ✅      | 智能搜索（向量+BM25混合搜索）            |
| remote-control        | remote      | ✅      | 远程设备控制（命令、文件、剪贴板）       |
| security-audit        | security    | -       | 代码安全审计（OWASP、密钥检测）          |
| devops-automation     | devops      | -       | DevOps自动化（CI/CD、Docker）            |
| test-generator        | development | -       | 测试生成（单元测试、Mock、覆盖率）       |
| performance-optimizer | development | -       | 性能优化（瓶颈识别、优化建议）           |

## 目录结构

每个技能是一个独立的子目录，包含 `SKILL.md` 文件和可选的 `handler.js`：

```
builtin/
├── README.md
├── code-review/
│   └── SKILL.md
├── browser-automation/
│   ├── SKILL.md
│   └── handler.js
└── ...
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
