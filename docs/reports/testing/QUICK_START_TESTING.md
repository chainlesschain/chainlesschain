# 自动化测试快速开始指南

## 🚀 快速开始

### 1. 安装依赖

```bash
cd desktop-app-vue
npm install
```

### 2. 运行所有测试

```bash
# 使用测试运行器(推荐)
npm run test:runner

# 或者分别运行
npm run test:all
```

### 3. 查看测试报告

测试运行后会生成报告:
- **JSON报告**: `desktop-app-vue/test-results/test-report.json`
- **HTML报告**: `desktop-app-vue/test-results/test-report.html`

打开HTML报告查看可视化结果:
```bash
# Windows
start desktop-app-vue/test-results/test-report.html

# macOS
open desktop-app-vue/test-results/test-report.html

# Linux
xdg-open desktop-app-vue/test-results/test-report.html
```

---

## 🧪 测试命令速查

### 基础测试命令

```bash
# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# E2E测试
npm run test:e2e

# 性能测试
npm run test:performance

# 测试覆盖率
npm run test:coverage
```

### 专项测试命令

```bash
# 数据库测试
npm run test:db

# U-Key硬件测试
npm run test:ukey

# 数据引擎测试
npm run test:data
```

### 高级命令

```bash
# 运行完整测试套件并生成报告
npm run test:runner

# 自动修复测试失败
npm run test:auto-fix

# 系统健康检查
npm run test:health
```

---

## 🔧 自动修复系统

### 使用自动修复

当测试失败时,可以尝试自动修复:

```bash
npm run test:auto-fix
```

自动修复系统会:
1. 分析测试失败原因
2. 识别错误类型
3. 应用对应的修复策略
4. 生成修复报告

### 支持的自动修复类型

- ✅ **依赖问题** - 自动重新安装依赖
- ✅ **类型错误** - 自动重新编译TypeScript
- ✅ **数据库锁定** - 清理锁文件
- ✅ **端口占用** - 释放被占用的端口
- ✅ **服务连接失败** - 自动重启Docker服务
- ✅ **缓存问题** - 清理npm缓存
- ✅ **ESLint错误** - 自动修复格式问题

### 修复报告

修复后会生成报告:
- `desktop-app-vue/test-results/auto-fix-report.json`

---

## 🏥 健康检查系统

### 运行健康检查

```bash
npm run test:health
```

### 检查项目

系统会检查以下组件:
- ✅ **数据库连接** - SQLite/SQLCipher
- ✅ **Ollama服务** - LLM推理服务
- ✅ **Qdrant服务** - 向量数据库
- ✅ **Project Service** - 项目管理后端
- ✅ **AI Service** - AI推理后端
- ✅ **磁盘空间** - 可用存储空间
- ✅ **内存使用** - 应用内存占用
- ✅ **U-Key** - 硬件密钥状态
- ✅ **网络连接** - 互联网连接

### 自动修复

健康检查会自动尝试修复以下问题:
- 重启失败的服务
- 清理内存
- 重新初始化数据库

---

## 📊 查看测试覆盖率

### 生成覆盖率报告

```bash
npm run test:coverage
```

### 查看报告

```bash
# HTML报告
open desktop-app-vue/coverage/index.html

# 控制台报告
npm run test:coverage -- --reporter=text
```

### 覆盖率目标

- **总体覆盖率**: > 70%
- **单元测试**: > 80%
- **集成测试**: > 60%
- **E2E测试**: 核心流程100%

---

## 🐛 调试测试

### 单独运行某个测试文件

```bash
npm run test -- tests/unit/database.test.js
```

### 运行特定测试用例

```bash
npm run test -- -t "应该成功初始化数据库"
```

### 监听模式(开发时使用)

```bash
npm run test:watch
```

### 可视化UI

```bash
npm run test:ui
```

### 查看详细日志

```bash
npm run test -- --reporter=verbose
```

---

## 🔄 持续集成

### 本地预提交检查

在提交代码前运行:

```bash
npm run test:runner
```

如果有失败,尝试自动修复:

```bash
npm run test:auto-fix
npm run test:runner
```

### GitHub Actions

项目已配置以下CI/CD流程:

#### `.github/workflows/test.yml` (基础测试)
- 代码质量检查
- 单元测试
- 集成测试
- 数据库测试
- 构建检查

#### `.github/workflows/test-automation-full.yml` (完整自动化)
- 系统健康检查
- 完整测试套件
- 自动修复尝试
- 失败自动创建Issue

### 触发CI

```bash
# 推送到main或develop分支会自动触发
git push origin main

# 或手动触发
gh workflow run test-automation-full.yml
```

---

## 📝 编写新测试

### 单元测试模板

```javascript
// tests/unit/my-feature.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockElectronAPI } from '../setup';

describe('My Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should work correctly', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = myFunction(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

### 集成测试模板

```javascript
// tests/integration/my-integration.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('My Integration', () => {
  beforeAll(async () => {
    // 设置测试环境
  });

  afterAll(async () => {
    // 清理
  });

  it('should integrate correctly', async () => {
    // 测试多个组件的集成
  });
});
```

### E2E测试模板

```typescript
// tests/e2e/my-workflow.e2e.test.ts
import { test, expect } from '@playwright/test';

test('user workflow', async ({ page }) => {
  // 1. 导航到页面
  await page.goto('http://localhost:5173');

  // 2. 执行操作
  await page.click('button[data-test="start"]');

  // 3. 验证结果
  await expect(page.locator('.result')).toHaveText('Success');
});
```

---

## 🎯 最佳实践

### 1. 测试命名
- ✅ 使用清晰的描述: `应该在用户输入有效数据时创建项目`
- ❌ 避免模糊命名: `test1`, `works`

### 2. 测试结构
- 使用 **AAA模式**: Arrange (准备), Act (执行), Assert (验证)
- 保持测试独立,不依赖执行顺序

### 3. Mock数据
- 使用setup.ts中的mock API
- 不要在测试中使用真实的外部服务

### 4. 测试覆盖
- 重点测试核心业务逻辑
- 不要过度追求100%覆盖率
- 关注关键路径和边界情况

### 5. 性能
- 单元测试应该非常快 (< 100ms)
- 集成测试可以慢一些 (< 5s)
- E2E测试允许更长时间 (< 30s)

---

## 🔍 故障排除

### 测试卡住不动

```bash
# 检查是否有测试超时
npm run test -- --testTimeout=10000

# 或者使用监听模式并查看输出
npm run test:watch
```

### 数据库锁定错误

```bash
# 运行自动修复
npm run test:auto-fix

# 或手动删除锁文件
rm ../data/chainlesschain.db-wal
rm ../data/chainlesschain.db-shm
```

### Docker服务连接失败

```bash
# 确保Docker服务运行
docker ps

# 启动服务
cd .. && docker-compose up -d

# 等待服务启动
sleep 10

# 重新运行测试
cd desktop-app-vue && npm run test
```

### 端口冲突

```bash
# 检查占用的端口
netstat -ano | findstr :5173  # Windows
lsof -ti:5173                 # Linux/macOS

# 杀掉占用端口的进程
taskkill /F /PID <PID>        # Windows
kill -9 <PID>                 # Linux/macOS

# 或运行自动修复
npm run test:auto-fix
```

### 依赖问题

```bash
# 清理并重新安装
rm -rf node_modules package-lock.json
npm install

# 或运行自动修复
npm run test:auto-fix
```

---

## 📚 更多资源

### 文档
- [完整测试计划](TEST_AUTOMATION_PLAN.md)
- [项目README](README.md)
- [系统设计文档](系统设计_个人移动AI管理系统.md)

### 工具文档
- [Vitest](https://vitest.dev/)
- [Playwright](https://playwright.dev/)
- [Vue Test Utils](https://test-utils.vuejs.org/)

### 帮助
遇到问题?
1. 查看测试日志
2. 运行健康检查: `npm run test:health`
3. 尝试自动修复: `npm run test:auto-fix`
4. 查看[故障排除](#故障排除)部分
5. 在GitHub提交Issue

---

## ✅ 检查清单

在提交代码前确保:

- [ ] 所有测试通过: `npm run test:runner`
- [ ] 代码覆盖率达标: `npm run test:coverage`
- [ ] 没有ESLint错误: `npm run lint`
- [ ] TypeScript编译通过: `npm run build:main`
- [ ] 健康检查通过: `npm run test:health`

---

**最后更新**: 2025-12-28
**维护者**: ChainlessChain Team

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：自动化测试快速开始指南。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
