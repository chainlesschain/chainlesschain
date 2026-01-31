# database-adapter.test.js 修复方案

## 问题概述

有7个测试被跳过（`.skip`标记），原因是ES6模块模拟（`vi.mock`）无法拦截CommonJS的`require()`调用。

## 根本原因

源代码 `src/main/database/database-adapter.js` 使用CommonJS模块系统：

```javascript
const fs = require("fs");
const path = require("path");
const { KeyManager } = require("./key-manager");
```

而测试文件使用Vitest的ES6模块模拟：

```javascript
vi.mock("node:fs", () => fsMock);
vi.mock("fs", () => fsMock);
```

这导致mock无法正确拦截源代码中的`require()`调用。

## 跳过的测试清单

1. **shouldMigrate测试组** (2个)
   - `应该在原数据库不存在时返回false`
   - `应该在加密数据库已存在时返回false`
   - 原因：无法mock `fs.existsSync()`

2. **createSQLCipherDatabase测试** (1个)
   - `应该创建SQLCipher数据库实例`
   - 原因：sqlcipher-wrapper mock无法拦截CommonJS require

3. **createSqlJsDatabase测试** (1个)
   - `应该加载现有的sql.js数据库`
   - 原因：无法mock `fs.readFileSync()`

4. **saveDatabase测试组** (2个)
   - `应该保存sql.js数据库到文件`
   - `应该在目录不存在时创建目录`
   - 原因：无法mock `fs.writeFileSync()` 和 `fs.mkdirSync()`

5. **changePassword测试** (1个)
   - `应该成功修改数据库密码`
   - 原因：createEncryptedDatabase mock无法正常工作

## 解决方案

### 方案A：重构源代码为ES6模块 ⚠️ **不推荐**

**优点**：

- 测试可以完美使用ES6 mock
- 代码现代化

**缺点**：

- 需要大量源代码改动
- 影响面太大（整个database模块）
- 可能破坏现有功能
- 需要更新所有依赖此模块的代码

### 方案B：使用集成测试替代单元测试 ✅ **推荐**

**优点**：

- 无需改动源代码
- 测试更真实（使用真实文件系统）
- 测试覆盖更全面
- 低风险

**实施方案**：

1. 使用临时目录创建真实测试环境
2. 使用真实的fs操作
3. 在测试cleanup中清理临时文件
4. 移除`.skip`标记，重写测试逻辑

**示例代码**：

```javascript
import fs from "fs";
import path from "path";
import os from "os";

describe("shouldMigrate (集成测试)", () => {
  let tempDir;
  let adapter;

  beforeEach(() => {
    // 创建临时目录
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-test-"));
    const dbPath = path.join(tempDir, "test.db");

    adapter = new DatabaseAdapter({ dbPath });
  });

  afterEach(() => {
    // 清理临时文件
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("应该在原数据库不存在时返回false", () => {
    // 数据库不存在时
    const result = adapter.shouldMigrate();
    expect(result).toBe(false);
  });

  it("应该在加密数据库已存在时返回false", () => {
    // 创建加密数据库文件
    const encryptedPath = adapter.getEncryptedDbPath();
    fs.writeFileSync(encryptedPath, "");

    const result = adapter.shouldMigrate();
    expect(result).toBe(false);
  });
});
```

### 方案C：使用proxyquire或rewire ⚠️ **复杂度高**

**优点**：

- 可以mock CommonJS模块
- 保持单元测试性质

**缺点**：

- 需要额外依赖
- 配置复杂
- 与Vitest集成可能有问题

### 方案D：混合方案（部分测试用真实环境） ✅ **可选**

对于简单的mock（如fs操作），使用集成测试。
对于复杂的依赖（如KeyManager），继续使用mock。

## 推荐实施计划

### Step 1: 修复shouldMigrate测试 (使用真实文件系统)

```javascript
describe("shouldMigrate (集成测试)", () => {
  let tempDir;
  let testDbPath;
  let adapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-adapter-test-"));
    testDbPath = path.join(tempDir, "test.db");
    adapter = new DatabaseAdapter({ dbPath: testDbPath });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("应该在原数据库不存在时返回false", () => {
    expect(adapter.shouldMigrate()).toBe(false);
  });

  it("应该在加密数据库已存在时返回false", () => {
    const encryptedPath = adapter.getEncryptedDbPath();
    fs.writeFileSync(encryptedPath, "");
    expect(adapter.shouldMigrate()).toBe(false);
  });

  it("应该在原数据库存在但加密数据库不存在时返回true", () => {
    fs.writeFileSync(testDbPath, "");
    expect(adapter.shouldMigrate()).toBe(true);
  });
});
```

### Step 2: 修复saveDatabase测试 (使用真实文件系统)

```javascript
describe("saveDatabase (集成测试)", () => {
  let tempDir;
  let adapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-adapter-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("应该保存sql.js数据库到文件", () => {
    const dbPath = path.join(tempDir, "test.db");
    adapter = new DatabaseAdapter({ dbPath, encryptionEnabled: false });
    adapter.engine = DatabaseEngine.SQL_JS;

    const mockDb = {
      export: vi.fn(() => new Uint8Array([1, 2, 3])),
    };

    adapter.saveDatabase(mockDb);

    expect(fs.existsSync(dbPath)).toBe(true);
    const content = fs.readFileSync(dbPath);
    expect(content).toEqual(Buffer.from([1, 2, 3]));
  });

  it("应该在目录不存在时创建目录", () => {
    const nestedPath = path.join(tempDir, "nested", "dir", "test.db");
    adapter = new DatabaseAdapter({
      dbPath: nestedPath,
      encryptionEnabled: false,
    });
    adapter.engine = DatabaseEngine.SQL_JS;

    const mockDb = {
      export: vi.fn(() => new Uint8Array([1, 2, 3])),
    };

    adapter.saveDatabase(mockDb);

    expect(fs.existsSync(nestedPath)).toBe(true);
  });
});
```

### Step 3: 修复createSqlJsDatabase测试 (混合方案)

```javascript
describe("createSqlJsDatabase", () => {
  let tempDir;
  let adapter;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-adapter-test-"));
    const dbPath = path.join(tempDir, "test.db");

    adapter = new DatabaseAdapter({
      dbPath,
      encryptionEnabled: false,
    });

    vi.spyOn(adapter, "performMigration").mockResolvedValue({ success: true });
    await adapter.initialize();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("应该加载现有的sql.js数据库", async () => {
    // 创建一个真实的测试数据库文件
    const testData = new Uint8Array([0, 1, 2, 3]);
    fs.writeFileSync(adapter.dbPath, testData);

    const db = await adapter.createSqlJsDatabase();

    expect(db).toBeDefined();
    expect(db.run).toBeDefined();
    expect(db.exec).toBeDefined();
  });
});
```

### Step 4: 修复SQLCipher和changePassword测试 (更复杂，需要更多集成测试)

这些测试涉及到native模块（SQLCipher），建议：

1. 在有SQLCipher环境的系统上运行真实集成测试
2. 在CI/CD中使用Docker镜像包含SQLCipher
3. 或者保持跳过状态，依赖其他测试覆盖

## 实施优先级

**P0 (立即修复)**:

- `shouldMigrate` 测试组
- `saveDatabase` 测试组
- `createSqlJsDatabase` - 加载现有数据库

**P1 (短期修复)**:

- `createSQLCipherDatabase` - 可能需要Docker环境
- `changePassword` - 可能需要Docker环境

## 测试覆盖率目标

修复后预期覆盖率提升：

- 当前：~85% (7个测试跳过)
- 目标：>90% (所有测试通过)

## 风险评估

**风险等级**: 低

**原因**：

- 不改动源代码
- 使用真实文件系统测试更可靠
- 临时文件清理完善
- 向后兼容

## 验收标准

- [ ] 所有7个跳过的测试移除`.skip`标记
- [ ] 所有测试通过（0个失败）
- [ ] 代码覆盖率 >90%
- [ ] 无测试泄漏（临时文件完全清理）
- [ ] CI/CD通过

## 参考资料

- Vitest Mock文档: https://vitest.dev/api/vi.html#vi-mock
- CommonJS vs ES6模块互操作: https://nodejs.org/docs/latest/api/esm.html
- 文件系统测试最佳实践: https://nodejs.org/api/fs.html#fsmkdtempsyncprefix-options

---

**文档创建日期**: 2026-01-31
**作者**: Claude Code
**状态**: 待实施
