# 工作流自动化引擎 CLI（Phase 96）

> `chainlesschain automation`（别名 `auto`）— SaaS 连接器 + 触发器 + DAG 工作流编排。
>
> 12 个 SaaS 连接器 + 5 种触发器类型 + DAG 拓扑排序 + 条件分支执行。

---

## 概述

Automation Engine 是面向非开发者的工作流自动化平台（区别于 `workflow` 的开发流水线）。
内置 12 个 SaaS 连接器（Gmail/Slack/GitHub/Jira/Notion/Trello/Discord/Teams/
Airtable/Figma/Linear/Confluence），支持 webhook/schedule/email/form/manual 五种触发方式。

---

## 连接器与触发器目录

```bash
chainlesschain auto connectors      # 列出 12 个 SaaS 连接器
chainlesschain auto trigger-types   # 列出触发器类型
chainlesschain auto statuses        # 列出工作流状态
chainlesschain auto config          # 查看配置常量
```

---

## 工作流 CRUD

```bash
# 创建工作流
chainlesschain auto create --name "新 Issue 通知" --description "GitHub issue → Slack"

# 列出工作流
chainlesschain auto flows
chainlesschain auto flows --json

# 查看详情
chainlesschain auto show <flow-id>

# 生命周期管理
chainlesschain auto activate <flow-id>    # 激活
chainlesschain auto pause <flow-id>       # 暂停
chainlesschain auto archive <flow-id>     # 归档
chainlesschain auto delete <flow-id>      # 删除

# 定时调度
chainlesschain auto schedule <flow-id> --cron "0 9 * * 1-5"

# 分享与模板
chainlesschain auto share <flow-id> --public
chainlesschain auto templates                           # 列出模板
chainlesschain auto import-template <template-id>       # 导入模板
```

---

## 触发器管理

```bash
chainlesschain auto add-trigger <flow-id> --type webhook --config '{"url":"..."}'
chainlesschain auto triggers <flow-id>
chainlesschain auto enable-trigger <trigger-id>
chainlesschain auto disable-trigger <trigger-id>
chainlesschain auto fire-trigger <trigger-id> --payload '{"key":"value"}'
```

---

## 执行与日志

```bash
# 手动执行工作流
chainlesschain auto execute <flow-id> --input '{"data":"test"}'

# 查看执行详情
chainlesschain auto exec-show <execution-id>

# 执行日志
chainlesschain auto logs <flow-id>
chainlesschain auto logs <flow-id> --limit 50 --json
```

---

## 统计

```bash
chainlesschain auto stats          # 自动化引擎统计
chainlesschain auto stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/61_工作流自动化引擎.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
