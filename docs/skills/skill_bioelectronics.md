---
id: skill_bioelectronics
name: 生物电子学
category: hardware
enabled: true
---

# Bioelectronics

## 📝 概述

有机电子、柔性传感器、生物芯片、可穿戴设备

**分类**: hardware
**标签**: 生物电子, 柔性, 传感器, 可穿戴
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "material": "organic",
  "flexibility": "high"
}
```

**配置说明**:

- `material`: string 类型，当前值: "organic"
- `flexibility`: string 类型，当前值: "high"

## 📖 使用示例

### 示例1: 使用 生物电子学

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "hardware" }  // 指定使用的技能
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
