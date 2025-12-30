---
id: skill_controlled_fusion
name: 可控核聚变
category: energy
enabled: true
---

# Controlled Nuclear Fusion

## 📝 概述

托卡马克模拟、磁约束聚变、惯性约束聚变、等离子体控制

**分类**: energy
**标签**: 核聚变, 托卡马克, 等离子体, ITER
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "device": "tokamak",
  "confinement": "magnetic"
}
```

**配置说明**:

- `device`: string 类型，当前值: "tokamak"
- `confinement`: string 类型，当前值: "magnetic"

## 📖 使用示例

### 示例1: 使用 可控核聚变

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "energy" }  // 指定使用的技能
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
