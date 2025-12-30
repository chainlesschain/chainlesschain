---
id: skill_database_migration
name: 数据库迁移
category: database
enabled: true
---

# Database Migration

## 📝 概述

数据库版本管理、Schema迁移、数据迁移

**分类**: database
**标签**: 数据库, 迁移, 版本管理, Schema
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "driver": "mysql",
  "migrationsPath": "./migrations"
}
```

**配置说明**:

- `driver`: string 类型，当前值: "mysql"
- `migrationsPath`: string 类型，当前值: "./migrations"

## 📖 使用示例

### 示例1: 使用 数据库迁移

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
