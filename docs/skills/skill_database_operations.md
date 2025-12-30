---
id: skill_database_operations
name: 数据库操作
category: database
enabled: true
---

# Database Operations

## 📝 概述

SQL查询构建、数据导入导出、数据库管理

**分类**: database
**标签**: 数据库, SQL, 查询
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "autoCommit": true,
  "batchSize": 1000
}
```

**配置说明**:

- `autoCommit`: boolean 类型，当前值: true
- `batchSize`: number 类型，当前值: 1000

## 📖 使用示例

### 示例1: 使用 数据库操作

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "database" }  // 指定使用的技能
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
