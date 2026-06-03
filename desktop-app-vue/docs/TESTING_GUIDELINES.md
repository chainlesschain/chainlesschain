# 测试编写指南

## 📖 目录
1. [测试原则](#测试原则)
2. [测试结构](#测试结构)
3. [Mock策略](#mock策略)
4. [断言最佳实践](#断言最佳实践)
5. [覆盖率要求](#覆盖率要求)
6. [常见问题](#常见问题)

---

## 测试原则

### 1. AAA模式（Arrange-Act-Assert）
```javascript
it('应该在输入有效时返回正确结果', () => {
  // Arrange - 准备测试数据和环境
  const input = { value: 42 };
  const expected = { result: 84 };

  // Act - 执行被测功能
  const actual = doubleValue(input);

  // Assert - 验证结果
  expect(actual).toEqual(expected);
});
```

### 2. 测试应该独立
- ❌ 不依赖其他测试的执行顺序
- ❌ 不依赖全局状态
- ✅ 每个测试自己准备和清理数据

### 3. 测试应该快速
- ✅ 单元测试应在毫秒级完成
- ✅ 使用Mock避免真实网络请求
- ✅ 使用内存数据库而非文件数据库

### 4. 测试命名应该清晰
```javascript
// ✅ 好的命名
it('应该在密码错误时抛出UnauthorizedError')
it('应该在用户不存在时返回404状态码')
it('应该在输入为空数组时返回空结果')

// ❌ 不好的命名
it('测试登录')
it('test case 1')
it('works correctly')
```

---

## 测试结构

### 基本结构
```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ModuleName', () => {
  let instance;

  beforeEach(() => {
    // 每个测试前执行（准备环境）
    instance = new ModuleName();
  });

  afterEach(() => {
    // 每个测试后执行（清理环境）
    vi.clearAllMocks();
  });

  describe('methodName', () => {
    it('应该在正常情况下成功', () => {
      // 测试用例
    });

    it('应该在异常情况下抛出错误', () => {
      // 测试用例
    });
  });
});
```

### 异步测试
```javascript
// Promise风格
it('应该异步返回数据', async () => {
  const result = await fetchData();
  expect(result).toBeDefined();
});

// 错误处理
it('应该在失败时抛出错误', async () => {
  await expect(async () => {
    await failingFunction();
  }).rejects.toThrow('Expected error message');
});
```

---

## Mock策略

### 1. Mock外部依赖
```javascript
// Mock整个模块
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    on: vi.fn()
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}));

// Mock数据库
vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(() => ({ id: 1, name: 'test' })),
      all: vi.fn(() => [{ id: 1 }, { id: 2 }])
    })),
    close: vi.fn()
  }))
}));
```

### 2. Mock部分功能
```javascript
import * as llmService from '@/llm/llm-service';

vi.spyOn(llmService, 'callLLM').mockResolvedValue({
  text: 'Mocked LLM response',
  usage: { tokens: 100 }
});
```

### 3. Mock网络请求
```javascript
import axios from 'axios';

vi.mock('axios');

beforeEach(() => {
  axios.get.mockResolvedValue({
    data: { message: 'success' },
    status: 200
  });
});
```

### 4. Mock文件系统
```javascript
import fs from 'fs';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => 'file content'),
  writeFileSync: vi.fn()
}));
```

---

## 断言最佳实践

### 1. 使用精确断言
```javascript
// ✅ 精确断言
expect(result).toBe(42);
expect(user.name).toBe('Alice');

// ❌ 模糊断言
expect(result).toBeTruthy(); // 可能意外通过
```

### 2. 对象和数组断言
```javascript
// 对象相等
expect(result).toEqual({ id: 1, name: 'test' });

// 数组包含
expect(list).toContain('item');
expect(list).toHaveLength(3);

// 对象包含属性
expect(obj).toHaveProperty('id');
expect(obj).toMatchObject({ id: 1 }); // 部分匹配
```

### 3. 异常断言
```javascript
// 同步异常
expect(() => {
  throw new Error('fail');
}).toThrow('fail');

// 异步异常
await expect(async () => {
  await failingFunction();
}).rejects.toThrow('Expected error');
```

### 4. 数值断言
```javascript
expect(value).toBeGreaterThan(10);
expect(value).toBeLessThanOrEqual(100);
expect(floatValue).toBeCloseTo(0.3, 1); // 精度1位小数
```

### 5. Mock调用断言
```javascript
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledTimes(2);
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
expect(mockFn).toHaveBeenLastCalledWith('last-arg');
```

---

## 覆盖率要求

### 目标覆盖率（vitest.config.ts）
- **代码行覆盖率**: ≥ 70%
- **函数覆盖率**: ≥ 70%
- **分支覆盖率**: ≥ 70%
- **语句覆盖率**: ≥ 70%

### 关键模块要求更高
- 数据库层: ≥ 80%
- 安全模块（U-Key, 加密）: ≥ 80%
- 区块链/钱包: ≥ 80%
- IPC处理器: ≥ 75%

### 测试场景覆盖清单
每个模块应测试以下场景：
- [ ] 正常流程（Happy Path）
- [ ] 边界条件（空值、最大值、最小值）
- [ ] 异常处理（错误输入、网络失败、超时）
- [ ] 并发场景（如适用）
- [ ] 安全场景（XSS、SQL注入、权限检查）

---

## 常见问题

### Q1: 如何测试Electron IPC?
```javascript
import { ipcMain } from 'electron';

// Mock ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      // 存储handler供测试调用
      global.ipcHandlers = global.ipcHandlers || {};
      global.ipcHandlers[channel] = handler;
    })
  }
}));

// 测试中调用handler
it('应该处理IPC请求', async () => {
  // 注册handler
  registerIpcHandlers();

  // 调用handler
  const result = await global.ipcHandlers['database:query'](
    null, // event对象
    { sql: 'SELECT * FROM notes' }
  );

  expect(result).toBeDefined();
});
```

### Q2: 如何测试数据库操作?
```javascript
import Database from 'better-sqlite3';

let db;

beforeEach(() => {
  // 使用内存数据库
  db = new Database(':memory:');

  // 初始化Schema
  db.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      title TEXT,
      content TEXT
    )
  `);
});

afterEach(() => {
  db.close();
});

it('应该插入笔记', () => {
  const stmt = db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)');
  const result = stmt.run('Test', 'Content');

  expect(result.changes).toBe(1);
  expect(result.lastInsertRowid).toBeGreaterThan(0);
});
```

### Q3: 如何测试Vue组件?
```javascript
import { mount } from '@vue/test-utils';
import MyComponent from '@/components/MyComponent.vue';

it('应该渲染组件', () => {
  const wrapper = mount(MyComponent, {
    props: {
      title: 'Test Title'
    }
  });

  expect(wrapper.text()).toContain('Test Title');
});

it('应该响应按钮点击', async () => {
  const wrapper = mount(MyComponent);

  await wrapper.find('button').trigger('click');

  expect(wrapper.emitted()).toHaveProperty('submit');
});
```

### Q4: 如何测试P2P网络?
```javascript
// Mock libp2p
vi.mock('libp2p', () => ({
  createLibp2p: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    dial: vi.fn(),
    handle: vi.fn()
  }))
}));

it('应该连接到Peer', async () => {
  const p2pManager = new P2PManager();
  await p2pManager.start();

  const peerId = '/ip4/127.0.0.1/tcp/4001/p2p/QmTest';
  await p2pManager.connectToPeer(peerId);

  expect(p2pManager.peers.size).toBe(1);
});
```

### Q5: 如何测试LLM调用?
```javascript
import * as llmService from '@/llm/llm-service';

vi.spyOn(llmService, 'callLLM').mockResolvedValue({
  text: 'AI response',
  usage: { prompt_tokens: 10, completion_tokens: 20 }
});

it('应该调用LLM并返回响应', async () => {
  const result = await aiEngine.process('test prompt');

  expect(result.text).toBe('AI response');
  expect(llmService.callLLM).toHaveBeenCalledWith({
    prompt: 'test prompt',
    model: 'qwen2:7b'
  });
});
```

### Q6: 如何测试U-Key操作?
```javascript
import UKeyManager from '@/ukey/ukey-manager';

// Mock FFI库
vi.mock('koffi', () => ({
  load: vi.fn(() => ({
    SWOpenDev: vi.fn(() => 0), // 成功
    SWVerifyPIN: vi.fn(() => 0),
    SWSignData: vi.fn(() => Buffer.from('signature'))
  }))
}));

it('应该验证PIN', async () => {
  const ukeyManager = new UKeyManager();

  const result = await ukeyManager.verifyPin('123456');

  expect(result).toBe(true);
});
```

---

## 测试运行命令

```bash
# 运行所有测试
npm run test

# 运行单元测试
npm run test:unit

# 运行特定测试文件
npm run test tests/unit/database/database-adapter.test.js

# 监视模式（自动重跑）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# 运行E2E测试
npm run test:e2e

# UI模式（图形界面）
npm run test:ui
```

---

## 示例：完整测试文件

```javascript
/**
 * 示例：完整的模块测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import NoteManager from '@/managers/note-manager';
import Database from 'better-sqlite3';

describe('NoteManager', () => {
  let noteManager;
  let db;

  beforeEach(() => {
    // 准备内存数据库
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    noteManager = new NoteManager(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('createNote', () => {
    it('应该创建新笔记并返回ID', () => {
      const note = {
        title: 'Test Note',
        content: 'Test Content'
      };

      const noteId = noteManager.createNote(note);

      expect(noteId).toBeGreaterThan(0);

      // 验证数据库中存在
      const saved = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
      expect(saved.title).toBe('Test Note');
      expect(saved.content).toBe('Test Content');
    });

    it('应该在标题为空时抛出错误', () => {
      expect(() => {
        noteManager.createNote({ title: '', content: 'Content' });
      }).toThrow('标题不能为空');
    });

    it('应该处理超长标题（截断）', () => {
      const longTitle = 'a'.repeat(1000);

      const noteId = noteManager.createNote({
        title: longTitle,
        content: 'Content'
      });

      const saved = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
      expect(saved.title).toHaveLength(255); // 假设限制为255字符
    });
  });

  describe('updateNote', () => {
    it('应该更新现有笔记', () => {
      const noteId = noteManager.createNote({
        title: 'Original',
        content: 'Original Content'
      });

      noteManager.updateNote(noteId, {
        title: 'Updated',
        content: 'Updated Content'
      });

      const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
      expect(updated.title).toBe('Updated');
      expect(updated.content).toBe('Updated Content');
    });

    it('应该在笔记不存在时抛出错误', () => {
      expect(() => {
        noteManager.updateNote(999, { title: 'Updated' });
      }).toThrow('笔记不存在');
    });
  });

  describe('deleteNote', () => {
    it('应该删除笔记', () => {
      const noteId = noteManager.createNote({ title: 'To Delete' });

      noteManager.deleteNote(noteId);

      const deleted = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
      expect(deleted).toBeUndefined();
    });
  });

  describe('searchNotes', () => {
    beforeEach(() => {
      // 准备测试数据
      noteManager.createNote({ title: 'JavaScript Tutorial', content: 'Learn JS' });
      noteManager.createNote({ title: 'Python Tutorial', content: 'Learn Python' });
      noteManager.createNote({ title: 'TypeScript Guide', content: 'Learn TS' });
    });

    it('应该搜索标题匹配的笔记', () => {
      const results = noteManager.searchNotes('Tutorial');

      expect(results).toHaveLength(2);
      expect(results[0].title).toContain('Tutorial');
    });

    it('应该在没有匹配时返回空数组', () => {
      const results = noteManager.searchNotes('Nonexistent');

      expect(results).toEqual([]);
    });

    it('应该忽略大小写', () => {
      const results = noteManager.searchNotes('tutorial');

      expect(results).toHaveLength(2);
    });
  });
});
```

---

**最后更新**: 2026-01-25
**维护者**: ChainlessChain Team
