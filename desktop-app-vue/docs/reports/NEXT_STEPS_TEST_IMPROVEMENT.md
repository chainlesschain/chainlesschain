# 测试完善下一步行动计划

**创建日期**: 2026-01-31
**基于报告**: `TEST_COVERAGE_REPORT_2026-01-31.md`

---

## 🎯 立即行动清单 (本周)

### 1. 修复database-adapter跳过测试 ⚠️ **优先级P0**

**工作量**: 2-3小时
**负责人**: 开发团队
**截止日期**: 2026-02-02

**操作步骤**:

```bash
cd desktop-app-vue/tests/unit/database
```

1. **阅读修复方案**

   ```bash
   cat DATABASE_ADAPTER_TEST_FIX_PLAN.md
   ```

2. **创建集成测试分支**

   ```bash
   git checkout -b fix/database-adapter-tests
   ```

3. **修改测试文件**
   编辑 `database-adapter.test.js`:
   - 移除所有`.skip`标记
   - 添加临时目录管理
   - 使用真实文件系统测试

4. **运行测试验证**

   ```bash
   npm run test tests/unit/database/database-adapter.test.js
   ```

5. **提交代码**
   ```bash
   git add tests/unit/database/database-adapter.test.js
   git commit -m "fix(test): 修复database-adapter的7个跳过测试
   ```

- 使用集成测试替代mock测试
- 添加临时文件系统管理
- 所有测试通过

Fixes #XXX"

````

**验收标准**:
- [ ] 7个测试全部移除`.skip`
- [ ] 所有测试通过（0失败）
- [ ] 临时文件正确清理
- [ ] 代码审查通过

---

### 2. 安装FFmpeg依赖 ⚠️ **优先级P0**

**工作量**: 30分钟
**影响**: 解锁45个视频处理测试

**Windows**:
```bash
choco install ffmpeg
````

**Linux/WSL**:

```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**macOS**:

```bash
brew install ffmpeg
```

**验证安装**:

```bash
ffmpeg -version
```

**运行视频测试**:

```bash
npm run test tests/unit/media/video-engine.test.js
```

**验收标准**:

- [ ] FFmpeg安装成功
- [ ] 45个视频测试全部运行
- [ ] 测试通过率 >80%

---

### 3. 分析失败测试 ⚠️ **优先级P1**

**工作量**: 4-6小时
**当前状态**: 362个测试失败 (5.4%)

**Step 1: 生成详细报告**

```bash
cd desktop-app-vue
npm run test -- --reporter=verbose > test-failures-detail.log 2>&1
```

**Step 2: 分类失败原因**

```bash
# 提取失败信息
grep -A 5 "FAIL\|Error:" test-failures-detail.log > failures-summary.txt

# 按模块分组
grep "tests/unit/" test-failures-detail.log | cut -d'/' -f3 | sort | uniq -c
```

**Step 3: 创建问题追踪**
为每个失败类别创建GitHub Issue，标签：`bug`, `test-failure`

**Step 4: 优先修复高影响问题**

- 阻塞性失败（影响CI/CD）
- 核心模块失败（database, security, ai-engine）
- 批量失败（同一原因导致多个测试失败）

**验收标准**:

- [ ] 失败测试分类完成
- [ ] GitHub Issues创建完成
- [ ] 高优先级问题修复 (>50%失败测试)
- [ ] 失败率降至 <3%

---

## 📅 短期目标 (2周内)

### Week 1 (2026-02-03 - 2026-02-09)

**Monday - Wednesday**: database-adapter测试修复
**Thursday - Friday**: FFmpeg安装 + 视频测试运行

**目标**:

- [ ] database-adapter: 0个跳过测试
- [ ] video-engine: 45个测试运行
- [ ] 测试通过率: >87%

### Week 2 (2026-02-10 - 2026-02-16)

**Monday - Wednesday**: 失败测试分析和修复
**Thursday - Friday**: 边界测试补充

**目标**:

- [ ] 失败测试: <3%
- [ ] 测试通过率: >90%
- [ ] 新增边界测试: 50+个

---

## 🚀 中期目标 (1个月内)

### 测试覆盖率提升

**当前**: ~85%
**目标**: >90%

**策略**:

1. 补充未覆盖模块的测试
2. 添加边界情况测试
3. 增加集成测试

**重点模块**:

```bash
# 检查覆盖率
npm run test:coverage

# 重点关注低覆盖率模块
grep -A 5 "Coverage" coverage/index.html
```

### 注释覆盖率提升

**当前**: 9.9%
**目标**: 12-15%

**方法**:

- 为复杂算法添加注释
- 为public API添加JSDoc
- 为状态机添加状态说明

**示例**:

```javascript
/**
 * 数据库适配器类
 *
 * 提供统一的接口，自动选择sql.js或SQLCipher
 * 支持平滑迁移和fallback
 *
 * @class DatabaseAdapter
 * @example
 * const adapter = new DatabaseAdapter({
 *   dbPath: '/path/to/db',
 *   encryptionEnabled: true
 * });
 * await adapter.initialize();
 */
class DatabaseAdapter {
  // ...
}
```

### UI组件测试

**目标**: 60%覆盖率

**优先组件**:

1. `FileTree.vue` - 文件树组件
2. `PreviewPanel.vue` - 文件预览面板
3. `ChatPanel.vue` - AI对话面板
4. `ProjectDetailPage.vue` - 项目详情页

**测试框架**:

```bash
npm install --save-dev @vue/test-utils@^2.4.6
```

**示例测试**:

```javascript
import { mount } from '@vue/test-utils';
import FileTree from '@/components/projects/FileTree.vue';

describe('FileTree.vue', () => {
  it('应该渲染文件树', () => {
    const wrapper = mount(FileTree, {
      props: {
        files: [
          { id: 1, name: 'file1.txt', type: 'file' },
          { id: 2, name: 'folder1', type: 'dir' }
        ]
      }
    });

    expect(wrapper.find('.file-tree').exists()).toBe(true);
    expect(wrapper.findAll('.file-item')).toHaveLength(2);
  });

  it('应该响应文件点击事件', async () => {
    const wrapper = mount(FileTree, {
      props: { files: [...] }
    });

    await wrapper.find('.file-item').trigger('click');
    expect(wrapper.emitted('select')).toBeTruthy();
  });
});
```

---

## 📊 长期目标 (Q1 2026)

### E2E测试扩展

**目标**: 10+关键用户流程

**关键流程**:

1. 用户注册/登录
2. 创建/编辑/删除项目
3. 文件同步
4. AI对话
5. U-Key认证
6. 知识库搜索
7. P2P消息
8. 区块链交易
9. 文件预览
10. 项目协作

**Playwright配置**:

```javascript
// playwright.config.js
export default {
  testDir: "./tests/e2e",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "Desktop Firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
};
```

### 性能回归测试

**目标**: 持续监控关键指标

**关键指标**:

- 数据库查询: <1ms
- 文件同步: >1000 files/s
- AI响应: <3s
- 页面加载: <2s
- 内存占用: <500MB

**实施**:

```javascript
// tests/performance/benchmarks.test.js
describe("性能回归测试", () => {
  it("数据库查询应<1ms", async () => {
    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      await db.query("SELECT * FROM projects LIMIT 1");
    }

    const avgTime = (performance.now() - start) / iterations;
    expect(avgTime).toBeLessThan(1);
  });

  it("文件同步应>1000 files/s", async () => {
    const files = generateTestFiles(10000);
    const start = performance.now();

    await syncManager.sync(files);

    const duration = (performance.now() - start) / 1000; // 转为秒
    const filesPerSecond = 10000 / duration;
    expect(filesPerSecond).toBeGreaterThan(1000);
  });
});
```

---

## 🔧 CI/CD集成

### GitHub Actions配置

**文件**: `.github/workflows/test.yml`

```yaml
name: Test Coverage

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [18, 20]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: "npm"

      - name: Install FFmpeg
        run: |
          if [ "$RUNNER_OS" == "Linux" ]; then
            sudo apt-get install -y ffmpeg
          elif [ "$RUNNER_OS" == "macOS" ]; then
            brew install ffmpeg
          elif [ "$RUNNER_OS" == "Windows" ]; then
            choco install ffmpeg
          fi
        shell: bash

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration

      - name: Generate coverage
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage/coverage-final.json
          fail_ci_if_error: true

      - name: Test failure report
        if: failure()
        run: npm run test:reporter
```

### 预提交钩子 (Husky)

**文件**: `.husky/pre-commit`

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

echo "Running pre-commit checks..."

# 运行lint
npm run lint

# 运行快速测试（只测试改动的文件）
npm run test:changed

# 验证构建
npm run build:main

echo "✅ Pre-commit checks passed!"
```

---

## 📚 测试文档完善

### 1. 创建测试指南

**文件**: `docs/development/TESTING_GUIDE.md`

**内容**:

- 测试环境搭建
- 编写测试的最佳实践
- Mock策略指南
- 常见问题FAQ

### 2. 更新README

在 `README.md` 中添加测试部分：

````markdown
## 🧪 测试

### 运行测试

```bash
# 所有测试
npm run test

# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# E2E测试
npm run test:e2e

# 覆盖率报告
npm run test:coverage
```
````

### 测试覆盖率

当前覆盖率：85.7% (目标：>90%)

查看详细报告：[TEST_COVERAGE_REPORT_2026-01-31.md](./TEST_COVERAGE_REPORT_2026-01-31.md)

````

### 3. 编写贡献指南

**文件**: `CONTRIBUTING.md`

添加测试相关章节：

```markdown
## 测试要求

所有PR必须包含相应的测试：

- 新功能：单元测试 + 集成测试
- Bug修复：回归测试
- 重构：保持现有测试通过

### 测试标准

- 测试覆盖率：>80%
- 测试通过率：100%
- 无跳过测试（除非有明确原因）
````

---

## ✅ 验收标准总结

### 本周目标 (2026-02-07前)

- [ ] database-adapter: 7个跳过测试全部修复
- [ ] FFmpeg: 安装完成，video-engine测试运行
- [ ] 失败测试: 分类完成，问题追踪建立
- [ ] 测试通过率: >87%

### 2周目标 (2026-02-14前)

- [ ] 失败测试: <3%
- [ ] 测试通过率: >90%
- [ ] 新增边界测试: 50+个
- [ ] CI/CD: 基础流水线配置完成

### 1月目标 (2026-02-28前)

- [ ] 代码覆盖率: >90%
- [ ] 注释覆盖率: >12%
- [ ] UI组件测试: 60%覆盖率
- [ ] E2E测试: 10+关键流程
- [ ] 性能回归测试: 全部通过
- [ ] 测试文档: 完整

---

## 📞 支持和资源

### 内部资源

- **测试覆盖率报告**: `TEST_COVERAGE_REPORT_2026-01-31.md`
- **Database修复方案**: `tests/unit/database/DATABASE_ADAPTER_TEST_FIX_PLAN.md`
- **已知问题**: `tests/unit/KNOWN_TEST_ISSUES.md`

### 外部资源

- **Vitest文档**: https://vitest.dev/
- **Playwright文档**: https://playwright.dev/
- **测试最佳实践**: https://github.com/goldbergyoni/javascript-testing-best-practices

### 联系方式

- **问题反馈**: https://github.com/anthropics/chainlesschain/issues
- **技术讨论**: 团队Slack #testing频道

---

**文档版本**: v1.0
**最后更新**: 2026-01-31
**下次审查**: 2026-02-07 (7天后)

**状态**: ✅ 行动计划已就绪
**负责人**: 开发团队 + Claude Code
