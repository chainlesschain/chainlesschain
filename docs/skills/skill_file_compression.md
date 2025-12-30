---
id: skill_file_compression
name: 文件压缩
category: file
enabled: true
---

# File Compression

## 📝 概述

ZIP/RAR/7Z压缩、解压、加密压缩包、批量压缩

**分类**: 文件操作
**标签**: 压缩, 解压, ZIP, RAR
**状态**: ✅ 已启用

## 💡 使用场景

1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率
## ⚙️ 配置选项

```json
{
  "default_format": "zip",
  "compression_level": "standard"
}
```

**配置说明**:

- `default_format`: string 类型，当前值: "zip"
- `compression_level`: string 类型，当前值: "standard"

## 📖 使用示例

### 示例1: 使用 文件压缩

```javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "file" }  // 指定使用的技能
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
