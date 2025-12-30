---
id: skill_message_queue
name: 消息队列
category: messaging
enabled: true
---

# Message Queue

## 📝 概述

消息发布订阅、队列管理、异步处理

**分类**: messaging
**标签**: 消息队列, RabbitMQ, Kafka, 异步
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "durable": true,
  "autoAck": false
}
```

**配置说明**:

- `durable`: boolean 类型，当前值: true
- `autoAck`: boolean 类型，当前值: false

## 📖 使用示例

### 示例1: 使用 消息队列

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "messaging" }  // 指定使用的技能
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
