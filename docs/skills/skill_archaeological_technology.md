---
id: skill_archaeological_technology
name: 考古科技
category: science
enabled: true
---

# Archaeological Technology

## 📝 概述

碳14测年、3D重建、文物保护、遗址勘探

**分类**: science
**标签**: 考古, 碳14, 3D重建, 文物
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "method": "radiocarbon",
  "calibration": "IntCal20"
}
```

**配置说明**:

- `method`: string 类型，当前值: "radiocarbon"
- `calibration`: string 类型，当前值: "IntCal20"

## 📖 使用示例

### 示例1: 使用 考古科技

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "science" }  // 指定使用的技能
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
