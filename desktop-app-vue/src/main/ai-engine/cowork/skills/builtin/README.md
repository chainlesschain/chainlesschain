# Builtin Skills

此目录包含应用内置的技能。内置技能具有最低优先级，可以被 managed（用户全局）或 workspace（项目级）技能覆盖。

## 目录结构

每个技能应该是一个独立的子目录，包含一个 `SKILL.md` 文件：

```
builtin/
├── README.md
├── example-skill/
│   ├── SKILL.md
│   └── handler.js  (可选)
└── another-skill/
    └── SKILL.md
```

## SKILL.md 格式

```markdown
---
name: example-skill
description: A brief description of the skill
display-name: Example Skill
version: 1.0.0
category: general
tags: [example, demo]

user-invocable: true
hidden: false

requires:
  bins: [node]
  env: [API_KEY]
os: [win32, darwin, linux]
enabled: true

handler: ./handler.js
capabilities: [example_task]
supported-file-types: [.txt, .md]
---

# Detailed Usage Instructions

Write detailed instructions here in Markdown format.
```

## 技能层级优先级

| 层级      | 目录                                | 优先级   |
| --------- | ----------------------------------- | -------- |
| bundled   | `skills/builtin/`                   | 0 (最低) |
| managed   | `~/.chainlesschain/skills/`         | 1        |
| workspace | `<project>/.chainlesschain/skills/` | 2 (最高) |

同名技能会被高优先级层级覆盖。
