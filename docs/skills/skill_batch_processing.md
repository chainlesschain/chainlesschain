---
id: skill_batch_processing
name: 批量处理
category: automation
enabled: true
---

# Batch Processing

## 📝 概述

批量文件操作、数据处理和转换

**分类**: 自动化
**标签**: 批量, 自动化, 处理
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "maxConcurrent": 5,
  "continueOnError": true,
  "progressCallback": true
}
```

**配置说明**:

- `maxConcurrent`: number 类型，当前值: 5
- `continueOnError`: boolean 类型，当前值: true
- `progressCallback`: boolean 类型，当前值: true

## 📖 使用示例

### 示例1: 使用 批量处理

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "automation" }  // 指定使用的技能
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
