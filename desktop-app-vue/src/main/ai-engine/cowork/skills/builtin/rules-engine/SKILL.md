---
name: rules-engine
display-name: Rules Engine
description: 模块化规则引擎 - 管理项目编码规范、AI行为规则、架构约束，支持glob范围和团队共享
version: 1.0.0
category: knowledge
user-invocable: true
tags: [rules, conventions, standards, coding-style, constraints, team]
capabilities: [rule-loading, glob-matching, rule-validation, team-sharing]
tools:
  - file_reader
  - file_writer
handler: ./handler.js
instructions: |
  Use this skill when the user needs to manage coding rules, project conventions,
  or architectural constraints. Rules are stored as Markdown files with YAML
  frontmatter in `.chainlesschain/rules/`. Each rule can specify glob patterns
  to scope enforcement to specific files/directories. Supports listing, checking
  applicability, initialization, adding new rules, and validation.
examples:
  - input: "/rules-engine --list"
    output: "Table listing all rules with name, description, severity, and glob patterns"
  - input: "/rules-engine --check src/main/database.js"
    output: "All rules whose glob patterns match the given file, aggregated by severity"
  - input: "/rules-engine --init"
    output: "Creates .chainlesschain/rules/ directory with a sample rule file"
  - input: "/rules-engine --add no-console-log"
    output: "Creates a new rule template file named no-console-log.md"
  - input: "/rules-engine --validate"
    output: "Validates all rule files for syntax correctness and reports errors"
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [--list, --check, --init, --add, --validate]
      description: Operation mode
    target:
      type: string
      description: File path for --check mode, or rule name for --add mode
output-schema:
  type: object
  properties:
    rules:
      type: array
      items:
        type: object
        properties:
          name: { type: string }
          description: { type: string }
          globs: { type: array, items: { type: string } }
          severity: { type: string, enum: [error, warning, info] }
          content: { type: string }
    matchedCount: { type: integer }
model-hints:
  context-priority: high
  token-budget: 2000
cost: free
os: [win32, darwin, linux]
author: ChainlessChain
license: MIT
---

# 规则引擎技能

## 描述

模块化规则引擎，用于管理项目编码规范、AI行为规则和架构约束。规则以Markdown文件形式存储在 `.chainlesschain/rules/` 目录中，每条规则通过YAML frontmatter定义名称、描述、glob匹配模式和严重级别。支持glob范围匹配，便于团队共享和版本控制。

## 使用方法

```
/rules-engine <mode> [target]
```

## 模式

| 模式         | 说明                                         |
| ------------ | -------------------------------------------- |
| `--list`     | 列出所有规则，显示名称、描述、严重级别和glob |
| `--check`    | 检查哪些规则适用于指定文件                   |
| `--init`     | 创建规则目录并生成示例规则文件               |
| `--add`      | 创建新的规则模板文件                         |
| `--validate` | 验证所有规则文件的语法正确性                 |

## 规则文件格式

规则文件使用Markdown + YAML frontmatter格式：

```markdown
---
name: no-console-log
description: 禁止在生产代码中使用console.log
globs: ["src/**/*.js", "src/**/*.ts"]
severity: warning
tags: [quality, production]
---

## 规则内容

不要在生产代码中使用 `console.log()`，应使用项目的统一日志工具 `logger`。

### 正确用法

\`\`\`js
const { logger } = require("../utils/logger.js");
logger.info("message");
\`\`\`

### 错误用法

\`\`\`js
console.log("debug message"); // ❌
\`\`\`
```

## 示例

列出所有规则：

```
/rules-engine --list
```

检查某文件适用的规则：

```
/rules-engine --check src/main/database.js
```

初始化规则目录：

```
/rules-engine --init
```

添加新规则：

```
/rules-engine --add no-any-type
```

验证所有规则：

```
/rules-engine --validate
```
