---
id: tool_legal_template_generator
name: legal_template_generator
category: legal
type: function
risk_level: 1
---

# 法律文书生成器 / Legal Template Generator

## 📝 概述

生成各类法律文书模板，包括合同、协议、申请书等

**分类**: legal
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
const result = await functionCaller.call('legal_template_generator', {});

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

**文档生成时间**: 2026/1/1 22:08:03
**工具类型**: 内置
