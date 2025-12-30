---
id: skill_data_validation
name: 数据验证
category: data
enabled: true
---

# Data Validation

## 📝 概述

数据校验、Schema验证、规则引擎

**分类**: 数据处理
**标签**: 验证, 校验, 规则, 质量检查
**状态**: ✅ 已启用

## 💡 使用场景

1. 读取和分析CSV/Excel数据
2. 数据清洗和转换
3. 生成数据可视化图表
4. 数据报告生成
## ⚙️ 配置选项

```json
{
  "strictMode": true,
  "autoConvert": false
}
```

**配置说明**:

- `strictMode`: boolean 类型，当前值: true
- `autoConvert`: boolean 类型，当前值: false

## 📖 使用示例

### 示例1: 使用 数据验证

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "data" }  // 指定使用的技能
);
```

### 示例2: 通过IPC调用

```javascript
// 在渲染进程中
const tools = await window.electronAPI.invoke('skill:get-tools', skillId);
console.log('技能包含的工具:', tools);
```

## 🔗 相关技能

- 文档处理
- AI对话
- 自动化工作流
---

**文档生成时间**: 2025/12/30 17:19:40
**技能类型**: 内置
