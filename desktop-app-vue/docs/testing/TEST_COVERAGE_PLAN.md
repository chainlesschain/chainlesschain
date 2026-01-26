# 测试覆盖率提升计划

## 📊 当前覆盖率现状

### 测试统计
- **测试文件总数**: 120个（Unit + Integration + E2E）
- **通过的测试**: 3425个
- **失败的测试**: 203个
- **跳过的测试**: 93个
- **单元测试覆盖率**: ~1-2% （极低）
- **源代码文件**: 732+ 文件
- **已测试模块**: 仅5个核心模块有单元测试

### 覆盖率目标
按照 `vitest.config.ts` 设定的目标:
- 代码行覆盖率: 70%
- 函数覆盖率: 70%
- 分支覆盖率: 70%
- 语句覆盖率: 70%

---

## 🔴 关键未覆盖模块（高优先级）

### 1. 数据库层（0% 覆盖率）- CRITICAL
**风险等级**: 🔴 极高（数据安全）

**未覆盖模块**（12个文件）:
```
src/main/database/
├── database-adapter.js           # 数据库引擎选择（sql.js vs SQLCipher）
├── key-manager.js                # 加密密钥派生（PBKDF2，U-Key集成）
├── sqlcipher-wrapper.js          # SQLCipher AES-256 加密
├── database-migration.js         # Schema 版本管理和自动迁移
├── database-encryption-ipc.js    # 数据库加密IPC
├── database-ipc.js               # 知识库CRUD IPC
├── database-optimizer.js         # 查询优化
├── config-manager.js             # 数据库配置管理
├── better-sqlite-adapter.js      # SQLite适配器
└── ... 其他3个文件
```

**需要测试的场景**:
- ✅ 加密密钥派生正确性（PBKDF2）
- ✅ U-Key PIN验证流程
- ✅ SQLCipher初始化和加密
- ✅ 数据库迁移（v1→v2→v3）
- ✅ 查询注入防护（SQL Injection）
- ✅ 事务回滚机制
- ✅ 并发访问控制

---

### 2. U-Key硬件集成（0% 覆盖率）- CRITICAL
**风险等级**: 🔴 极高（硬件安全）

**未覆盖模块**（15个文件）:
```
src/main/ukey/
├── ukey-manager.js               # 多驱动U-Key管理（6个品牌）
├── ukey-ipc.js                   # U-Key IPC（PIN验证、签名）
├── cross-platform-adapter.js     # 跨平台抽象层
├── simulated-driver.js           # 模拟驱动（开发/测试）
├── pkcs11-driver.js              # PKCS#11标准驱动
├── native-binding.js             # FFI绑定（Koffi）
└── drivers/                      # 6个品牌驱动（新金科、飞天、华大...）
```

**需要测试的场景**:
- ✅ PIN验证（正确/错误PIN）
- ✅ 数字签名生成和验证
- ✅ 证书导入/导出
- ✅ 多品牌U-Key切换
- ✅ 模拟驱动回退机制
- ✅ PKCS#11兼容性

---

### 3. IPC处理器（0% 覆盖率）- CRITICAL
**风险等级**: 🔴 极高（安全边界）

**未覆盖模块**（40+个IPC文件）:
```
src/main/
├── index.js                      # 核心IPC注册（800+行）
├── database-ipc.js               # 数据库操作IPC
├── database-encryption-ipc.js    # 数据库加密IPC
├── blockchain/blockchain-ipc.js  # 区块链交易IPC
├── p2p/p2p-ipc.js               # P2P消息IPC
├── rag/rag-ipc.js               # RAG搜索IPC
├── git/git-ipc.js               # Git操作IPC
└── ... 35+ 其他IPC handlers
```

**需要测试的场景**:
- ✅ 输入验证（XSS、SQL注入防护）
- ✅ 权限检查（未授权访问）
- ✅ 错误处理（异常捕获）
- ✅ 并发请求处理
- ✅ 返回值安全性

---

### 4. P2P网络层（0% 覆盖率）- CRITICAL
**风险等级**: 🔴 极高（网络安全）

**未覆盖模块**（25个文件）:
```
src/main/p2p/
├── p2p-manager.js                # libp2p网络管理
├── connection-pool.js            # 连接池
├── message-manager.js            # 消息路由（Signal Protocol）
├── voice-video-manager.js        # WebRTC音视频
├── file-transfer-manager.js      # P2P文件传输
├── signal-session-manager.js     # Signal协议会话
└── ... 19个其他网络模块
```

**需要测试的场景**:
- ✅ Peer发现和连接建立
- ✅ Signal Protocol端到端加密
- ✅ WebRTC连接协商
- ✅ 大文件传输（断点续传）
- ✅ 连接断开重连机制
- ✅ 消息队列和重试

---

### 5. 区块链集成（5% 覆盖率）- CRITICAL
**风险等级**: 🔴 极高（金融风险）

**未覆盖模块**（22个文件，仅1个测试）:
```
src/main/blockchain/
├── wallet-manager.js             # 钱包管理（私钥处理）⚠️ 未测试
├── blockchain-adapter.js         # Web3提供者（✅ 已测试）
├── blockchain-integration.js     # 交易构建和签名 ⚠️ 未测试
├── bridge-manager.js             # 跨链桥 ⚠️ 未测试
├── transaction-monitor.js        # 交易监控 ⚠️ 未测试
└── ... 17个其他区块链模块
```

**需要测试的场景**:
- ✅ 私钥生成和存储
- ✅ 助记词恢复
- ✅ 交易签名验证
- ✅ Gas费估算
- ✅ 跨链桥安全检查（金额限制）
- ✅ 交易确认状态追踪

---

### 6. RAG检索系统（0% 覆盖率）- HIGH
**风险等级**: 🟠 高（数据完整性）

**未覆盖模块**（7个文件）:
```
src/main/rag/
├── rag-manager.js                # RAG系统编排
├── embeddings-service.js         # 向量嵌入（Ollama/云LLM）
├── reranker.js                   # 结果重排（BM25、语义）
├── query-rewriter.js             # 查询重写
├── text-splitter.js              # 文本分块
└── rag-ipc.js                    # RAG IPC
```

**需要测试的场景**:
- ✅ 向量嵌入生成
- ✅ 相似度搜索准确性
- ✅ BM25排序算法
- ✅ 查询重写效果
- ✅ 分块策略（滑动窗口）

---

### 7. AI引擎（2% 覆盖率）- CRITICAL
**风险等级**: 🔴 极高（核心功能）

**未覆盖模块**（64个文件，仅1个测试）:
```
src/main/ai-engine/
├── ai-engine-manager.js          # AI编排 ⚠️ 未测试
├── ai-engine-ipc.js              # AI IPC ⚠️ 未测试
├── multi-agent/agent-orchestrator.js  # 多智能体 ⚠️ 未测试
├── intent-classifier.js          # 意图识别 ⚠️ 未测试
├── followup-intent-classifier.js # 后续意图（✅ 已测试但有失败用例）
├── response-parser.js            # 响应解析 ⚠️ 未测试
├── task-executor.js              # 任务执行 ⚠️ 未测试
└── ... 57个其他AI模块
```

**需要测试的场景**:
- ✅ LLM提供者切换（Ollama/OpenAI/Claude）
- ✅ 流式响应处理
- ✅ 意图分类准确性
- ✅ 多智能体任务分解
- ✅ 函数调用解析
- ✅ 会话上下文管理

---

### 8. DID身份系统（0% 覆盖率）- CRITICAL
**风险等级**: 🔴 极高（身份安全）

**未覆盖模块**（4个文件）:
```
src/main/did/
├── did-manager.js                # DID生命周期管理
├── did-ipc.js                    # DID IPC
├── did-updater.js                # DID同步
└── did-cache.js                  # DID缓存
```

---

## 🟡 中优先级未覆盖模块

### 9. 文件同步（0% 覆盖率）- MEDIUM
```
src/main/sync/
├── db-sync-manager.js            # 数据库同步
├── p2p-sync-engine.js            # P2P同步协议
├── mobile-sync-manager.js        # 移动端同步
└── ... 9个其他同步模块
```

### 10. 错误监控（0% 覆盖率）- MEDIUM
```
src/main/monitoring/
├── error-handler.js              # 错误捕获
├── error-monitor.js              # 错误监控
├── crash-reporter.js             # 崩溃报告
└── ... 4个其他监控模块
```

### 11. Pinia状态管理（0% 覆盖率）- MEDIUM
```
src/renderer/stores/
├── 23个Pinia store（全部未测试）
├── auth.js, project.js, conversation.js, blockchain.js, etc.
```

---

## 🟢 低优先级未覆盖模块

### 12. 工具/技能系统（7% 覆盖率）- LOW-MEDIUM
- 部分覆盖：`skill-manager.test.js`, `tool-manager.test.js`
- 未覆盖：27个扩展工具文件

### 13. Vue组件（0% 覆盖率）- LOW
- 393个组件未测试
- E2E测试提供部分覆盖

### 14. 渲染器工具（2% 覆盖率）- LOW
- 仅 `file-utils.js` 已测试
- 54个其他工具未测试

---

## 📅 分阶段实施计划

### 第一阶段：关键安全模块（2-4周）

**目标覆盖率**: 80%+ (关键模块)

#### 数据库层测试（1周）
```bash
# 创建测试文件
tests/unit/database/database-adapter.test.js
tests/unit/database/key-manager.test.js
tests/unit/database/sqlcipher-wrapper.test.js
tests/unit/database/database-migration.test.js
```

**关键测试用例**:
- 密钥派生（正确/错误PIN）
- SQLCipher加密初始化
- 数据库迁移（v1→v2）
- SQL注入防护测试

#### U-Key集成测试（1周）
```bash
tests/unit/ukey/ukey-manager.test.js
tests/unit/ukey/cross-platform-adapter.test.js
tests/unit/ukey/simulated-driver.test.js
```

**关键测试用例**:
- 模拟驱动验证
- PIN验证流程
- 签名生成和验证
- 多品牌驱动切换

#### IPC安全测试（1周）
```bash
tests/unit/ipc/ipc-registry.test.js
tests/unit/database-encryption-ipc.test.js
tests/unit/wallet-ipc.test.js
```

**关键测试用例**:
- XSS输入过滤
- SQL注入防护
- 未授权访问拦截
- 错误处理完整性

#### 区块链钱包测试（1周）
```bash
tests/unit/blockchain/wallet-manager.test.js
tests/unit/blockchain/blockchain-integration.test.js
tests/unit/blockchain/bridge-security.test.js
```

**关键测试用例**:
- 私钥生成（BIP39）
- 交易签名验证
- Gas费估算准确性
- 跨链桥限额检查

---

### 第二阶段：核心业务逻辑（2-3周）

**目标覆盖率**: 70%+

#### P2P网络测试（1周）
```bash
tests/unit/p2p/p2p-manager.test.js
tests/unit/p2p/connection-pool.test.js
tests/unit/p2p/signal-session-manager.test.js
```

#### DID身份测试（3天）
```bash
tests/unit/did/did-manager.test.js
tests/unit/did/did-cache.test.js
```

#### RAG检索测试（1周）
```bash
tests/unit/rag/rag-manager.test.js
tests/unit/rag/embeddings-service.test.js
tests/unit/rag/reranker.test.js
```

#### AI引擎测试（1周）
```bash
tests/unit/ai-engine/ai-engine-manager.test.js
tests/unit/ai-engine/intent-classifier.test.js
tests/unit/ai-engine/response-parser.test.js
tests/unit/ai-engine/multi-agent/agent-orchestrator.test.js
```

---

### 第三阶段：辅助功能（2-3周）

**目标覆盖率**: 60%+

#### Pinia Store测试（1周）
```bash
tests/unit/stores/auth.test.ts
tests/unit/stores/project.test.ts
tests/unit/stores/blockchain.test.ts
```

#### 同步管理测试（1周）
```bash
tests/unit/sync/db-sync-manager.test.js
tests/unit/sync/p2p-sync-engine.test.js
```

#### 错误监控测试（3天）
```bash
tests/unit/monitoring/error-handler.test.js
tests/unit/monitoring/crash-reporter.test.js
```

#### Git管理测试（3天）
```bash
tests/unit/git/git-manager.test.js
tests/unit/git/git-auto-commit.test.js
```

---

### 第四阶段：UI和工具（1-2周）

**目标覆盖率**: 50%+

#### 渲染器工具测试（5天）
```bash
tests/unit/renderer/utils/*.test.ts (54个文件)
```

#### Vue组件测试（选择性）（5天）
```bash
# 仅测试关键组件
tests/unit/components/blockchain/*.test.ts
tests/unit/components/chat/*.test.ts
```

---

## 🛠️ 测试工具和最佳实践

### 测试框架
- **单元测试**: Vitest + @vue/test-utils
- **E2E测试**: Playwright（已配置）
- **覆盖率工具**: @vitest/coverage-v8

### Mock策略
```javascript
// 数据库Mock
vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: vi.fn(() => mockDb)
}));

// Electron Mock
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/path') },
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}));

// LLM Mock
vi.mock('@/llm/llm-service', () => ({
  callLLM: vi.fn(() => Promise.resolve({ text: 'mocked response' }))
}));
```

### 测试命名规范
```javascript
describe('ModuleName', () => {
  describe('methodName', () => {
    it('应该在正常情况下返回预期结果', () => {});
    it('应该在输入无效时抛出错误', () => {});
    it('应该处理边界情况（空值、极大值）', () => {});
  });
});
```

---

## 📊 覆盖率监控

### 生成覆盖率报告
```bash
# 运行测试并生成覆盖率报告
npm run test:coverage

# 查看HTML报告
open coverage/index.html  # macOS
start coverage/index.html # Windows
```

### CI/CD集成
```yaml
# .github/workflows/test.yml
- name: Run tests with coverage
  run: npm run test:coverage
- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

---

## ✅ 成功标准

### 第一阶段完成标准
- [ ] 数据库层覆盖率 ≥ 80%
- [ ] U-Key集成覆盖率 ≥ 75%（模拟驱动100%）
- [ ] 核心IPC覆盖率 ≥ 70%
- [ ] 区块链钱包覆盖率 ≥ 80%

### 第二阶段完成标准
- [ ] P2P网络覆盖率 ≥ 70%
- [ ] DID身份覆盖率 ≥ 75%
- [ ] RAG系统覆盖率 ≥ 70%
- [ ] AI引擎覆盖率 ≥ 65%

### 第三阶段完成标准
- [ ] Pinia Store覆盖率 ≥ 60%
- [ ] 同步管理覆盖率 ≥ 60%
- [ ] 错误监控覆盖率 ≥ 70%

### 最终目标（8-12周后）
- [ ] 总体代码覆盖率 ≥ 70%
- [ ] 关键模块覆盖率 ≥ 80%
- [ ] 所有失败测试修复完毕
- [ ] CI/CD自动化覆盖率检查

---

## 📝 下一步行动

### 立即可执行的任务
1. **修复现有失败测试**（203个失败测试）
   ```bash
   npm run test:unit 2>&1 | grep "FAIL" > failing-tests.txt
   ```

2. **创建第一个数据库测试**
   ```bash
   mkdir -p tests/unit/database
   touch tests/unit/database/database-adapter.test.js
   ```

3. **配置覆盖率阈值**
   ```bash
   # 在 package.json 添加覆盖率检查
   "test:coverage:check": "vitest run --coverage --coverage.thresholds.lines=70"
   ```

4. **建立测试文档**
   ```bash
   # 创建测试编写指南
   touch docs/TESTING_GUIDELINES.md
   ```

---

## 📚 参考资源

- [Vitest官方文档](https://vitest.dev/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Playwright E2E测试](https://playwright.dev/)
- [测试覆盖率最佳实践](https://martinfowler.com/bliki/TestCoverage.html)

---

**最后更新**: 2026-01-25
**维护者**: ChainlessChain Team
