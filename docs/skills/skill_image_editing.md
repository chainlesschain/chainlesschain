---
id: skill_image_editing
name: 图片编辑
category: media
enabled: true
---

# Image Editing

## 📝 概述

图片裁剪、缩放、旋转、滤镜、水印、格式转换

**分类**: 媒体处理
**标签**: 图片, 编辑, 滤镜, 水印
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "output_quality": "high",
  "preserve_metadata": true
}
```

**配置说明**:

- `output_quality`: string 类型，当前值: "high"
- `preserve_metadata`: boolean 类型，当前值: true

## 📖 使用示例

### 示例1: 使用 图片编辑

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
