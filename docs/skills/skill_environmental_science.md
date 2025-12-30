---
id: skill_environmental_science
name: 环境科学
category: ai
enabled: true
---

# Environmental Science

## 📝 概述

气象分析、环境监测、污染预测、生态建模

**分类**: AI功能
**标签**: 环境, 气象, 监测, 生态
**状态**: ✅ 已启用

## 💡 使用场景

1. LLM对话和查询
2. 知识库语义搜索
3. Prompt模板填充
4. AI辅助决策
## ⚙️ 配置选项

```json
{
  "dataSource": "weather_api",
  "resolution": "hourly"
}
```

**配置说明**:

- `dataSource`: string 类型，当前值: "weather_api"
- `resolution`: string 类型，当前值: "hourly"

## 📖 使用示例

### 示例1: 使用 环境科学

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "ai" }  // 指定使用的技能
);
```

### 示例2: 通过IPC调用

```javascript
// 在渲染进程中
const tools = await window.electronAPI.invoke('skill:get-tools', skillId);
console.log('技能包含的工具:', tools);
```

## 🔗 相关技能

- 知识库搜索
- 内容创作
- 自动化工作流
---

**文档生成时间**: 2025/12/30 17:19:40
**技能类型**: 内置
