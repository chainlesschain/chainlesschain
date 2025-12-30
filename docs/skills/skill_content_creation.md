---
id: skill_content_creation
name: 内容创作
category: content
enabled: true
---

# Content Creation

## 📝 概述

写文章、文档编辑、Markdown处理

**分类**: 内容创作
**标签**: 写作, Markdown, 文档
**状态**: ✅ 已启用

## 💡 使用场景

1. 编写文章和博客
2. Markdown文档编辑
3. 内容格式化和排版
4. 文档模板应用
## ⚙️ 配置选项

```json
{
  "defaultFormat": "markdown"
}
```

**配置说明**:

- `defaultFormat`: 默认文件格式

## 📖 使用示例

### 示例1: 使用 内容创作

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "content" }  // 指定使用的技能
);
```

### 示例2: 通过IPC调用

```javascript
// 在渲染进程中
const tools = await window.electronAPI.invoke('skill:get-tools', skillId);
console.log('技能包含的工具:', tools);
```

## 🔗 相关技能

- 文档处理
- Web开发
- 模板应用
---

**文档生成时间**: 2025/12/30 17:19:39
**技能类型**: 内置
