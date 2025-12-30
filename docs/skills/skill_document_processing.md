---
id: skill_document_processing
name: 文档处理
category: document
enabled: true
---

# Document Processing

## 📝 概述

Word/PDF/Excel/PPT生成和编辑

**分类**: 文档处理
**标签**: 文档, Office, PDF
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "defaultFormat": "docx"
}
```

**配置说明**:

- `defaultFormat`: 默认文件格式

## 📖 使用示例

### 示例1: 使用 文档处理

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "document" }  // 指定使用的技能
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

**文档生成时间**: 2025/12/30 17:19:39
**技能类型**: 内置
