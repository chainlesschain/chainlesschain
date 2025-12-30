---
id: skill_datetime_operations
name: 日期时间操作
category: utility
enabled: true
---

# DateTime Operations

## 📝 概述

日期计算、格式化、时区转换

**分类**: utility
**标签**: 日期, 时间, 格式化
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "defaultFormat": "YYYY-MM-DD HH:mm:ss",
  "timezone": "local"
}
```

**配置说明**:

- `defaultFormat`: 默认文件格式
- `timezone`: string 类型，当前值: "local"

## 📖 使用示例

### 示例1: 使用 日期时间操作

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "utility" }  // 指定使用的技能
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
