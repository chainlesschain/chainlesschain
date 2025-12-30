---
id: skill_blockchain_integration
name: 区块链集成
category: blockchain
enabled: true
---

# Blockchain Integration

## 📝 概述

与区块链网络交互、智能合约调用、钱包管理

**分类**: blockchain
**标签**: 区块链, 智能合约, 加密货币, Web3
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "network": "ethereum",
  "chainId": 1
}
```

**配置说明**:

- `network`: string 类型，当前值: "ethereum"
- `chainId`: number 类型，当前值: 1

## 📖 使用示例

### 示例1: 使用 区块链集成

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "blockchain" }  // 指定使用的技能
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
