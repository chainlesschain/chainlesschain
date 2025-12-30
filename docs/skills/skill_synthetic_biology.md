---
id: skill_synthetic_biology
name: 合成生物学
category: ai
enabled: true
---

# Synthetic Biology

## 📝 概述

基因编辑、代谢工程、蛋白质设计、合成基因回路

**分类**: AI功能
**标签**: 基因, 合成生物, CRISPR, 蛋白质
**状态**: ✅ 已启用

## 💡 使用场景

1. LLM对话和查询
2. 知识库语义搜索
3. Prompt模板填充
4. AI辅助决策
## ⚙️ 配置选项

```json
{
  "editor": "CRISPR-Cas9",
  "organism": "E.coli"
}
```

**配置说明**:

- `editor`: string 类型，当前值: "CRISPR-Cas9"
- `organism`: string 类型，当前值: "E.coli"

## 📖 使用示例

### 示例1: 使用 合成生物学

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
