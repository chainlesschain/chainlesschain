# LLM 性能仪表板可视化

**版本**: v0.20.0
**状态**: ✅ 已实现
**优先级**: Priority 2
**添加时间**: 2026-01-16

## 功能概述

LLM 性能仪表板提供了全面的 Token 使用、成本分析和性能优化监控，帮助用户：

- 📊 实时追踪 Token 消耗趋势
- 💰 分析成本分布和节省机会
- 🚀 监控缓存和压缩效果
- 📈 优化 LLM 使用策略

## 核心功能

### 1. 统计概览卡片

显示关键指标：

- **总调用次数**: 监控 API 使用频率
- **总 Token 消耗**: 追踪 Token 使用量（支持 K/M 单位）
- **总成本**: 显示 USD 和 CNY 双币种
- **缓存命中率**: 显示缓存优化效果（目标 > 50%）

### 2. 优化效果统计

- **压缩调用次数**: 显示使用 PromptCompressor 的次数
- **平均响应时间**: 监控 LLM 响应速度
- **缓存节省成本**: 预计节省金额（假设缓存节省 50% 成本）

### 3. Token 使用趋势图

**图表类型**: 折线图（ECharts）

**数据维度**:

- Token 数量（主 Y 轴）
- 调用次数（次 Y 轴）
- 成本 USD（第三 Y 轴）

**时间粒度**:

- 按小时（适合 24 小时内分析）
- 按天（默认，适合 7-30 天分析）
- 按周（适合长期趋势）

### 4. 成本分解可视化

#### 按提供商成本分布（饼图）

显示各 LLM 提供商的成本占比：

- Ollama（本地）
- Alibaba Qwen
- Zhipu GLM
- Baidu Qianfan
- ...（14+ 提供商）

#### 按模型成本分布（柱状图）

显示 Top 10 模型的成本排名：

- 提供商/模型名称
- 实际成本（带渐变色）
- 数值标签

### 5. 详细统计表格

**按提供商标签页**:

- 提供商名称
- 调用次数
- Token 消耗
- 成本（可排序）

**按模型标签页**:

- 提供商 + 模型
- 调用次数
- Token 消耗
- 成本（可排序）

## 使用方式

### 访问路径

1. **直接 URL**: `#/llm/performance`
2. **导航**: 系统监控与维护 → LLM 性能仪表板

### 时间范围选择

- **过去 24 小时**: 实时监控
- **过去 7 天**: 默认选项，适合周度分析
- **过去 30 天**: 月度总结
- **自定义**: 选择任意时间范围

### 数据导出

点击"导出报告"按钮，生成包含以下内容的 Excel/CSV 文件：

- 统计摘要
- 时间序列数据
- 成本分解详情
- 建议和优化策略

## 技术实现

### 前端组件

**文件**: `desktop-app-vue/src/renderer/pages/LLMPerformancePage.vue`

**依赖**:

- Vue 3.4 Composition API
- ECharts 6.0（图表渲染）
- Ant Design Vue 4.1（UI 组件）

**关键技术**:

- 响应式图表（自动适配窗口大小）
- 自动刷新（每 60 秒）
- 数字格式化（K/M 单位）
- 双币种显示（USD/CNY）

### 后端接口

**IPC 通道**（已存在）:

```javascript
// 获取使用统计
window.electronAPI.invoke("llm:get-usage-stats", { startDate, endDate });

// 获取时间序列数据
window.electronAPI.invoke("llm:get-time-series", {
  startDate,
  endDate,
  interval,
});

// 获取成本分解
window.electronAPI.invoke("llm:get-cost-breakdown", { startDate, endDate });

// 导出成本报告
window.electronAPI.invoke("llm:export-cost-report", { startDate, endDate });
```

**数据源**: `TokenTracker` (`desktop-app-vue/src/main/llm/token-tracker.js`)

**数据库表**: `llm_usage_log`

## 性能优化建议

基于仪表板数据，系统会提供以下优化建议：

### 提高缓存命中率

- 目标：> 50%
- 策略：启用响应缓存、使用相似查询

### 启用 Prompt 压缩

- 节省：30-40% Tokens
- 策略：自动压缩长对话历史

### 优化模型选择

- 成本意识：根据任务选择合适的模型
- 性能平衡：使用 LLM 智能选择器

### 预算管理

- 设置月度预算上限
- 接收超预算警告

## 数据准确性

- **统计延迟**: < 1 秒（SQLite 实时查询）
- **数据完整性**: 100%（所有 LLM 调用都被追踪）
- **时间精度**: 毫秒级时间戳

## 已知限制

1. **导出功能**: 依赖 TokenTracker.exportCostReport() 实现
2. **自定义时间范围**: 需要选择完整的开始和结束时间
3. **图表交互**: ECharts 支持缩放、数据筛选（已启用）

## 未来改进

**Phase 1 (当前)**:

- ✅ 基础可视化
- ✅ 时间序列图
- ✅ 成本分解

**Phase 2 (计划)**:

- [ ] 预算警报可视化
- [ ] 模型性能对比（准确率 vs 成本）
- [ ] 智能优化建议（基于 AI 分析）

**Phase 3 (规划)**:

- [ ] 多用户对比
- [ ] 团队使用统计
- [ ] 成本预测（基于历史趋势）

## 相关文档

- [SessionManager 使用指南](../../CLAUDE.md#sessionmanager-会话管理系统)
- [Token Tracker 实现](../../desktop-app-vue/src/main/llm/token-tracker.js)
- [MCP 集成](./MCP_USER_GUIDE.md)

## 故障排除

### 图表无法显示

**问题**: 页面加载后图表区域空白

**解决方案**:

1. 检查 `llm_usage_log` 表是否有数据
2. 确认时间范围内有 LLM 调用记录
3. 打开浏览器控制台查看错误信息

### 数据不准确

**问题**: 统计数据与实际使用不符

**解决方案**:

1. 检查 TokenTracker 是否正确初始化
2. 确认所有 LLM 调用都通过 LLMManager
3. 验证数据库时间戳格式

### 导出失败

**问题**: 点击导出按钮后无响应

**解决方案**:

1. 检查 TokenTracker.exportCostReport() 方法
2. 确认文件写入权限
3. 查看主进程日志

## 反馈与贡献

如有问题或建议，请提交 Issue 到：https://github.com/chainlesschain/issues

---

**维护者**: ChainlessChain Team
**最后更新**: 2026-01-16
