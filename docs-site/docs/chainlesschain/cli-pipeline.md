# 开发流水线编排 CLI（Phase 26）

> `chainlesschain pipeline`（别名 `pipe`）— AI 开发流水线的 7 阶段全生命周期管理。
>
> 4 种模板 + 6 种部署策略 + 双门审批 + 制品管理 + 监控记录。

---

## 概述

Pipeline 模块编排 AI 辅助的开发流水线，覆盖从需求分析到生产监控的完整流程。
7 个阶段：需求 → 架构 → 编码 → 测试 → 审查 → 部署 → 监控。
内置 feature/bugfix/refactor/security-audit 四种模板。

---

## 目录/枚举

```bash
chainlesschain pipe config              # 查看配置常量
chainlesschain pipe templates           # 列出流水线模板
chainlesschain pipe stages              # 列出 7 个阶段
chainlesschain pipe deploy-strategies   # 列出部署策略（blue-green/canary/rolling 等）
chainlesschain pipe statuses            # 列出流水线状态
```

---

## 流水线生命周期

```bash
# 创建流水线（从模板）
chainlesschain pipe create --name "用户认证" --template feature

# 启动 / 暂停 / 恢复 / 取消 / 完成 / 失败 / 重试
chainlesschain pipe start <pipeline-id>
chainlesschain pipe pause <pipeline-id>
chainlesschain pipe resume <pipeline-id>
chainlesschain pipe cancel <pipeline-id>
chainlesschain pipe complete <pipeline-id>
chainlesschain pipe fail <pipeline-id> --reason "测试未通过"
chainlesschain pipe retry <pipeline-id>

# 查看 / 列出
chainlesschain pipe show <pipeline-id>
chainlesschain pipe list
chainlesschain pipe list --json
```

---

## 阶段管理 & 审批

```bash
# 推进到指定阶段
chainlesschain pipe stage <pipeline-id> testing

# 双门审批
chainlesschain pipe approve <pipeline-id> --gate code-review
chainlesschain pipe reject <pipeline-id> --gate code-review --reason "安全问题"
```

---

## 制品 & 部署

```bash
# 添加制品
chainlesschain pipe artifact-add <pipeline-id> --name "build.zip" --type binary --path ./dist/build.zip
chainlesschain pipe artifacts <pipeline-id>

# 部署
chainlesschain pipe deploy <pipeline-id> --strategy canary --target production
chainlesschain pipe deploys <pipeline-id>
chainlesschain pipe deploy-show <deploy-id>
chainlesschain pipe rollback <deploy-id>
```

---

## 监控 & 导出

```bash
# 记录监控事件
chainlesschain pipe monitor-record <pipeline-id> --metric error_rate --value 0.02
chainlesschain pipe monitor-events <pipeline-id>
chainlesschain pipe monitor-status <pipeline-id>

# 导出流水线数据
chainlesschain pipe export <pipeline-id> --format json
```

---

## 统计

```bash
chainlesschain pipe stats          # 流水线统计
chainlesschain pipe stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/26_开发流水线编排.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
