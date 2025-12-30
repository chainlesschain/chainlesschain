---
id: skill_architecture_design
name: 建筑设计
category: media
enabled: true
---

# Architecture Design

## 📝 概述

BIM建模、结构分析、能耗计算、日照分析

**分类**: 媒体处理
**标签**: 建筑, BIM, 结构分析, 能耗
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "standard": "gb",
  "accuracy": "high"
}
```

**配置说明**:

- `standard`: string 类型，当前值: "gb"
- `accuracy`: string 类型，当前值: "high"

## 📖 使用示例

### 示例1: 使用 建筑设计

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "media" }  // 指定使用的技能
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
