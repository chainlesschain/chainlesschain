---
id: skill_code_analysis
name: 代码分析
category: code
enabled: true
---

# Code Analysis

## 📝 概述

代码质量检查、AST分析、复杂度计算

**分类**: 代码开发
**标签**: 代码分析, 质量检查, AST, 复杂度
**状态**: ✅ 已启用

## 💡 使用场景

1. 创建新项目或代码文件
2. 阅读和修改现有代码
3. 代码重构和优化
4. 版本控制和提交
## ⚙️ 配置选项

```json
{
  "language": "javascript",
  "strictMode": true
}
```

**配置说明**:

- `language`: string 类型，当前值: "javascript"
- `strictMode`: boolean 类型，当前值: true

## 📖 使用示例

### 示例1: 使用 代码分析

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

**文档生成时间**: 2025/12/30 17:19:40
**技能类型**: 内置
