---
id: skill_i18n_translation
name: 国际化翻译
category: text
enabled: true
---

# Internationalization

## 📝 概述

多语言翻译、本地化格式化、语言检测

**分类**: text
**标签**: 国际化, 翻译, 本地化, 多语言
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "defaultLocale": "zh-CN",
  "supportedLocales": [
    "en-US",
    "zh-CN",
    "ja-JP"
  ]
}
```

**配置说明**:

- `defaultLocale`: string 类型，当前值: "zh-CN"
- `supportedLocales`: object 类型，当前值: ["en-US","zh-CN","ja-JP"]

## 📖 使用示例

### 示例1: 使用 国际化翻译

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "text" }  // 指定使用的技能
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
