---
id: skill_log_analysis
name: 日志分析
category: devops
enabled: true
---

# Log Analysis

## 📝 概述

解析和分析各种日志格式（Nginx、Apache、JSON日志等）

**分类**: devops
**标签**: 日志, 分析, 监控, 调试
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "logFormats": [
    "nginx",
    "apache",
    "json",
    "syslog"
  ]
}
```

**配置说明**:

- `logFormats`: object 类型，当前值: ["nginx","apache","json","syslog"]

## 📖 使用示例

### 示例1: 使用 日志分析

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "devops" }  // 指定使用的技能
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
