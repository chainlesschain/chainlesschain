# Data Analysis

## 📋 概述

**技能ID**: `skill_data_analysis`
**分类**: data
**状态**: ✅ 启用
**类型**: 🔧 内置技能
**图标**: bar-chart

读取CSV/Excel、数据清洗和可视化

---

## 🏷️ 标签

`数据` `分析` `可视化`

---

## ⚙️ 配置选项

```json
{
  "chartType": "auto",
  "exportFormat": "png"
}
```

### 配置说明

- **chartType**: auto - 自定义配置项
- **exportFormat**: png - 自定义配置项

---

## 🛠️ 包含的工具

1. [`file_reader`](../tools/file_reader.md)

---

## 📖 使用场景

### 1. 数据分析
- 数据读取和解析
- 统计计算
- 趋势分析

### 2. 数据可视化
- 生成图表
- 交互式可视化
- 报表生成

### 3. 数据清洗
- 数据验证
- 格式转换
- 异常处理

### 4. 数据导出
- 多格式导出
- 批量处理
- 自动化报告

---

## 💡 使用示例

### 示例 1: 基础使用

```javascript
// 调用 数据分析 技能
const result = await executeSkill('skill_data_analysis', {
  // 技能参数
  ...yourParams
});

console.log('执行结果:', result);
```

### 示例 2: 组合使用

```javascript
// 结合多个工具使用
const workflow = {
  skill: 'skill_data_analysis',
  tools: [
  "file_reader"
]
};

const result = await executeWorkflow(workflow);
```

### 示例 3: 自动化流程

```javascript
// 创建自动化任务
await createAutomationTask({
  name: '数据分析自动化',
  skill: 'skill_data_analysis',
  schedule: '0 9 * * *', // 每天9点执行
  params: {
    // 自动化参数
  }
});
```

---

## 🎯 最佳实践

1. **数据验证**: 输入数据进行严格验证
2. **异常处理**: 完善的错误处理机制
3. **性能优化**: 大数据集使用流式处理
4. **结果缓存**: 缓存频繁查询的结果
5. **日志记录**: 记录关键操作日志

---

## ⚠️ 常见问题

### Q1: 支持哪些数据格式？
A: 支持 CSV、JSON、Excel、SQL 等常见格式。

### Q2: 处理大文件会不会内存溢出？
A: 使用流式处理，支持处理GB级文件。

### Q3: 如何自定义数据转换？
A: 可以编写自定义转换函数。

### Q4: 数据安全如何保证？
A: 所有数据本地处理，不上传到云端。

---

## 🚀 进阶技巧

1. **增量处理**: 只处理变更的数据
2. **并行计算**: 利用多核进行并行处理
3. **数据分片**: 大数据集分片处理
4. **智能缓存**: 使用LRU缓存策略
5. **实时分析**: 流式数据实时处理

---

## 🔐 权限要求

- `file:read` - 文件读取权限

---

## 📊 性能优化建议

- 使用流式处理大文件
- 启用结果缓存
- 并行处理数据块

---

## 🔗 相关技能

- [ai conversation](../ai_conversation.md)
- [automation workflow](../automation_workflow.md)
- [content creation](../content_creation.md)

---

## 📝 更新日志

### v1.0.0 (2025-12-29)
- ✅ 初始版本发布
- ✅ 完整功能实现
- ✅ 文档完善

---

## 📚 参考资料

- [Pandas 文档](https://pandas.pydata.org/docs/)
- [数据可视化指南](https://www.datavisualization.ch/)
- [统计学习基础](https://web.stanford.edu/~hastie/ElemStatLearn/)

---

**文档版本**: v1.0.0
**最后更新**: 2025-12-29
**维护者**: ChainlessChain Team
**反馈**: [提交Issue](https://github.com/chainlesschain/chainlesschain/issues)
