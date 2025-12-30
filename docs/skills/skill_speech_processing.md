---
id: skill_speech_processing
name: 语音处理
category: media
enabled: true
---

# Speech Processing

## 📝 概述

语音识别、文本转语音、音频格式转换

**分类**: 媒体处理
**标签**: 语音, TTS, ASR, 音频转换
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "language": "zh-CN",
  "voice": "female"
}
```

**配置说明**:

- `language`: string 类型，当前值: "zh-CN"
- `voice`: string 类型，当前值: "female"

## 📖 使用示例

### 示例1: 使用 语音处理

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "media" }  // 指定使用的技能
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
