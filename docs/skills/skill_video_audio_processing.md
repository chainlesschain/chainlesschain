---
id: skill_video_audio_processing
name: 视频音频处理
category: media
enabled: true
---

# Video & Audio Processing

## 📝 概述

视频音频元数据读取、格式转换、时长计算

**分类**: 媒体处理
**标签**: 视频, 音频, 媒体, 元数据
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "supportedFormats": [
    "mp4",
    "mp3",
    "wav",
    "avi",
    "mkv"
  ],
  "maxFileSize": "500MB"
}
```

**配置说明**:

- `supportedFormats`: object 类型，当前值: ["mp4","mp3","wav","avi","mkv"]
- `maxFileSize`: string 类型，当前值: "500MB"

## 📖 使用示例

### 示例1: 使用 视频音频处理

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
