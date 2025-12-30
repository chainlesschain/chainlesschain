---
id: skill_text_processing
name: 文本处理
category: text
enabled: true
---

# Text Processing

## 📝 概述

文本分析、正则匹配、格式转换等高级文本操作

**分类**: text
**标签**: 文本, 分析, 正则
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "encoding": "utf8",
  "lineEnding": "auto"
}
```

**配置说明**:

- `encoding`: string 类型，当前值: "utf8"
- `lineEnding`: string 类型，当前值: "auto"

## 📖 使用示例

### 示例1: 使用 文本处理

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "text" }  // 指定使用的技能
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
