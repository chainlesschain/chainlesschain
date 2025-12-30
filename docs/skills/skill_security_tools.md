---
id: skill_security_tools
name: 安全工具
category: security
enabled: true
---

# Security Tools

## 📝 概述

Hash校验、JWT解析、文件完整性验证

**分类**: security
**标签**: 安全, 验证, JWT
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "defaultAlgorithm": "sha256",
  "strictMode": true
}
```

**配置说明**:

- `defaultAlgorithm`: string 类型，当前值: "sha256"
- `strictMode`: boolean 类型，当前值: true

## 📖 使用示例

### 示例1: 使用 安全工具

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
