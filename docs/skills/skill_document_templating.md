---
id: skill_document_templating
name: 文档模板生成
category: document
enabled: true
---

# Document Templating

## 📝 概述

支持 Mustache、Handlebars、EJS 等模板引擎

**分类**: 文档处理
**标签**: 模板, 文档, 生成, 渲染
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "defaultEngine": "mustache",
  "escapeHtml": true
}
```

**配置说明**:

- `defaultEngine`: string 类型，当前值: "mustache"
- `escapeHtml`: boolean 类型，当前值: true

## 📖 使用示例

### 示例1: 使用 文档模板生成

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

**文档生成时间**: 2025/12/30 17:19:40
**技能类型**: 内置
