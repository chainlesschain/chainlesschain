---
id: skill_config_parser
name: 配置解析
category: config
enabled: true
---

# Config Parser

## 📝 概述

解析和转换各种配置文件格式（XML/TOML/INI）

**分类**: config
**标签**: 配置, 解析, 格式
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "autoDetect": true,
  "preserveComments": false
}
```

**配置说明**:

- `autoDetect`: boolean 类型，当前值: true
- `preserveComments`: boolean 类型，当前值: false

## 📖 使用示例

### 示例1: 使用 配置解析

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "config" }  // 指定使用的技能
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
