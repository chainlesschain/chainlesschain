---
id: skill_iot_integration
name: IoT集成
category: network
enabled: true
---

# IoT Integration

## 📝 概述

设备管理、MQTT通信、传感器数据处理、设备控制

**分类**: 网络请求
**标签**: IoT, 设备, MQTT, 传感器
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "protocol": "mqtt",
  "qos": 1
}
```

**配置说明**:

- `protocol`: string 类型，当前值: "mqtt"
- `qos`: number 类型，当前值: 1

## 📖 使用示例

### 示例1: 使用 IoT集成

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
