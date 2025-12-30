---
id: skill_calendar_schedule
name: 日程管理
category: productivity
enabled: true
---

# Calendar & Schedule

## 📝 概述

日历管理、事件提醒、待办事项、日程安排

**分类**: productivity
**标签**: 日历, 日程, 提醒, 待办
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "default_view": "month",
  "reminder_minutes": 15
}
```

**配置说明**:

- `default_view`: string 类型，当前值: "month"
- `reminder_minutes`: number 类型，当前值: 15

## 📖 使用示例

### 示例1: 使用 日程管理

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "productivity" }  // 指定使用的技能
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
