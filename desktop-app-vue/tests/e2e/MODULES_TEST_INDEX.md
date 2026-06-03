# E2E测试模块索引

**最后更新**: 2026-01-25
**总测试文件数**: 60+ 个

## 快速导航

- [开发工具模块](#开发工具模块-devtools)
- [内容聚合模块](#内容聚合模块-content)
- [插件生态模块](#插件生态模块-plugins)
- [多媒体处理模块](#多媒体处理模块-multimedia)
- [知识管理模块](#知识管理模块-knowledge)
- [项目管理模块](#项目管理模块-project)
- [社交网络模块](#社交网络模块-social)
- [AI功能模块](#ai功能模块-ai)
- [系统设置模块](#系统设置模块-settings)
- [监控模块](#监控模块-monitoring)
- [交易市场模块](#交易市场模块-trading)
- [企业版模块](#企业版模块-enterprise)

---

## 开发工具模块 (devtools/)

**文件数**: 2 | **测试用例**: 10

### 测试文件清单

| 序号 | 文件名 | 路由 | 描述 |
|------|--------|------|------|
| 1 | `webide.e2e.test.ts` | `/webide` | Web IDE页面测试 |
| 2 | `design-editor.e2e.test.ts` | `/design/test-project` | 设计编辑器页面测试 |

### 测试覆盖点
- Web IDE编辑器功能
- 设计工具和画布交互
- 文件浏览器和项目结构
- 工具栏和属性面板

---

## 内容聚合模块 (content/)

**文件数**: 5 | **测试用例**: 25

### 测试文件清单

| 序号 | 文件名 | 路由 | 描述 |
|------|--------|------|------|
| 1 | `rss-feeds.e2e.test.ts` | `/rss/feeds` | RSS订阅管理页面测试 |
| 2 | `rss-article.e2e.test.ts` | `/rss/article/test-feed` | RSS文章阅读页面测试 |
| 3 | `email-accounts.e2e.test.ts` | `/email/accounts` | 邮件账户管理页面测试 |
| 4 | `email-compose.e2e.test.ts` | `/email/compose` | 写邮件页面测试 |
| 5 | `email-read.e2e.test.ts` | `/email/read/test-email` | 阅读邮件页面测试 |

### 测试覆盖点
- RSS订阅源添加和管理
- 文章内容阅读和分享
- 邮箱账户配置
- 邮件撰写和发送
- 邮件阅读和回复

---

## 插件生态模块 (plugins/)

**文件数**: 3 | **测试用例**: 15

### 测试文件清单

| 序号 | 文件名 | 路由 | 描述 |
|------|--------|------|------|
| 1 | `plugin-marketplace.e2e.test.ts` | `/plugins/marketplace` | 插件市场页面测试 |
| 2 | `plugin-publisher.e2e.test.ts` | `/plugins/publisher` | 插件发布页面测试 |
| 3 | `plugin-page.e2e.test.ts` | `/plugin/test-plugin` | 插件详情页面测试 |

### 测试覆盖点
- 插件搜索和浏览
- 插件分类和过滤
- 插件发布表单
- 插件安装和卸载
- 插件详情展示

---

## 多媒体处理模块 (multimedia/)

**文件数**: 2 | **测试用例**: 10

### 测试文件清单

| 序号 | 文件名 | 路由 | 描述 |
|------|--------|------|------|
| 1 | `audio-import.e2e.test.ts` | `/audio/import` | 音频导入页面测试 |
| 2 | `multimedia-demo.e2e.test.ts` | `/multimedia/demo` | 多媒体处理页面测试 |

### 测试覆盖点
- 音频文件上传
- 多媒体播放器
- 格式转换工具
- 处理控制功能

---

## 知识管理模块 (knowledge/)

**文件数**: 6 | **测试用例**: 30+

### 测试文件清单

| 序号 | 文件名 | 路由 | 描述 |
|------|--------|------|------|
| 1 | `file-import.e2e.test.ts` | `/knowledge/import` | 文件导入测试 |
| 2 | `image-upload.e2e.test.ts` | `/knowledge/image` | 图片上传测试 |
| 3 | `knowledge-graph.e2e.test.ts` | `/knowledge/graph` | 知识图谱测试 |
| 4 | `knowledge-store.e2e.test.ts` | `/knowledge/store` | 知识商店测试 |
| 5 | `my-purchases.e2e.test.ts` | `/knowledge/purchases` | 我的购买测试 |
| 6 | `prompt-templates.e2e.test.ts` | `/knowledge/templates` | 提示词模板测试 |

---

## 项目管理模块 (project/)

**文件数**: 6+ | **测试用例**: 30+

### 测试文件清单

包含项目创建、编辑、团队协作、Git集成等测试文件

---

## 社交网络模块 (social/)

**文件数**: 8+ | **测试用例**: 40+

### 测试文件清单

包含社交动态、朋友圈、好友管理、群组等测试文件

---

## AI功能模块 (ai/)

**文件数**: 10+ | **测试用例**: 50+

### 测试文件清单

包含AI对话、模型管理、性能监控、错误诊断等测试文件

---

## 系统设置模块 (settings/)

**文件数**: 8+ | **测试用例**: 40+

### 测试文件清单

包含系统配置、LLM设置、MCP设置、备份恢复等测试文件

---

## 监控模块 (monitoring/)

**文件数**: 4+ | **测试用例**: 20+

### 测试文件清单

包含系统监控、性能分析、日志查看等测试文件

---

## 交易市场模块 (trading/)

**文件数**: 8+ | **测试用例**: 40+

### 测试文件清单

包含资产管理、交易订单、市场行情等测试文件

---

## 企业版模块 (enterprise/)

**文件数**: 6+ | **测试用例**: 30+

### 测试文件清单

包含权限管理、审计日志、策略配置等测试文件

---

## 运行指南

### 运行单个模块的所有测试

```bash
# 开发工具模块
npm run test:e2e -- tests/e2e/devtools

# 内容聚合模块
npm run test:e2e -- tests/e2e/content

# 插件生态模块
npm run test:e2e -- tests/e2e/plugins

# 多媒体处理模块
npm run test:e2e -- tests/e2e/multimedia

# 知识管理模块
npm run test:e2e -- tests/e2e/knowledge

# 项目管理模块
npm run test:e2e -- tests/e2e/project

# 社交网络模块
npm run test:e2e -- tests/e2e/social

# AI功能模块
npm run test:e2e -- tests/e2e/ai
```

### 运行单个测试文件

```bash
npm run test:e2e -- tests/e2e/devtools/webide.e2e.test.ts
npm run test:e2e -- tests/e2e/content/rss-feeds.e2e.test.ts
npm run test:e2e -- tests/e2e/plugins/plugin-marketplace.e2e.test.ts
npm run test:e2e -- tests/e2e/multimedia/audio-import.e2e.test.ts
```

### 运行所有E2E测试

```bash
npm run test:e2e
```

---

## 测试标准

### 每个测试文件包含

1. **页面访问测试** - 验证路由和URL
2. **元素显示测试** - 验证主要UI元素
3. **错误检查测试** - 验证控制台无关键错误
4. **交互测试** - 验证按钮和控件可用
5. **功能测试** - 验证特定功能正常

### 测试命名规范

- 文件名: `[功能名].e2e.test.ts`
- 测试描述: 使用中文描述功能
- 测试ID: 使用 `test-*` 前缀避免污染生产数据

### 测试路由参数

所有测试路由都使用 `?e2e=true` 参数标识测试环境

---

## 维护指南

### 添加新测试

1. 在对应模块目录创建 `.e2e.test.ts` 文件
2. 导入通用测试辅助函数
3. 实现标准的5个测试用例
4. 更新本索引文件

### 更新现有测试

1. 根据功能变更修改测试用例
2. 确保测试ID和选择器仍然有效
3. 运行测试验证修改

### 删除过时测试

1. 确认功能已被移除
2. 删除对应测试文件
3. 更新本索引文件

---

## 相关文档

- [测试辅助工具](./helpers/common.ts)
- [附加模块测试总结](./ADDITIONAL_MODULES_TESTS_SUMMARY.md)
- [测试覆盖率报告](./E2E_TEST_COVERAGE.md)
- [Week 1完成总结](./WEEK1_FINAL_SUMMARY.md)
- [Week 2进度追踪](./WEEK2_PROGRESS.md)

---

## 统计概览

| 模块分类 | 文件数 | 预估测试用例数 |
|----------|--------|---------------|
| 开发工具 | 2 | 10 |
| 内容聚合 | 5 | 25 |
| 插件生态 | 3 | 15 |
| 多媒体处理 | 2 | 10 |
| 知识管理 | 6 | 30 |
| 项目管理 | 6 | 30 |
| 社交网络 | 8 | 40 |
| AI功能 | 10 | 50 |
| 系统设置 | 8 | 40 |
| 监控 | 4 | 20 |
| 交易市场 | 8 | 40 |
| 企业版 | 6 | 30 |
| **总计** | **68+** | **340+** |

---

**最后更新**: 2026-01-25
**维护者**: Claude Code AI Assistant
