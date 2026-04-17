# 智能插件生态 2.0 CLI（Phase 64）

> `chainlesschain ecosystem`（别名 `eco`）— 插件注册、依赖解析、AI 审查、沙箱测试、发布与收益分成。
>
> DFS 依赖解析 + 8 规则启发式 AI 审查 + 70/30 收益分成 + 分类亲和推荐。

---

## 概述

Plugin Ecosystem 2.0 管理插件从注册到发布的完整生命周期。
区别于 `plugin`（基础插件安装），`ecosystem` 提供企业级的依赖解析、
安全审查、沙箱隔离测试、审核发布流程与收益分成机制。

---

## 目录/枚举

```bash
chainlesschain eco config         # 查看配置常量
chainlesschain eco severities     # 列出审查严重级别
chainlesschain eco statuses       # 列出插件状态
chainlesschain eco revenue-types  # 列出收益类型
chainlesschain eco dep-kinds      # 列出依赖类型
chainlesschain eco rules          # 列出 8 条 AI 审查规则
```

---

## 插件注册与查询

```bash
# 注册插件
chainlesschain eco register --name my-plugin --version 1.0.0 --category ai

# 列出插件
chainlesschain eco plugins
chainlesschain eco plugins --json

# 查看详情
chainlesschain eco show <plugin-id>

# 更新统计信息
chainlesschain eco update-stats <plugin-id>
```

---

## 依赖管理

```bash
# 添加依赖
chainlesschain eco dep-add <plugin-id> --dep <dep-plugin-id> --kind runtime

# 列出依赖
chainlesschain eco deps <plugin-id>

# DFS 依赖解析（检测循环与冲突）
chainlesschain eco resolve <plugin-id>

# 安装（含自动依赖解析，失败自动回滚）
chainlesschain eco install <plugin-id>
chainlesschain eco installs                  # 列出安装记录
chainlesschain eco uninstall <plugin-id>
```

---

## AI 审查 & 沙箱

```bash
# 8 规则启发式 AI 代码审查
chainlesschain eco review <plugin-id> --source ./src/index.js
chainlesschain eco review-show <review-id>
chainlesschain eco reviews <plugin-id>

# 沙箱隔离测试
chainlesschain eco sandbox <plugin-id>
chainlesschain eco sandbox-show <sandbox-id>
chainlesschain eco sandbox-tests <sandbox-id>
```

---

## 审核与发布

```bash
# 提交审核
chainlesschain eco submit <plugin-id>

# 审核（管理员）
chainlesschain eco approve <plugin-id>
chainlesschain eco reject <plugin-id> --reason "安全问题"

# 发布
chainlesschain eco publish <plugin-id>
```

---

## 收益分成 & 推荐

```bash
# 记录收益
chainlesschain eco rev-record <plugin-id> --amount 100 --type subscription

# 查看收益报告（70% 开发者 / 30% 平台）
chainlesschain eco revenue <plugin-id>

# 基于分类亲和度的推荐
chainlesschain eco recommend --category ai --limit 5
```

---

## 统计

```bash
chainlesschain eco stats          # 插件生态统计
chainlesschain eco stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/64_智能插件生态2.0.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
