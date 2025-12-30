---
id: skill_code_development
name: 代码开发
category: code
enabled: true
---

# Code Development

## 📝 概述

提供完整的代码开发能力，包括文件读写、代码生成和版本控制

**分类**: 代码开发
**标签**: 代码, 开发, Git
**状态**: ✅ 已启用

## 💡 使用场景

1. 创建新项目或代码文件
2. 阅读和修改现有代码
3. 代码重构和优化
4. 版本控制和提交
## ⚙️ 配置选项

```json
{
  "defaultLanguage": "javascript",
  "autoFormat": true,
  "enableLinting": false
}
```

**配置说明**:

- `defaultLanguage`: 默认编程语言
- `autoFormat`: 是否自动格式化代码
- `enableLinting`: 是否启用代码检查

## 📖 使用示例

### 示例1: 使用 代码开发

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "code" }  // 指定使用的技能
);
```

### 示例2: 通过IPC调用

```javascript
// 在渲染进程中
const tools = await window.electronAPI.invoke('skill:get-tools', skillId);
console.log('技能包含的工具:', tools);
```

## 🔗 相关技能

- Web开发
- 项目管理
- 代码执行
---

**文档生成时间**: 2025/12/30 22:55:00
**技能类型**: 内置
