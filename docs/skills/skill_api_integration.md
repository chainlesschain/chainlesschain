---
id: skill_api_integration
name: API集成工具
category: network
enabled: true
---

# API Integration

## 📝 概述

HTTP请求、OAuth认证、API调用管理

**分类**: 网络请求
**标签**: API, HTTP, 认证, 集成
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "timeout": 30000,
  "retries": 3
}
```

**配置说明**:

- `timeout`: 超时时间（毫秒）
- `retries`: number 类型，当前值: 3

## 📖 使用示例

### 示例1: 使用 API集成工具

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "network" }  // 指定使用的技能
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
