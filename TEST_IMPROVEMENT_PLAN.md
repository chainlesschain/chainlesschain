# IPC 模块单元测试完善计划

> 生成时间: 2026-01-03
> 目标: 提升测试覆盖率至 70%+
> 当前状态: 分析中

---

## 📊 当前测试状态

### 测试执行结果 (最近一次运行)

| 指标 | 数量 | 说明 |
|------|------|------|
| **测试文件** | 51 个 | 14 失败, 37 通过 |
| **测试用例** | 2,069 个 | 223 失败, 1,824 通过, 22 跳过 |
| **通过率** | 88.2% | (1,824 / 2,069) |
| **执行时间** | 41.9秒 | 环境初始化 200.89秒 |

### 已有单元测试的 IPC 模块 (8个)

| 模块 | 测试文件 | 状态 |
|------|---------|------|
| System IPC | `tests/unit/system-ipc.test.js` | ✅ 通过 |
| Social IPC | `tests/unit/social-ipc.test.js` | ✅ 通过 |
| Knowledge IPC | `tests/unit/knowledge-ipc.test.js` | ✅ 通过 |
| PDF IPC | `tests/unit/pdf-ipc.test.js` | ✅ 通过 |
| Document IPC | `tests/unit/document-ipc.test.js` | ✅ 通过 |
| Notification IPC | `tests/unit/notification-ipc.test.js` | ✅ 通过 |
| Git Sync IPC | `tests/unit/git-sync-ipc.test.js` | ✅ 通过 |
| API Integration | `tests/unit/api-integration.test.js` | ✅ 通过 |

### 缺失单元测试的 IPC 模块 (46个)

#### 高优先级模块 (Top 10 最大模块)

| 排名 | 模块文件 | 行数 | 优先级 | 测试文件计划 |
|------|---------|------|--------|------------|
| 1 | `project/project-core-ipc.js` | 1,595 | 🔴 **极高** | `tests/unit/project/project-core-ipc.test.js` |
| 2 | `ipc/file-ipc.js` | 1,102 | 🔴 **极高** | `tests/unit/ipc/file-ipc.test.js` |
| 3 | `project/project-export-ipc.js` | 832 | 🔴 **极高** | `tests/unit/project/project-export-ipc.test.js` |
| 4 | `skill-tool-system/skill-tool-ipc.js` | 780 | 🟡 高 | `tests/unit/skill-tool-system/skill-tool-ipc.test.js` |
| 5 | `organization/organization-ipc.js` | 764 | 🟡 高 | `tests/unit/organization/organization-ipc.test.js` |
| 6 | `file/file-ipc.js` | 742 | 🟡 高 | `tests/unit/file/file-ipc.test.js` |
| 7 | `social/social-ipc.js` | 693 | ✅ **已有** | `tests/unit/social-ipc.test.js` |
| 8 | `project/project-ai-ipc.js` | 652 | 🟡 高 | `tests/unit/project/project-ai-ipc.test.js` |
| 9 | `ai-engine/ai-engine-ipc.js` | 546 | 🟡 高 | `tests/unit/ai-engine/ai-engine-ipc.test.js` |
| 10 | `image/image-ipc.js` | 545 | 🟡 高 | `tests/unit/image/image-ipc.test.js` |

#### 中优先级模块 (核心功能)

| 模块分类 | 模块列表 | 优先级 |
|---------|---------|--------|
| **LLM & AI** | llm-ipc, rag-ipc | 🟠 中高 |
| **DID & P2P** | did-ipc, p2p-ipc | 🟠 中高 |
| **媒体处理** | video-ipc, speech-ipc, image-ipc | 🟠 中 |
| **项目管理** | project-git-ipc, project-rag-ipc | 🟠 中 |
| **企业功能** | vc-ipc, identity-context-ipc | 🟠 中 |

#### 低优先级模块 (辅助功能)

| 模块分类 | 模块列表 |
|---------|---------|
| **区块链** | wallet-ipc, contract-ipc, asset-ipc, marketplace-ipc, bridge-ipc, escrow-ipc, blockchain-ipc |
| **工具系统** | code-ipc, review-ipc, automation-ipc, webide-ipc |
| **其他** | template-ipc, prompt-template-ipc, import-ipc, sync-ipc, config-ipc |

---

## 🎯 测试完善目标

### 阶段 1: 核心模块单元测试 (Week 1)

**目标**: 覆盖 Top 10 最大模块中缺失测试的 9 个模块

| 模块 | 预计测试用例数 | 预计行数 | 优先级 |
|------|---------------|---------|--------|
| `project-core-ipc` | 40+ | 800+ | P0 |
| `file-ipc` (ipc/) | 30+ | 600+ | P0 |
| `project-export-ipc` | 25+ | 500+ | P0 |
| `file-ipc` (file/) | 25+ | 500+ | P1 |
| `skill-tool-ipc` | 20+ | 400+ | P1 |
| `organization-ipc` | 20+ | 400+ | P1 |
| `project-ai-ipc` | 20+ | 400+ | P1 |
| `ai-engine-ipc` | 15+ | 300+ | P1 |
| `image-ipc` | 15+ | 300+ | P1 |

**合计**: ~210 测试用例, ~4,200 行测试代码

### 阶段 2: 核心功能模块 (Week 2)

**目标**: 覆盖 LLM, RAG, DID, P2P 等核心功能

| 模块组 | 模块数量 | 预计测试用例数 |
|--------|---------|---------------|
| LLM & AI | 2 个 | 30+ |
| DID & P2P | 2 个 | 30+ |
| 媒体处理 | 2 个 | 25+ |
| 项目管理辅助 | 2 个 | 20+ |

**合计**: ~105 测试用例, ~2,100 行测试代码

### 阶段 3: 其他模块补充 (Week 3)

**目标**: 补充剩余模块测试，达到 70%+ 覆盖率

---

## 📝 单元测试设计规范

### 测试文件命名规范

```
tests/unit/<模块路径>/<模块名>.test.js
```

**示例**:
- `src/main/project/project-core-ipc.js` → `tests/unit/project/project-core-ipc.test.js`
- `src/main/llm/llm-ipc.js` → `tests/unit/llm/llm-ipc.test.js`

### 测试模板

```javascript
/**
 * [模块名] IPC 单元测试
 * 测试 [N] 个 [功能描述] API 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';

// Mock dependencies
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  // ... other electron mocks
}));

vi.mock('依赖模块路径', () => ({
  // ... module mocks
}));

describe('[模块名] IPC', () => {
  let handlers = {};
  let mockDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};

    // 设置 mock 依赖
    mockDependencies = {
      dependency1: {
        method1: vi.fn(),
        method2: vi.fn(),
      },
      // ... 其他依赖
    };

    // 捕获 IPC handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 IPC
    const { registerXXXIPC } = require('../../desktop-app-vue/src/main/xxx/xxx-ipc');
    registerXXXIPC(mockDependencies);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('功能组 1', () => {
    it('should 正常情况描述', async () => {
      // Arrange
      mockDependencies.dependency1.method1.mockResolvedValue({ data: 'test' });

      // Act
      const result = await handlers['channel:name'](null, { param: 'value' });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toBe('test');
      expect(mockDependencies.dependency1.method1).toHaveBeenCalledWith({ param: 'value' });
    });

    it('should 错误情况描述', async () => {
      // Arrange
      mockDependencies.dependency1.method1.mockRejectedValue(new Error('Test error'));

      // Act
      const result = await handlers['channel:name'](null, {});

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Test error');
    });
  });

  describe('功能组 2', () => {
    // ... 更多测试
  });

  describe('边界情况', () => {
    it('should handle null input', async () => {
      // ...
    });

    it('should handle empty input', async () => {
      // ...
    });
  });

  describe('错误处理', () => {
    it('should handle [specific error]', async () => {
      // ...
    });
  });
});
```

### 测试覆盖要求

每个IPC模块测试应覆盖：

1. ✅ **正常流程** (Happy Path)
   - 所有 IPC handler 的基本功能
   - 参数正确时的预期行为

2. ✅ **错误处理** (Error Handling)
   - 依赖模块抛出错误
   - 无效参数
   - 缺失必需参数

3. ✅ **边界情况** (Edge Cases)
   - null / undefined 输入
   - 空字符串 / 空数组
   - 极大 / 极小值

4. ✅ **异步操作** (Async Operations)
   - Promise resolve
   - Promise reject
   - Timeout 处理

5. ✅ **依赖调用** (Dependency Calls)
   - 验证依赖方法被正确调用
   - 验证传递的参数正确
   - 验证调用次数

---

## 🔧 测试工具和辅助函数

### Mock 工具函数

创建 `tests/utils/test-helpers.js`:

```javascript
/**
 * 测试辅助函数
 */

/**
 * 创建 mock electron 对象
 */
export function createMockElectron() {
  return {
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
    },
    BrowserWindow: vi.fn(),
    app: {
      getVersion: vi.fn(() => '0.1.0'),
      getName: vi.fn(() => 'chainlesschain-desktop-vue'),
      getPath: vi.fn((name) => `/mock/path/${name}`),
      // ... 其他方法
    },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
      showItemInFolder: vi.fn(),
    },
  };
}

/**
 * 创建 mock 数据库
 */
export function createMockDatabase() {
  return {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
    })),
    exec: vi.fn(),
    close: vi.fn(),
  };
}

/**
 * 创建 mock LLM Manager
 */
export function createMockLLMManager() {
  return {
    chat: vi.fn(async (message) => ({
      success: true,
      response: `Mock response to: ${message}`,
    })),
    getModels: vi.fn(async () => ({
      success: true,
      models: ['qwen2:7b', 'llama3:8b'],
    })),
    getCurrentModel: vi.fn(() => 'qwen2:7b'),
    // ... 其他方法
  };
}

/**
 * 捕获 IPC handlers
 */
export function captureIPCHandlers(ipcMain) {
  const handlers = {};
  ipcMain.handle.mockImplementation((channel, handler) => {
    handlers[channel] = handler;
  });
  return handlers;
}

/**
 * 等待异步操作
 */
export function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 创建测试数据
 */
export function createTestData(type, overrides = {}) {
  const defaults = {
    project: {
      id: 'test-project-1',
      name: 'Test Project',
      description: 'Test Description',
      created_at: new Date().toISOString(),
    },
    note: {
      id: 'test-note-1',
      title: 'Test Note',
      content: 'Test Content',
      tags: ['test'],
    },
    // ... 其他类型
  };

  return { ...defaults[type], ...overrides };
}
```

---

## 📊 测试覆盖率目标

### 整体目标

| 指标 | 当前 | 目标 | 提升 |
|------|------|------|------|
| **行覆盖率** (Lines) | ?% | 70%+ | TBD |
| **函数覆盖率** (Functions) | ?% | 70%+ | TBD |
| **分支覆盖率** (Branches) | ?% | 70%+ | TBD |
| **语句覆盖率** (Statements) | ?% | 70%+ | TBD |

### 模块覆盖率目标

| 模块分类 | 目标覆盖率 |
|---------|-----------|
| **核心 IPC 模块** (Top 10) | 80%+ |
| **核心功能模块** (LLM, DID, P2P) | 75%+ |
| **业务模块** (Project, Knowledge) | 70%+ |
| **辅助模块** (Template, Import) | 60%+ |
| **实验性模块** (Blockchain, WebIDE) | 50%+ |

---

## 🚀 实施计划

### Week 1: 核心模块测试 (2026-01-03 ~ 01-10)

**Day 1-2**: 项目核心模块
- ✅ `project-core-ipc.test.js` (40+ 测试用例)
- ✅ `project-export-ipc.test.js` (25+ 测试用例)
- ✅ `project-ai-ipc.test.js` (20+ 测试用例)

**Day 3-4**: 文件管理模块
- ✅ `ipc/file-ipc.test.js` (30+ 测试用例)
- ✅ `file/file-ipc.test.js` (25+ 测试用例)

**Day 5-6**: 组织与工具模块
- ✅ `organization/organization-ipc.test.js` (20+ 测试用例)
- ✅ `skill-tool-system/skill-tool-ipc.test.js` (20+ 测试用例)

**Day 7**: AI 与媒体模块
- ✅ `ai-engine/ai-engine-ipc.test.js` (15+ 测试用例)
- ✅ `image/image-ipc.test.js` (15+ 测试用例)

### Week 2: 核心功能模块 (2026-01-11 ~ 01-17)

**Day 1-2**: LLM & RAG
- ✅ `llm/llm-ipc.test.js` (20+ 测试用例)
- ✅ `rag/rag-ipc.test.js` (15+ 测试用例)

**Day 3-4**: DID & P2P
- ✅ `did/did-ipc.test.js` (20+ 测试用例)
- ✅ `p2p/p2p-ipc.test.js` (15+ 测试用例)
- 🔧 修复现有 P2P 测试失败

**Day 5-6**: 媒体处理
- ✅ `video/video-ipc.test.js` (15+ 测试用例)
- ✅ `speech/speech-ipc.test.js` (15+ 测试用例)

**Day 7**: Git 与项目辅助
- ✅ `project/project-git-ipc.test.js` (15+ 测试用例)
- ✅ `project/project-rag-ipc.test.js` (10+ 测试用例)

### Week 3: 补充与优化 (2026-01-18 ~ 01-24)

**Day 1-3**: 企业功能与区块链
- ✅ 企业功能模块测试 (5 个模块)
- ✅ 区块链模块测试 (7 个模块)

**Day 4-5**: 工具与辅助模块
- ✅ 代码工具模块测试 (4 个模块)
- ✅ 辅助模块测试 (5 个模块)

**Day 6-7**: 测试优化与报告
- ✅ 修复所有失败测试
- ✅ 生成完整覆盖率报告
- ✅ 优化测试性能
- ✅ 完善测试文档

---

## 📈 成功标准

### 量化指标

- ✅ 所有 54 个 IPC 模块都有对应的单元测试
- ✅ 总测试用例数 ≥ 3,000 个
- ✅ 测试通过率 ≥ 95%
- ✅ 代码覆盖率 ≥ 70% (Lines, Functions, Branches, Statements)
- ✅ 测试执行时间 < 2 分钟

### 质量指标

- ✅ 所有测试遵循统一的命名规范和结构
- ✅ 每个测试用例独立，无依赖关系
- ✅ Mock 和 Stub 使用合理，避免过度 mock
- ✅ 测试覆盖正常流程、错误处理和边界情况
- ✅ 测试文档清晰，易于维护

---

## 🔄 持续改进

### 自动化测试

- ✅ 在 CI/CD 中集成单元测试
- ✅ 每次 PR 自动运行测试
- ✅ 测试覆盖率自动检查（≥ 70%）
- ✅ 测试失败时阻止合并

### 测试维护

- ✅ 新增功能必须包含测试
- ✅ 修复 Bug 必须添加回归测试
- ✅ 定期 review 和更新测试
- ✅ 清理过时和冗余的测试

---

**文档版本**: v1.0
**最后更新**: 2026-01-03
**负责人**: Claude Code (Sonnet 4.5)
