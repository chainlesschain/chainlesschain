---
id: tool_customer_health_scorer
name: health_score_calculator
category: crm
type: function
risk_level: 1
---

# 客户健康度评分器 / Customer Health Score Calculator

## 📝 概述

计算客户健康度评分，预测续约风险和扩展机会

**分类**: crm
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
const result = await functionCaller.call('health_score_calculator', {});

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
