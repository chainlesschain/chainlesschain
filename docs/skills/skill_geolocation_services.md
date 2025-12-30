---
id: skill_geolocation_services
name: 地理位置服务
category: location
enabled: true
---

# Geolocation Services

## 📝 概述

地理编码、距离计算、地图服务集成

**分类**: location
**标签**: 地理位置, 地图, 距离计算, 坐标转换
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "provider": "google",
  "units": "km"
}
```

**配置说明**:

- `provider`: string 类型，当前值: "google"
- `units`: string 类型，当前值: "km"

## 📖 使用示例

### 示例1: 使用 地理位置服务

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "location" }  // 指定使用的技能
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
