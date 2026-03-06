# 自治运维系统

> **版本: v1.1.0+ | 异常检测 | 事件管理 | Playbook | 自动修复 | 回滚 | 部署后监控 | 事后分析 (15 IPC)**

自治运维系统提供从异常检测到自动修复的完整 AIOps 运维闭环，减少人工干预，提升系统可靠性。

## 系统概述

### 运维闭环

```
异常检测 → 事件分类 → 告警通知 → 自动修复 → 回滚（如需）→ 事后分析
   │           │          │          │           │            │
   ▼           ▼          ▼          ▼           ▼            ▼
Anomaly   Incident    Alert     Auto         Rollback    Postmortem
Detector  Classifier  Manager   Remediator   Manager     Generator
```

---

## 异常检测

### 检测算法

| 算法        | 原理             | 适用场景                      |
| ----------- | ---------------- | ----------------------------- |
| **Z-Score** | 高斯分布偏差     | 正态分布指标（响应时间、CPU） |
| **IQR**     | 四分位距         | 无分布假设的通用检测          |
| **EWMA**    | 指数加权移动平均 | 趋势变化检测                  |

### 严重级别

| 级别 | 说明 | 响应要求       |
| ---- | ---- | -------------- |
| P0   | 致命 | 立即响应       |
| P1   | 严重 | 15 分钟内响应  |
| P2   | 一般 | 1 小时内响应   |
| P3   | 警告 | 下个工作日处理 |

### 监控指标示例

```
error_rate        — 错误率
response_time_p99 — P99 响应时间
memory_usage      — 内存使用率
cpu_usage         — CPU 使用率
disk_usage        — 磁盘使用率
```

### 时间窗口

支持 `1m`, `5m`, `15m`, `30m`, `1h` 的滚动窗口配置。

---

## 事件管理

### 事件生命周期

```
open → acknowledged → remediating → remediated → resolved
                                                → escalated
```

### 自动分类

基于预定义规则自动判定事件严重级别：

```json
{
  "severityRules": {
    "error_rate": { "P0": 10, "P1": 5, "P2": 2, "P3": 1 },
    "response_time_p99": { "P0": 10000, "P1": 5000, "P2": 2000, "P3": 1000 },
    "memory_usage": { "P0": 95, "P1": 90, "P2": 80, "P3": 70 }
  }
}
```

### 去重与关联

- **去重**: 5 分钟窗口内相同指标的异常合并为同一事件
- **关联**: 关联历史同类型事件，提供上下文参考
- **自��升级**: 30 分钟未确认的事件自动升级严重级别

---

## 告警管理

### 告警通道

| 通道      | 说明                                |
| --------- | ----------------------------------- |
| `webhook` | HTTP Webhook 回调                   |
| `email`   | 邮件通知                            |
| `im`      | 即时通讯（Slack/钉钉）              |
| `in-app`  | 应用内通知（Electron Notification） |

### 升级链

```
P3 警告 → 5分钟后升级 → P2 一般
P2 一般 → 3分钟后升级 → P1 严重
P1 严重 → 1分钟后升级 → P0 致命
P0 致命 → 立即全通道通知
```

### 防抖策略

- 去重窗口: 60 秒（相同告警合并）
- 速率限制: 每分钟最多 30 条告警
- 告警保留: 30 天

---

## 自动修复

### Playbook ���擎

Playbook 定义了自动修复的条件和步骤：

```json
{
  "name": "high-memory-remediation",
  "conditions": {
    "severity": ["P0", "P1"],
    "metricType": "memory_usage"
  },
  "steps": [
    { "action": "clear-cache", "timeout": 10000 },
    { "action": "restart-service", "target": "ai-service", "timeout": 30000 },
    {
      "action": "notify",
      "channel": "im",
      "message": "内存过高，已自动重启服务"
    }
  ],
  "onFailure": "rollback"
}
```

### 修复动作类型

| 动作              | 说明           |
| ----------------- | -------------- |
| `restart-service` | 重启服务       |
| `clear-cache`     | 清理缓存       |
| `scale-down`      | 缩减资源       |
| `scale-up`        | 扩展资源       |
| `kill-process`    | 终止进程       |
| `reload-config`   | 重载配置       |
| `run-script`      | 执行自定义脚本 |
| `notify`          | 发送通知       |
| `rollback`        | 触发回滚       |

### 内置 Playbook

- `high-memory-remediation` — 高内存：清缓存 + 重启
- `high-cpu-remediation` — 高 CPU：降级 + 限流
- `error-spike-remediation` — 错误飙升：日志采集 + 重启 + 通知

---

## 回滚管理

### 回滚类型

| 类型              | 说明            |
| ----------------- | --------------- |
| `GIT_REVERT`      | Git 代码回滚    |
| `DOCKER_ROLLBACK` | Docker 镜像回退 |
| `CONFIG_RESTORE`  | 配置快照恢复    |
| `SERVICE_RESTART` | 服务重启        |
| `CUSTOM`          | 自定义回滚步骤  |

### 回滚流程

```
触发回滚
  │
  ├─ GIT_REVERT: isomorphic-git revert commit
  ├─ DOCKER_ROLLBACK: 切换到上一个镜像版本
  ├─ CONFIG_RESTORE: 从快照目录恢复配置
  └─ SERVICE_RESTART: 重启指定服务
  │
  ▼
记录回滚历史 (最多 100 条)
  │
  ▼
返回: { success, rollbackId, type, duration, details }
```

### 配置快照

```
快照目录: .chainlesschain/rollback-snapshots/
├─ snapshot-2026-01-15T10-00.json
├─ snapshot-2026-01-15T11-00.json
└─ ...
```

---

## 部署后监控

### 监控流程

```
部署完成 → 进入观测窗口 (默认 5 分钟)
              │
              ├─ 采集错误率、延迟、异常
              │
              ├─ 样本数 >= 10?
              │   ├─ 否 → 继续采集
              │   └─ 是 → 评估健康状态
              │
              ├─ 错误率 > 5%? → CRITICAL → 触发自动回滚
              ├─ 延迟 > 5000ms? → DEGRADED → 发出警告
              └─ 一切正常 → HEALTHY → 部署确认
```

### 状态

| 状态       | 说明               |
| ---------- | ------------------ |
| `IDLE`     | 空闲，无监控       |
| `WATCHING` | 观测中             |
| `HEALTHY`  | 健康，部署成功     |
| `DEGRADED` | 性能下降，需关注   |
| `CRITICAL` | 严重问题，触发回滚 |

---

## 事后分析

### Postmortem 报告

系统在事件解决后自动生成事后分析报告：

```markdown
## 事件摘要

- 事件 ID: INC-2026-0115-001
- 严重级别: P1
- 持续时间: 23 分钟

## 时间线

- 10:00 异常检测触发
- 10:02 事件创建，告警发送
- 10:05 自动修复启动
- 10:15 修复失败，回滚触发
- 10:20 回滚完成，服务恢复
- 10:23 事件关闭

## 根因分析

（由 LLM 分析生成）

## 改进建议

1. ...
2. ...
```

### 报告内容

- 事件摘要和时间线
- 根因分析（LLM 辅助）
- 影响范围评估
- 修复/回滚过程记录
- 经验教训
- 后续行动项

---

## 关键文件

| 文件                                                | 职责                         |
| --------------------------------------------------- | ---------------------------- |
| `src/main/ai-engine/cowork/anomaly-detector.js`     | 异常检测（Z-Score/IQR/EWMA） |
| `src/main/ai-engine/cowork/incident-classifier.js`  | 事件分类与生命周期           |
| `src/main/ai-engine/cowork/alert-manager.js`        | 多通道告警管理               |
| `src/main/ai-engine/cowork/auto-remediator.js`      | Playbook 自动修复            |
| `src/main/ai-engine/cowork/rollback-manager.js`     | 回滚管理器                   |
| `src/main/ai-engine/cowork/post-deploy-monitor.js`  | 部署后监控                   |
| `src/main/ai-engine/cowork/postmortem-generator.js` | 事后分析报告生成             |
| `src/main/ai-engine/cowork/evolution-ipc.js`        | IPC 处理器                   |
