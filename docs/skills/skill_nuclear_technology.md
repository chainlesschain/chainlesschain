---
id: skill_nuclear_technology
name: 核能技术
category: system
enabled: true
---

# Nuclear Technology

## 📝 概述

反应堆模拟、辐射监测、核燃料管理、核安全评估

**分类**: 系统操作
**标签**: 核能, 反应堆, 辐射, 安全
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "reactor_type": "PWR",
  "safety_level": "high"
}
```

**配置说明**:

- `reactor_type`: string 类型，当前值: "PWR"
- `safety_level`: string 类型，当前值: "high"

## 📖 使用示例

### 示例1: 使用 核能技术

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "system" }  // 指定使用的技能
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
