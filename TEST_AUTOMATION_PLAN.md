# ChainlessChain 自动化测试计划

## 📋 测试现状分析

### 已有测试基础设施
- **桌面应用**: Vitest (单元/集成) + Playwright (E2E)
- **后端服务**: JUnit (Java) + pytest (Python)
- **测试覆盖率目标**: 70%
- **现有测试文件**: ~20个测试文件

### 功能模块清单
1. **知识库管理** - 笔记、RAG检索、向量数据库
2. **项目管理** - CRUD、文件操作、项目分类
3. **AI助手** - 代码生成、代码执行、LLM集成
4. **U-Key集成** - 硬件检测、加密/解密、签名验证
5. **Git同步** - 提交、推送、拉取、冲突解决
6. **P2P网络** - 消息加密、离线队列、多设备同步
7. **DID身份** - 身份创建、凭证管理
8. **社交功能** - 好友关系、帖子、评论
9. **交易系统** - 数字资产、市场、智能合约
10. **数据库操作** - SQLite/SQLCipher CRUD

---

## 🏗️ 测试架构设计

### 测试金字塔分层

```
           ╱╲
          ╱E2E╲ (10% - 端到端测试)
         ╱      ╲
        ╱────────╲
       ╱ 集成测试  ╲ (30% - API/IPC/数据库集成)
      ╱            ╲
     ╱──────────────╲
    ╱   单元测试      ╲ (60% - 纯函数/组件逻辑)
   ╱──────────────────╲
```

### 测试工具栈

| 测试类型 | 工具 | 覆盖范围 |
|---------|------|---------|
| **单元测试** | Vitest + @vue/test-utils | Vue组件、工具函数 |
| **集成测试** | Vitest + Mock IPC | 数据库、IPC通信、文件操作 |
| **E2E测试** | Playwright | 完整用户流程 |
| **性能测试** | Vitest + Performance API | 数据库查询、向量检索 |
| **后端API测试** | JUnit + MockMvc / pytest | REST API端点 |
| **Bug自动检测** | ESLint + TypeScript + 自定义脚本 | 代码质量、类型错误 |

---

## 📝 详细测试套件设计

### 1. 桌面应用单元测试 (60%)

#### 1.1 Vue组件测试
```typescript
// tests/unit/components/
- ChatPanel.test.ts
- ProjectTree.test.ts
- NoteEditor.test.ts
- UKeyStatus.test.ts
- ProjectDetailPage.test.ts
- SettingsPanel.test.ts
```

**测试内容**:
- 组件渲染正确
- Props传递
- Event触发
- 计算属性
- 响应式状态更新

#### 1.2 工具函数测试
```typescript
// tests/unit/utils/
- string-utils.test.ts
- date-utils.test.ts
- crypto-utils.test.ts
- file-utils.test.ts
- validation.test.ts
```

#### 1.3 Pinia Store测试
```typescript
// tests/unit/stores/
- project-store.test.ts
- note-store.test.ts
- user-store.test.ts
- chat-store.test.ts
```

**测试内容**:
- Action执行
- State变更
- Getters计算
- 异步操作

### 2. 集成测试 (30%)

#### 2.1 数据库集成测试
```javascript
// tests/integration/database/
- notes-crud.test.js
- projects-crud.test.js
- chat-history.test.js
- did-management.test.js
- p2p-messages.test.js
- social-posts.test.js
- encryption.test.js (SQLCipher)
```

**测试内容**:
- CRUD操作
- 事务处理
- 外键约束
- 数据加密
- 索引性能
- 并发写入

#### 2.2 IPC通信测试
```javascript
// tests/integration/ipc/
- project-ipc.test.js
- code-execution-ipc.test.js
- file-system-ipc.test.js
- llm-service-ipc.test.js
- git-operations-ipc.test.js
```

**测试内容**:
- Renderer → Main通信
- 数据序列化/反序列化
- 错误处理
- 超时处理

#### 2.3 外部服务集成测试
```javascript
// tests/integration/services/
- ollama-service.test.js
- qdrant-service.test.js
- chromadb-service.test.js
- project-service-api.test.js
- ai-service-api.test.js
```

**测试内容**:
- API连接性
- 请求/响应格式
- 错误处理
- 超时重试

#### 2.4 U-Key硬件测试
```javascript
// tests/integration/hardware/
- ukey-detection.test.js
- ukey-encryption.test.js
- ukey-signing.test.js
- ukey-simulation.test.js
```

#### 2.5 Git同步测试
```javascript
// tests/integration/git/
- git-init.test.js
- git-commit.test.js
- git-sync.test.js
- conflict-resolution.test.js
```

#### 2.6 P2P网络测试
```javascript
// tests/integration/p2p/
- peer-discovery.test.js
- message-encryption.test.js
- offline-queue.test.js
- multi-device-sync.test.js
```

### 3. E2E端到端测试 (10%)

#### 3.1 核心用户流程
```typescript
// tests/e2e/workflows/
- user-onboarding.e2e.test.ts
- note-creation-and-search.e2e.test.ts
- project-management.e2e.test.ts
- ai-chat-conversation.e2e.test.ts
- code-generation-execution.e2e.test.ts
- git-sync-workflow.e2e.test.ts
- p2p-messaging.e2e.test.ts
```

**测试场景**:

**3.1.1 用户入门流程**
```
1. 启动应用
2. 初始化U-Key (或模拟模式)
3. 创建第一个笔记
4. 搜索笔记
5. 配置LLM服务
6. 测试AI聊天
```

**3.1.2 项目管理完整流程**
```
1. 创建新项目
2. 添加文件到项目
3. 编辑文件内容
4. 执行代码
5. 查看执行结果
6. Git提交 (如果配置)
7. 删除项目
```

**3.1.3 AI辅助编码流程**
```
1. 打开代码编辑器
2. 输入代码生成提示
3. 生成代码
4. 执行生成的代码
5. 查看结果
6. 生成单元测试
7. 代码审查
```

### 4. 性能测试

```javascript
// tests/performance/
- database-query-performance.test.js
- vector-search-performance.test.js
- large-file-import.test.js
- concurrent-operations.test.js
- memory-leak-detection.test.js
```

**性能指标**:
- 数据库查询 < 50ms
- 向量检索 (1000条) < 200ms
- 文件导入 (10MB) < 3s
- 并发用户操作 (10并发) 无崩溃
- 内存增长 < 100MB/小时

### 5. 后端服务测试

#### 5.1 Project Service (Java/Spring Boot)
```java
// backend/project-service/src/test/java/
- ProjectControllerTest.java
- ProjectServiceTest.java
- FileOperationTest.java
- GitIntegrationTest.java
- DatabaseRepositoryTest.java
```

**测试内容**:
- REST API端点
- 业务逻辑
- 数据库操作
- Git集成
- 异常处理

#### 5.2 AI Service (Python/FastAPI)
```python
# backend/ai-service/tests/
- test_llm_inference.py
- test_rag_retrieval.py
- test_embeddings.py
- test_code_generation.py
- test_streaming.py
```

**测试内容**:
- LLM推理
- RAG检索
- Embeddings生成
- 流式响应
- 错误处理

---

## 🤖 自动化Bug检测与修复机制

### 第一层: 静态分析 (预防)

#### 1. 代码质量检查
```json
// .eslintrc.json
{
  "extends": [
    "eslint:recommended",
    "plugin:vue/vue3-recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "no-console": "warn",
    "no-unused-vars": "error",
    "no-undef": "error",
    "vue/no-unused-components": "error"
  }
}
```

#### 2. TypeScript类型检查
```bash
npm run type-check
```

#### 3. 安全漏洞扫描
```bash
npm audit
npm audit fix --force
```

### 第二层: 运行时检测 (发现)

#### 1. 错误监控系统
```javascript
// src/main/error-monitor.js
class ErrorMonitor {
  constructor() {
    this.errors = [];
    this.setupGlobalErrorHandler();
  }

  setupGlobalErrorHandler() {
    process.on('uncaughtException', (error) => {
      this.captureError('UNCAUGHT_EXCEPTION', error);
    });

    process.on('unhandledRejection', (error) => {
      this.captureError('UNHANDLED_REJECTION', error);
    });
  }

  captureError(type, error) {
    const errorReport = {
      type,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };

    this.errors.push(errorReport);
    this.analyzeAndFix(errorReport);
  }

  analyzeAndFix(errorReport) {
    // 尝试自动修复常见问题
    if (errorReport.message.includes('ECONNREFUSED')) {
      this.attemptServiceReconnection();
    } else if (errorReport.message.includes('SQLITE_BUSY')) {
      this.resolveDatabaseLock();
    }
  }
}
```

#### 2. 健康检查系统
```javascript
// tests/health-check.js
const healthChecks = {
  database: async () => {
    // 检查数据库连接
  },
  ollama: async () => {
    // 检查Ollama服务
  },
  qdrant: async () => {
    // 检查Qdrant服务
  },
  ukey: async () => {
    // 检查U-Key状态
  }
};

async function runHealthChecks() {
  const results = {};
  for (const [name, check] of Object.entries(healthChecks)) {
    try {
      await check();
      results[name] = 'PASS';
    } catch (error) {
      results[name] = 'FAIL';
      await attemptAutoFix(name, error);
    }
  }
  return results;
}
```

### 第三层: 自动修复 (修复)

#### 1. 自动修复策略
```javascript
// scripts/auto-fix.js
const fixStrategies = {
  // 数据库锁定问题
  'SQLITE_BUSY': async () => {
    await closeAllConnections();
    await reopenDatabase();
  },

  // 服务连接失败
  'ECONNREFUSED': async () => {
    await restartDockerServices();
    await waitForServiceReady();
  },

  // 内存泄漏
  'MEMORY_LEAK': async () => {
    await clearCaches();
    await garbageCollect();
  },

  // 文件权限问题
  'EACCES': async (filePath) => {
    await fixFilePermissions(filePath);
  }
};
```

#### 2. 智能重试机制
```javascript
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.pow(2, i) * 1000;
      await sleep(delay);
    }
  }
}
```

#### 3. 回滚机制
```javascript
class StateManager {
  constructor() {
    this.snapshots = [];
  }

  async createSnapshot() {
    const snapshot = {
      database: await backupDatabase(),
      config: await backupConfig(),
      timestamp: Date.now()
    };
    this.snapshots.push(snapshot);
  }

  async rollback() {
    const lastSnapshot = this.snapshots.pop();
    if (lastSnapshot) {
      await restoreDatabase(lastSnapshot.database);
      await restoreConfig(lastSnapshot.config);
    }
  }
}
```

---

## 🔄 持续集成测试流水线

### GitHub Actions配置

```yaml
# .github/workflows/test.yml
name: Automated Testing Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨2点运行

jobs:
  # 阶段1: 代码质量检查
  code-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: |
          cd desktop-app-vue
          npm install

      - name: Run ESLint
        run: npm run lint

      - name: Run TypeScript check
        run: npm run type-check

      - name: Security audit
        run: npm audit --audit-level=moderate

  # 阶段2: 单元测试
  unit-tests:
    runs-on: ubuntu-latest
    needs: code-quality
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3

      - name: Install dependencies
        run: |
          cd desktop-app-vue
          npm install

      - name: Run unit tests
        run: npm run test:unit

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  # 阶段3: 集成测试
  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: chainlesschain_pwd_2024
        options: >-
          --health-cmd pg_isready
          --health-interval 10s

      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s

    steps:
      - uses: actions/checkout@v3

      - name: Setup Docker Compose
        run: docker-compose up -d

      - name: Wait for services
        run: |
          ./scripts/wait-for-services.sh

      - name: Run integration tests
        run: npm run test:integration

  # 阶段4: E2E测试
  e2e-tests:
    runs-on: ${{ matrix.os }}
    needs: integration-tests
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3

      - name: Install dependencies
        run: |
          cd desktop-app-vue
          npm install

      - name: Install Playwright
        run: npx playwright install

      - name: Build application
        run: npm run build

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report-${{ matrix.os }}
          path: playwright-report/

  # 阶段5: 性能测试
  performance-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    steps:
      - uses: actions/checkout@v3

      - name: Run performance tests
        run: npm run test:performance

      - name: Check performance metrics
        run: node scripts/check-performance-metrics.js

  # 阶段6: 后端服务测试
  backend-tests:
    runs-on: ubuntu-latest
    needs: code-quality
    steps:
      - uses: actions/checkout@v3

      - name: Setup Java
        uses: actions/setup-java@v3
        with:
          java-version: '17'

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Test Project Service
        run: |
          cd backend/project-service
          mvn test

      - name: Test AI Service
        run: |
          cd backend/ai-service
          pip install -r requirements.txt
          pytest

  # 阶段7: 自动修复检测
  auto-fix-detection:
    runs-on: ubuntu-latest
    if: failure()
    needs: [unit-tests, integration-tests, e2e-tests]
    steps:
      - name: Analyze failures
        run: node scripts/analyze-test-failures.js

      - name: Attempt auto-fix
        run: node scripts/auto-fix-runner.js

      - name: Create issue if unfixable
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: 'Automated Test Failure Detected',
              body: 'See workflow run for details',
              labels: ['bug', 'automated-detection']
            })
```

### 本地预提交钩子

```bash
# .git/hooks/pre-commit
#!/bin/bash

echo "Running pre-commit tests..."

# 运行快速测试
npm run lint
npm run type-check
npm run test:unit

if [ $? -ne 0 ]; then
  echo "Tests failed. Commit aborted."
  exit 1
fi

echo "All tests passed!"
```

---

## 📊 测试报告与监控

### 1. 测试覆盖率报告
```bash
npm run test:coverage
# 生成HTML报告: coverage/index.html
```

### 2. 性能基准报告
```javascript
// scripts/generate-performance-report.js
const results = {
  database_query_avg: '45ms',
  vector_search_avg: '180ms',
  file_import_avg: '2.5s',
  memory_usage: '250MB'
};
```

### 3. 测试趋势分析
- 每日测试通过率
- 覆盖率变化趋势
- 性能指标历史
- Bug修复率

---

## 🚀 实施路线图

### 第1周: 基础设施完善
- [ ] 完善Vitest和Playwright配置
- [ ] 创建测试数据工厂
- [ ] 设置Mock服务
- [ ] 配置CI/CD管道

### 第2周: 单元测试扩展
- [ ] 完成所有Vue组件测试
- [ ] 完成工具函数测试
- [ ] 完成Store测试
- [ ] 覆盖率达到60%

### 第3周: 集成测试
- [ ] 数据库集成测试
- [ ] IPC通信测试
- [ ] 外部服务集成测试
- [ ] U-Key和Git测试

### 第4周: E2E测试
- [ ] 核心用户流程测试
- [ ] 跨平台测试
- [ ] 异常场景测试

### 第5周: 自动化与监控
- [ ] 实现错误监控系统
- [ ] 实现自动修复机制
- [ ] 配置健康检查
- [ ] 部署CI/CD流水线

---

## 📚 测试最佳实践

### 1. 测试命名规范
```javascript
// ✅ 好的命名
describe('UserService.createUser', () => {
  it('should create user with valid data', async () => {});
  it('should throw error when email is invalid', async () => {});
  it('should hash password before saving', async () => {});
});

// ❌ 差的命名
describe('test', () => {
  it('works', () => {});
});
```

### 2. AAA模式 (Arrange-Act-Assert)
```javascript
it('should calculate total price correctly', () => {
  // Arrange - 准备测试数据
  const cart = { items: [{ price: 10, quantity: 2 }] };

  // Act - 执行操作
  const total = calculateTotal(cart);

  // Assert - 验证结果
  expect(total).toBe(20);
});
```

### 3. 测试隔离
```javascript
describe('Database tests', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  it('test case 1', () => {});
  it('test case 2', () => {});
});
```

### 4. Mock外部依赖
```javascript
vi.mock('axios');
axios.get.mockResolvedValue({ data: { success: true } });
```

### 5. 快照测试
```javascript
it('renders correctly', () => {
  const wrapper = mount(Component);
  expect(wrapper.html()).toMatchSnapshot();
});
```

---

## 🎯 成功指标

### 短期目标 (1个月)
- ✅ 单元测试覆盖率 > 60%
- ✅ 集成测试覆盖率 > 30%
- ✅ E2E测试覆盖率 > 10%
- ✅ CI/CD流水线正常运行
- ✅ 每次提交自动运行测试

### 中期目标 (3个月)
- ✅ 总体测试覆盖率 > 70%
- ✅ 关键路径100%覆盖
- ✅ 自动修复成功率 > 50%
- ✅ 平均修复时间 < 1小时
- ✅ 零手动测试依赖

### 长期目标 (6个月)
- ✅ 总体测试覆盖率 > 85%
- ✅ 生产环境零严重bug
- ✅ 自动修复成功率 > 80%
- ✅ 持续部署自动化
- ✅ 性能回归自动检测

---

## 📞 问题反馈

遇到测试相关问题,请:
1. 查看测试日志: `npm run test -- --reporter=verbose`
2. 生成覆盖率报告: `npm run test:coverage`
3. 运行单个测试: `npm run test -- path/to/test.js`
4. 提交Issue到GitHub仓库

---

**文档版本**: 1.0.0
**最后更新**: 2025-12-28
**维护者**: ChainlessChain Team
