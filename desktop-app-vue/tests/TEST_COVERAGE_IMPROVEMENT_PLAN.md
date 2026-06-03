# PC端测试覆盖率提升实施计划

## 执行摘要

**目标**: 提升desktop-app-vue的测试覆盖率从当前水平至70%+（满足vitest.config.ts阈值）

**策略**: 安全关键模块优先 → 核心业务模块 → P2P网络栈
**时间**: 4周（3个Phase）
**测试深度**: 关键路径覆盖（60-70%）

**当前状态**:
- 总测试文件: 276个
- 测试框架: Vitest 3.0.0 (unit/integration) + Playwright 1.57.0 (e2e)
- 覆盖率配置: v8 provider, 70%阈值
- 关键缺口: 核心业务模块存在严重测试缺失

**关键发现**:
- LLM Session Manager (70.6K行) - 0%覆盖
- AI Engine (57个文件) - 仅12%覆盖
- 安全模块 (Secure Config, PKCS11) - 未测试
- P2P网络 (25个文件) - 仅集成测试

---

## Phase 1: 安全关键模块 (第1周)

**目标**: 覆盖最高风险的安全和加密模块

### 新增测试文件 (5个)

#### 1.1 LLM安全配置存储
**文件**: `tests/unit/llm/secure-config-storage.test.js`
**测试目标**: `src/main/llm/secure-config-storage.js` (23.2K行)

**关键测试场景** (80-90个用例):
- 三层加密策略: Electron safeStorage → AES-256-GCM → 密码加密
- 14+个LLM提供商API Key验证 (OpenAI, Anthropic, DeepSeek, Volcengine等)
- 正则验证 (API_KEY_PATTERNS: sk-*, AIza*, UUID格式等)
- 加密/解密roundtrip正确性
- Fallback机制 (safeStorage不可用时降级)
- 机器特征派生密钥 (PBKDF2, 100000次迭代)
- 敏感字段检测 (SENSITIVE_FIELDS列表)
- 错误处理: 损坏数据、无效密钥、后端不可用

**Mock策略**:
```javascript
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock/path') },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((text) => Buffer.from('encrypted-' + text)),
    decryptString: vi.fn((buffer) => buffer.toString().replace('encrypted-', ''))
  }
}));

// Mock crypto for deterministic AES
vi.mock('crypto', () => ({
  randomBytes: vi.fn((size) => Buffer.alloc(size).fill(0xAA)),
  createCipheriv: vi.fn(),
  createDecipheriv: vi.fn(),
  pbkdf2Sync: vi.fn()
}));
```

---

#### 1.2 LLM会话管理器
**文件**: `tests/unit/llm/session-manager.test.js`
**测试目标**: `src/main/llm/session-manager.js` (70.6K行 - 最大未测试文件)

**关键测试场景** (130-150个用例):
- 构造函数: 12个配置选项验证 (maxHistoryMessages, compressionThreshold等)
- EventEmitter事件: session-created, session-saved, compression-triggered
- 会话生命周期: create → save → load → resume
- 自动压缩触发 (compressionThreshold=10 messages)
- PromptCompressor集成 (验证30-40% token减少)
- 自动摘要生成 (autoSummaryThreshold=5, interval=5min)
- 后台任务调度 (定时器管理, _backgroundSummaryTimer)
- 会话持久化到 `.chainlesschain/memory/sessions/`
- Cache命中/未命中 (Map-based sessionCache)
- 数据库元数据存储
- 错误恢复: 损坏的session文件、缺失目录

**Mock策略**:
```javascript
// Mock database
const mockDb = {
  prepare: vi.fn().mockReturnValue({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn()
  })
};

// Mock PromptCompressor
vi.mock('../../../src/main/llm/prompt-compressor.js', () => ({
  PromptCompressor: vi.fn().mockImplementation(() => ({
    compress: vi.fn((messages) => messages.slice(-5)),
    getStats: vi.fn(() => ({ compressionRatio: 0.65 }))
  }))
}));

// Mock fs.promises
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(JSON.stringify({ messages: [] }))
  }
}));
```

---

#### 1.3 U-Key PKCS11驱动
**文件**: `tests/unit/ukey/pkcs11-driver.test.js`
**测试目标**: `src/main/ukey/pkcs11-driver.js` (36.4K行)

**关键测试场景** (90-100个用例):
- PKCS#11库加载 (OpenSC, YubiKey路径检测)
- 跨平台路径解析 (macOS: /usr/local/lib, Linux: /usr/lib, Windows: C:\Program Files)
- PIN验证与重试计数
- RSA操作: C_Sign, C_Decrypt, C_Verify (CKM_RSA_PKCS机制)
- SM2操作: 中国国密算法支持
- 会话管理: C_OpenSession (CKF_SERIAL_SESSION | CKF_RW_SESSION)
- 密钥枚举: C_FindObjectsInit → C_FindObjects
- CLI fallback模式 (pkcs11-tool调用)
- 错误代码映射 (CKR_PIN_LOCKED, CKR_TOKEN_NOT_PRESENT等)
- 内存安全: 敏感数据清零

**Mock策略**:
```javascript
vi.mock('pkcs11-js', () => ({
  default: vi.fn().mockImplementation(() => ({
    C_Initialize: vi.fn(),
    C_GetSlotList: vi.fn(() => [1]),
    C_OpenSession: vi.fn(() => ({ handle: 1 })),
    C_Login: vi.fn(),
    C_FindObjectsInit: vi.fn(),
    C_FindObjects: vi.fn(() => [{ handle: 100 }]),
    C_Sign: vi.fn(() => Buffer.from('signature')),
    C_Decrypt: vi.fn(() => Buffer.from('decrypted')),
    C_CloseSession: vi.fn(),
    C_Finalize: vi.fn()
  }))
}));
```

---

#### 1.4 数据库加密扩展测试
**文件**: `tests/unit/database/sqlcipher-wrapper-extended.test.js`
**测试目标**: `src/main/database/sqlcipher-wrapper.js`

**关键测试场景** (65-70个用例):
- AES-256加密密钥派生
- Pragma安全设置: cipher_page_size=4096, kdf_iter=256000
- 密钥轮换 (不丢失数据)
- 加密备份/恢复
- 性能影响测量 (加密 vs 未加密)
- 内存锁定 (密钥材料)
- 并发访问 (加密环境下)
- 迁移: 未加密 → 加密数据库

---

#### 1.5 MCP安全策略
**文件**: `tests/unit/mcp/mcp-security-policy.test.js`
**测试目标**: `src/main/mcp/mcp-security-policy.js` (25K行)

**关键测试场景** (95-100个用例):
- 路径规范化 (Windows: C:\, Unix: /, 大小写敏感性)
- 模式匹配 (通配符: *, **)
- 允许列表/阻止列表执行
- 用户同意提示
- 审计日志生成
- 路径遍历攻击防御 (../, ../../etc/passwd)
- 跨平台路径处理 (backslash vs forward slash)
- SecurityError生成 (详细错误信息)

**Mock策略**:
```javascript
vi.mock('electron', () => ({
  dialog: {
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) // Allow
  }
}));
```

### Phase 1 成果
- **新增测试**: 5个文件, 460-510个用例
- **覆盖率提升**: +15%
- **关键风险降低**: 安全漏洞、加密错误、权限绕过

---

## Phase 2: 核心业务模块 (第2-3周)

**目标**: 覆盖RAG、DID、AI Engine核心智能模块

### 新增测试文件 (28个)

#### 2.1 RAG组件 (5个文件)

##### 2.1.1 Embeddings Service
**文件**: `tests/unit/rag/embeddings-service.test.js`
**测试目标**: `src/main/rag/embeddings-service.js`

**关键场景** (55个用例):
- LRU cache vs Map fallback
- 嵌入生成 (与LLM集成)
- Cache命中/未命中追踪
- 简单嵌入fallback (LLM不可用时)
- 批量嵌入生成
- 相似度计算 (cosine similarity)

##### 2.1.2 Reranker
**文件**: `tests/unit/rag/reranker.test.js`
**估算**: 45个用例 (Cross-encoder重排, BM25集成, Top-K选择)

##### 2.1.3 Query Rewriter
**文件**: `tests/unit/rag/query-rewriter.test.js`
**估算**: 40个用例 (查询扩展, 同义词替换, 多查询生成)

##### 2.1.4 Text Splitter
**文件**: `tests/unit/rag/text-splitter.test.js`
**估算**: 50个用例 (递归分割, Markdown感知, 代码感知, 重叠处理)

##### 2.1.5 RAG Metrics
**文件**: `tests/unit/rag/metrics.test.js`
**估算**: 35个用例 (Precision/Recall, MRR, NDCG, 性能指标)

---

#### 2.2 DID模块 (4个文件)

##### 2.2.1 DID Manager
**文件**: `tests/unit/did/did-manager.test.js`
**测试目标**: `src/main/did/did-manager.js`

**关键场景** (90个用例):
- DID创建 (did:chainlesschain:uuid格式)
- Ed25519密钥对生成 (签名)
- X25519密钥对生成 (加密)
- BIP39助记词生成/恢复 (12/24词)
- DID文档序列化 (W3C标准)
- 数据库持久化
- DID Cache集成
- DID Updater集成
- P2P发布

**Mock策略**:
```javascript
vi.mock('tweetnacl', () => ({
  sign: {
    keyPair: vi.fn(() => ({
      publicKey: new Uint8Array(32).fill(1),
      secretKey: new Uint8Array(64).fill(2)
    }))
  },
  box: {
    keyPair: vi.fn(() => ({
      publicKey: new Uint8Array(32).fill(3),
      secretKey: new Uint8Array(32).fill(4)
    }))
  }
}));

vi.mock('bip39', () => ({
  generateMnemonic: vi.fn(() => 'abandon abandon abandon...'),
  mnemonicToSeedSync: vi.fn(() => Buffer.alloc(64).fill(5))
}));
```

##### 2.2.2 DID Cache
**文件**: `tests/unit/did/did-cache.test.js`
**估算**: 40个用例 (Cache CRUD, 过期策略, LRU淘汰)

##### 2.2.3 DID Updater
**文件**: `tests/unit/did/did-updater.test.js`
**估算**: 45个用例 (更新检测, 版本控制, 冲突解决)

##### 2.2.4 DID IPC
**文件**: `tests/unit/did/did-ipc.test.js`
**估算**: 35个用例 (参照 `tests/unit/database/database-ipc.test.js` 模式)

---

#### 2.3 AI Engine扩展工具 (14个文件)

##### 2.3.1 Data Science Tools
**文件**: `tests/unit/ai-engine/extended-tools-datascience.test.js`
**测试目标**: `src/main/ai-engine/extended-tools-datascience.js`

**关键场景** (45个用例):
- Python脚本执行包装器
- 数据预处理 (remove_duplicates, handle_missing等)
- pandas/numpy/sklearn集成
- 临时文件清理
- Python执行失败错误处理
- 统计收集 (duplicatesRemoved, missingValuesHandled)

**Mock策略**:
```javascript
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn((event, cb) => event === 'data' && cb('{"success": true}')) },
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => event === 'close' && cb(0))
  }))
}));
```

##### 其他扩展工具 (13个文件)
- `extended-tools-office.test.js` (45个用例)
- `extended-tools-project.test.js` (45个用例)
- `extended-tools-2.test.js` 至 `extended-tools-12.test.js` (各45个用例)

**总计**: ~630个用例

---

#### 2.4 Multi-Agent系统 (4个文件)

##### 2.4.1 Agent Orchestrator
**文件**: `tests/unit/ai-engine/multi-agent/agent-orchestrator.test.js`
**测试目标**: `src/main/ai-engine/multi-agent/agent-orchestrator.js`

**关键场景** (70个用例):
- Agent注册/管理
- 任务路由/分发
- 并行执行协调 (maxParallelAgents=3)
- 消息队列处理
- 执行历史追踪 (maxHistory=100)
- Agent超时执行 (60s默认)
- 统计收集 (totalTasks, completedTasks, failedTasks)
- Agent使用追踪 (调用次数, 成功/失败)

##### 其他Multi-Agent组件
- `specialized-agent.test.js` (50个用例)
- `multi-agent-ipc.test.js` (35个用例)
- `index.test.js` (25个用例)

### Phase 2 成果
- **新增测试**: 28个文件, 1145个用例
- **覆盖率提升**: +35%
- **关键模块**: RAG, DID, AI扩展工具全面覆盖

---

## Phase 3: P2P网络栈与集成 (第4周)

**目标**: 覆盖P2P管理器, 增加集成测试

### 新增测试文件 (15个)

#### 3.1 P2P管理器单元测试 (10个)

**新文件列表**:
1. `tests/unit/p2p/connection-health-manager.test.js` (45用例)
2. `tests/unit/p2p/connection-pool.test.js` (40用例)
3. `tests/unit/p2p/device-manager.test.js` (50用例)
4. `tests/unit/p2p/file-transfer-manager.test.js` (55用例)
5. `tests/unit/p2p/knowledge-sync-manager.test.js` (50用例)
6. `tests/unit/p2p/message-manager.test.js` (45用例)
7. `tests/unit/p2p/nat-detector.test.js` (35用例)
8. `tests/unit/p2p/transport-diagnostics.test.js` (40用例)
9. `tests/unit/p2p/webrtc-quality-monitor.test.js` (45用例)
10. `tests/unit/p2p/call-history-manager.test.js` (40用例)

**通用Mock模式** (复用 `tests/setup.ts` 中的wrtc-compat mock):
```javascript
// lines 213-310: MockPeerConnection, MockMediaStream已提供

vi.mock('../../../src/main/p2p/p2p-manager.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    emit: vi.fn(),
    on: vi.fn(),
    peers: new Map()
  }))
}));
```

---

#### 3.2 集成测试 (5个)

##### 3.2.1 LLM Session + Compression集成
**文件**: `tests/integration/llm-session-compression.test.js`
**场景** (25用例): 端到端会话生命周期, token减少验证, 数据库roundtrip

##### 3.2.2 RAG Pipeline集成
**文件**: `tests/integration/rag-pipeline.test.js`
**场景** (30用例): TextSplitter → Embeddings → Reranker完整流水线

##### 3.2.3 DID + P2P集成
**文件**: `tests/integration/did-p2p-integration.test.js`
**场景** (25用例): DID创建 → P2P发布 → DHT解析 → 身份验证

##### 3.2.4 MCP Security Policy集成
**文件**: `tests/integration/mcp-security-integration.test.js`
**场景** (30用例): MCP服务器初始化 + 安全策略执行 + 审计日志

##### 3.2.5 Multi-Agent + LLM集成
**文件**: `tests/integration/multi-agent-llm.test.js`
**场景** (25用例): Agent协调器 + LLM调用 + 任务聚合 + 并行执行

### Phase 3 成果
- **新增测试**: 15个文件, 580个用例
- **覆盖率提升**: +20%
- **达成目标**: 70%+整体覆盖率

---

## 测试模式与标准

### 复用的Mock模式

**来源: tests/setup.ts**
- Electron API mock (lines 13-55)
- Logger mock (lines 58-84)
- IPC guard mock (lines 181-210)
- wrtc-compat mock (lines 213-310)
- localStorage/sessionStorage (lines 396-409)

**来源: tests/unit/llm/llm-manager.test.js**
- LLM客户端mocks (lines 41-102)
- Manus优化mock (lines 105-118)

**来源: tests/unit/database/database.test.js**
- 数据库query/run mocks (lines 16-25)

### 测试结构模板

```javascript
/**
 * [模块名] 单元测试
 * 测试目标: src/main/[module-path].js
 * 覆盖场景: [关键功能列表]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// CRITICAL: Mock ALL dependencies BEFORE any imports
// ============================================================

// [依赖Mocks]

describe('[ModuleName]', () => {
  let ModuleClass;
  let moduleInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('../../../src/main/[path].js');
    ModuleClass = module.default;
  });

  afterEach(() => {
    moduleInstance = null;
  });

  describe('构造函数', () => {
    // 构造函数测试
  });

  describe('[功能区域1]', () => {
    // 功能测试
  });

  describe('边界情况', () => {
    // 边界测试
  });

  describe('错误处理', () => {
    // 错误处理测试
  });
});
```

---

## 总结

### 交付物汇总

| Phase | 周数 | 新增测试文件 | 测试用例数 | 覆盖率提升 | 关键模块 |
|-------|------|--------------|------------|------------|----------|
| Phase 1 | 第1周 | 5个 | 460-510 | +15% | 安全/加密模块 |
| Phase 2 | 第2-3周 | 28个 | 1145 | +35% | RAG, DID, AI Engine |
| Phase 3 | 第4周 | 15个 | 580 | +20% | P2P, 集成测试 |
| **总计** | **4周** | **48个** | **2185-2235** | **+70%** | **全面覆盖** |

### 关键文件路径

**测试配置**:
- `C:\code\chainlesschain\desktop-app-vue\vitest.config.ts` (覆盖率配置: 70%阈值)
- `C:\code\chainlesschain\desktop-app-vue\tests\setup.ts` (Mock基础设施)

**Phase 1 目标文件**:
- `src/main/llm/secure-config-storage.js` (23.2K行)
- `src/main/llm/session-manager.js` (70.6K行)
- `src/main/ukey/pkcs11-driver.js` (36.4K行)
- `src/main/database/sqlcipher-wrapper.js`
- `src/main/mcp/mcp-security-policy.js` (25K行)

**Phase 2 目标文件**:
- `src/main/rag/*.js` (7个文件)
- `src/main/did/*.js` (4个文件)
- `src/main/ai-engine/extended-tools-*.js` (14个文件)
- `src/main/ai-engine/multi-agent/*.js` (4个文件)

**Phase 3 目标文件**:
- `src/main/p2p/*.js` (10个管理器)

### 验证方法

#### 运行测试
```bash
cd desktop-app-vue

# 运行所有单元测试
npm run test

# 运行带覆盖率报告的测试
npm run test:coverage

# 查看覆盖率报告 (HTML)
# 在 coverage/index.html

# 运行特定模块测试
npm run test tests/unit/llm/session-manager.test.js

# 运行集成测试
npm run test:integration

# 运行所有测试 (包括db, ukey)
npm run test:all
```

#### 覆盖率验证
```bash
# 检查是否达到70%阈值 (vitest.config.ts lines 56-59)
npm run test:coverage

# 预期输出:
# ✓ Lines: 70%+ (目标: 70%)
# ✓ Functions: 70%+ (目标: 70%)
# ✓ Branches: 70%+ (目标: 70%)
# ✓ Statements: 70%+ (目标: 70%)
```

#### 端到端验证
```bash
# 验证Session Manager + Compression集成
npm run test tests/integration/llm-session-compression.test.js

# 验证MCP安全策略集成
npm run test tests/integration/mcp-security-integration.test.js

# 运行完整E2E测试套件
npm run test:e2e
```

### 风险缓解

**CommonJS Mock问题** (参考 llm-manager.test.js 注释):
- 使用动态导入: `await import()`
- 利用vitest.config.ts inline配置 (line 71): `inline: [/src\/main\/.*/]`
- 在import之前hoisting mocks (vi.mock必须在文件顶部)

**集成测试不稳定性**:
- 使用内存SQLite (`:memory:`)
- Mock所有网络调用
- 显式超时设置 (testTimeout: 10000ms)

**平台特定测试** (U-Key, PKCS#11):
- 条件跳过: `it.skipIf(process.platform !== 'win32')`
- 为所有平台提供CLI fallback mocks

### 成功标准

- [ ] **覆盖率**: 70%+ (lines, functions, branches, statements)
- [ ] **测试文件**: 48个新文件创建
- [ ] **测试用例**: 2200+个用例通过
- [ ] **CI通过**: 所有测试在CI环境通过
- [ ] **安全验证**: 所有安全关键模块100%覆盖
- [ ] **文档**: 每个测试文件包含清晰的JSDoc注释

---

## 后续优化

Phase 4 (可选, 1-2周):
- 提升覆盖率至80%+ (深度边界测试)
- 性能测试套件 (benchmarking关键路径)
- 混沌测试 (模拟网络故障、数据库崩溃)
- E2E测试扩展 (更多业务场景)

---

**计划作者**: Claude (Sonnet 4.5)
**创建日期**: 2026-01-25
**版本**: v1.0
