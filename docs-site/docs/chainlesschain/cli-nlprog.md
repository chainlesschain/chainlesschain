# 自然语言编程 CLI（Phase 28）

> `chainlesschain nlprog` — 自然语言→结构化规格的翻译与管理。
>
> 涵盖意图分类、实体提取、技术栈检测、翻译 CRUD、项目约定管理。

---

## 目录

- [概述](#概述)
- [目录/枚举](#目录枚举)
- [分析（无状态）](#分析无状态)
- [翻译管理](#翻译管理)
- [项目约定](#项目约定)
- [统计](#统计)

---

## 概述

NL Programming 模块将自然语言描述转为结构化规格（intent / entities / stack），
辅以项目级代码约定（convention），帮助 Agent 生成符合项目风格的代码。

---

## 目录/枚举

```bash
chainlesschain nlprog intents            # 列出支持的意图类型
chainlesschain nlprog statuses           # 列出翻译状态
chainlesschain nlprog style-categories   # 列出风格分析类别
```

---

## 分析（无状态）

```bash
# 意图分类 — 判断用户输入属于哪种编程意图
chainlesschain nlprog classify "帮我写一个排序函数"

# 实体提取 — 从文本中抽取编程实体（函数名、参数、类型等）
chainlesschain nlprog extract "创建一个接收 name 参数返回 greeting 的函数"

# 技术栈检测 — 从文本描述推断使用的技术栈
chainlesschain nlprog detect-stack "用 React + TypeScript 写一个 Todo 组件"
```

以上命令均为无状态纯计算，不写数据库。

---

## 翻译管理

```bash
# 将自然语言翻译为结构化规格
chainlesschain nlprog translate "实现用户登录功能，包含邮箱密码验证"

# 查看翻译详情
chainlesschain nlprog show <id>

# 列出所有翻译
chainlesschain nlprog list
chainlesschain nlprog list --json

# 更新翻译状态（draft / reviewing / approved / rejected）
chainlesschain nlprog status <id> approved

# 基于更新后的描述重新翻译
chainlesschain nlprog refine <id> --spec "增加验证码功能"

# 删除翻译
chainlesschain nlprog remove <id>
```

---

## 项目约定

```bash
# 添加项目编码约定
chainlesschain nlprog convention-add "变量命名使用 camelCase" --category naming

# 查看约定详情
chainlesschain nlprog convention-show <id>

# 列出所有约定
chainlesschain nlprog conventions

# 删除约定
chainlesschain nlprog convention-remove <id>
```

约定会影响后续 `translate` 输出的规格内容，使生成结果贴合项目风格。

---

## 统计

```bash
chainlesschain nlprog stats          # 可读格式
chainlesschain nlprog stats --json   # JSON 格式
```

---

## 相关文档

- 设计文档：`docs/design/modules/28_自然语言编程.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
