# 测试脚本目录

本目录包含桌面应用的各类测试脚本（47个）。

## 📁 目录结构

### 🧪 单元测试脚本
已整合到 `tests/unit/` 目录，使用 Vitest 框架

### 🔗 集成测试脚本
- `test-p1-integration.js` - P1层集成测试
- `test-p2-intelligence-e2e.js` - P2智能层端到端测试
- `test-e2e-pipeline.js` - 完整E2E管道测试
- `test-plugin-system.js` - 插件系统测试
- `test-plugin-system-auto.js` - 插件自动化测试
- `test-plugin-installation.js` - 插件安装测试
- `test-plugin-phase2.js` - 插件Phase2测试
- `test-production-integration.js` - 生产环境集成测试
- `test-menu-integration.js` - 菜单集成测试
- `test-ui-integration.js` - UI集成测试

### ⚡ 性能测试脚本
- `test-fusion-performance.js` - 融合性能测试
- `test-p1-optimizations.js` - P1优化测试
- `test-pipeline-optimization.js` - 管道优化测试
- `test-short-term-optimizations.js` - 短期优化测试

### 🎯 功能测试脚本
- `test-data-access.js` - 数据访问测试
- `test-data-collector.js` - 数据收集器测试
- `test-db-init.js` - 数据库初始化测试
- `test-design.js` - 设计功能测试
- `test-document-engine.js` - 文档引擎测试
- `test-error-handling.js` - 错误处理测试
- `test-graph-backend.js` - 图数据库后端测试
- `test-hybrid-recommender.js` - 混合推荐器测试
- `test-intent-fusion.js` - 意图融合测试
- `test-kd.js` - 知识蒸馏测试
- `test-ml-tool-matcher.js` - 机器学习工具匹配器测试
- `test-p2p-nat-traversal.js` - P2P NAT穿透测试
- `test-quick-create.js` - 快速创建测试
- `test-recovery-fix.js` - 恢复修复测试
- `test-skill-tool-db.js` - 技能工具数据库测试
- `test-skill-tool-system.js` - 技能工具系统测试
- `test-sqlcipher.js` - SQLCipher加密测试
- `test-streaming-response.js` - 流式响应测试
- `test-template-data.js` - 模板数据测试
- `test-template-engine.js` - 模板引擎测试
- `test-tool-index.js` - 工具索引测试
- `test-ui-enhancements.js` - UI增强测试
- `test-ukey-drivers.js` - U-Key驱动测试
- `test-user-profile-manager.js` - 用户配置管理器测试
- `test-v3-handlers.js` - V3处理器测试
- `test-version-system.cjs` - 版本系统测试
- `test-video-import.js` - 视频导入测试
- `test-video-modules.js` - 视频模块测试
- `test-video-project.js` - 视频项目测试
- `test-volcengine-api.js` - 火山引擎API测试

### 🔬 专项测试脚本
- `test-p1-simple.js` - P1简单测试
- `test-p1-real-scenarios.js` - P1真实场景测试
- `test-p2-simple.js` - P2简单测试
- `test-p2-complete.js` - P2完整测试

## 🚀 使用方法

### 运行单个测试
```bash
node test-scripts/test-db-init.js
```

### 运行性能测试
```bash
node test-scripts/test-fusion-performance.js
node test-scripts/test-pipeline-optimization.js
```

### 运行集成测试
```bash
node test-scripts/test-p1-integration.js
node test-scripts/test-production-integration.js
```

## 📝 注意事项

1. **测试环境**: 某些测试需要数据库和服务运行
2. **测试数据**: 使用 `test-data/` 目录的测试数据
3. **独立运行**: 这些测试脚本可以独立运行，不依赖测试框架
4. **生产环境**: 不要在生产数据库上运行测试脚本

## 🔗 相关目录

- **tests/** - Vitest单元测试和集成测试
- **tools/test-utils/** - 测试辅助工具
- **test-data/** - 测试数据目录
- **test-plugin/** - 插件测试目录
- **test-results/** - 测试结果目录

---

**最后更新**: 2026-01-03
