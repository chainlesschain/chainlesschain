---
id: skill_encryption_security
name: 加密安全
category: security
enabled: true
---

# Encryption & Security

## 📝 概述

数据加密、哈希计算、Base64编解码等安全操作

**分类**: security
**标签**: 加密, 安全, 哈希
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "defaultAlgorithm": "sha256",
  "secureRandom": true
}
```

**配置说明**:

- `defaultAlgorithm`: string 类型，当前值: "sha256"
- `secureRandom`: boolean 类型，当前值: true

## 📖 使用示例

### 示例1: 使用 加密安全

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "security" }  // 指定使用的技能
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
