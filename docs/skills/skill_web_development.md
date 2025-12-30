---
id: skill_web_development
name: Web开发
category: web
enabled: true
---

# Web Development

## 📝 概述

创建网页、博客、单页应用等Web项目

**分类**: Web开发
**标签**: Web, HTML, CSS, JavaScript
**状态**: ✅ 已启用

## 💡 使用场景

1. 创建静态网页和博客
2. 生成响应式布局
3. 开发单页应用（SPA）
4. 设计网页样式和交互
## ⚙️ 配置选项

```json
{
  "defaultTemplate": "blog",
  "responsive": true
}
```

**配置说明**:

- `defaultTemplate`: 默认使用的模板
- `responsive`: 是否生成响应式布局

## 📖 使用示例

### 示例1: 使用 Web开发

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "web" }  // 指定使用的技能
);
```

### 示例2: 通过IPC调用

```javascript
// 在渲染进程中
const tools = await window.electronAPI.invoke('skill:get-tools', skillId);
console.log('技能包含的工具:', tools);
```

## 🔗 相关技能

- 代码开发
- 文档处理
- 模板应用
---

**文档生成时间**: 2025/12/30 17:19:39
**技能类型**: 内置
