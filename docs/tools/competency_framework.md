---
id: tool_competency_framework
name: competency_framework
category: hr
type: function
risk_level: 1
---

# 能力框架工具 / Competency Framework Tool

## 📝 概述

构建和管理企业能力素质模型，定义岗位能力要求

**分类**: hr
**类型**: function
**风险等级**: 🟢 低风险
**状态**: ✅ 已启用

## 📥 参数说明

该工具无参数。

## 📤 返回值说明

返回值根据具体执行情况而定。

## 📖 使用示例

```javascript
// 通过 FunctionCaller 调用
const result = await functionCaller.call('competency_framework', {});

console.log('执行结果:', result);
```

```javascript
// 通过 IPC 测试工具
const result = await window.electronAPI.invoke('tool:test', toolId, {});
```

## ⚠️ 注意事项

- 请按照参数说明正确传递参数
- 注意处理可能的错误和异常情况

---

**文档生成时间**: 2026/1/1 22:08:04
**工具类型**: 内置
