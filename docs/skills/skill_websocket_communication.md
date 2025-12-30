---
id: skill_websocket_communication
name: WebSocket通信
category: network
enabled: true
---

# WebSocket Communication

## 📝 概述

实时双向通信、WebSocket服务器/客户端

**分类**: 网络请求
**标签**: WebSocket, 实时通信, 双向, 推送
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "port": 8080,
  "pingInterval": 30000
}
```

**配置说明**:

- `port`: number 类型，当前值: 8080
- `pingInterval`: number 类型，当前值: 30000

## 📖 使用示例

### 示例1: 使用 WebSocket通信

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
