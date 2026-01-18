---
id: tool-1
name: tool2
category: file
type: io
risk_level: 1
---

# File Reader

## 📝 概述

Read files from disk

**分类**: 文件操作
**类型**: io
**风险等级**: 🟢 低风险
**状态**: ✅ 已启用

## 📥 参数说明

| 参数名     | 类型   | 必填 | 说明             |
| ---------- | ------ | ---- | ---------------- |
| `filePath` | string | ✅   | Path to the file |

## 📤 返回值说明

```json
{
  "success": "boolean",
  "content": "string"
}
```

## 🔐 权限要求

- `fs:read`

## 📖 使用示例

```javascript
// 通过 FunctionCaller 调用
const result = await functionCaller.call("tool2", {
  filePath: "示例filePath",
});

console.log("执行结果:", result);
```

```javascript
// 通过 IPC 测试工具
const result = await window.electronAPI.invoke("tool:test", toolId, {
  filePath: "示例filePath",
});
```

## 📊 统计信息

- 总调用次数: 100
- 成功次数: 98
- 成功率: 98.00%
- 平均执行时间: 15.50ms
- 最后使用: 2025/12/30 08:00:00

## ⚠️ 注意事项

- 请按照参数说明正确传递参数
- 注意处理可能的错误和异常情况

---

**文档生成时间**: 2026/1/18 08:06:01
**工具类型**: 内置
