---
id: skill_barcode_qrcode
name: 条形码二维码
category: image
enabled: true
---

# Barcode & QR Code

## 📝 概述

生成和识别条形码、二维码

**分类**: image
**标签**: 二维码, 条形码, 生成, 识别
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "errorCorrectionLevel": "M",
  "margin": 4
}
```

**配置说明**:

- `errorCorrectionLevel`: string 类型，当前值: "M"
- `margin`: number 类型，当前值: 4

## 📖 使用示例

### 示例1: 使用 条形码二维码

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "image" }  // 指定使用的技能
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
