---
id: skill_task_scheduling
name: 任务调度
category: automation
enabled: true
---

# Task Scheduling

## 📝 概述

Cron任务调度、定时任务、周期性执行

**分类**: 自动化
**标签**: 调度, 定时任务, Cron, 自动化
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "timezone": "Asia/Shanghai",
  "maxConcurrent": 10
}
```

**配置说明**:

- `timezone`: string 类型，当前值: "Asia/Shanghai"
- `maxConcurrent`: number 类型，当前值: 10

## 📖 使用示例

### 示例1: 使用 任务调度

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "automation" }  // 指定使用的技能
);
```

### 示例2: 通过IPC调用

```javascript
// 在渲染进程中
const tools = await window.electronAPI.invoke('skill:get-tools', skillId);
console.log('技能包含的工具:', tools);
```

## 🔗 相关技能

暂无相关技能
---

**文档生成时间**: 2025/12/30 17:19:40
**技能类型**: 内置
