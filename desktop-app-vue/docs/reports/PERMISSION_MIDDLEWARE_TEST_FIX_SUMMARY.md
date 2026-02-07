# Permission Middleware 测试修复总结

## 修复概览

**修复前**: 45 个测试全部失败，超时错误
**修复后**: 7 个测试通过，38 个测试因性能问题超时/失败

## 主要修复

### 1. 修复 permission-manager 路径错误

- **问题**: 模块路径从 `organization/permission-manager` 变更为 `collaboration/permission-manager`
- **修复**: 更新 require 语句路径

### 2. 修复 SQL 约束错误

- **问题**: 所有 `INSERT INTO organization_info` 语句缺少 `updated_at` 字段，导致 NOT NULL 约束失败
- **影响**: 10 个 INSERT 语句
- **修复**:
  - 添加 `updated_at` 列到 INSERT 语句
  - 为每个 INSERT 添加时间戳参数

**修复示例**:

```javascript
// 修复前
db.prepare(
  `
  INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`,
).run(
  "org_123",
  "did:test:org123",
  "Test Org",
  ownerDID,
  "startup",
  Date.now(),
);

// 修复后
const now = Date.now();
db.prepare(
  `
  INSERT INTO organization_info (org_id, org_did, name, owner_did, type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`,
).run("org_123", "did:test:org123", "Test Org", ownerDID, "startup", now, now);
```

## 已知性能问题

### 问题描述

测试套件使用 `beforeEach` 钩子在每个测试前完整初始化数据库，导致：

- 每个测试初始化耗时 1-2 秒
- 45 个测试总耗时 67-90 秒
- 接近或超过测试超时阈值
- Vitest worker 超时错误

### 性能瓶颈

```javascript
beforeEach(async () => {
  // 每个测试都执行以下操作:
  // 1. 创建新数据库文件
  // 2. 运行完整的表创建脚本
  // 3. 执行所有数据库迁移
  // 4. 初始化 DIDManager
  // 5. 初始化 PermissionManager
  // 总耗时: ~1.5秒/测试
});
```

### 建议优化方案

#### 方案 1: 使用 beforeAll（推荐）

```javascript
describe("PermissionMiddleware Unit Tests", () => {
  beforeAll(async () => {
    // 只初始化一次数据库
    db = new DatabaseManager(testDbPath, { encryptionEnabled: false });
    await db.initialize();
    // ...
  });

  beforeEach(() => {
    // 只清理测试数据，不重建数据库
    db.prepare("DELETE FROM organization_info").run();
    db.prepare("DELETE FROM organization_members").run();
    // ...
  });

  afterAll(async () => {
    // 最后清理
    await db.close();
    fs.unlinkSync(testDbPath);
  });
});
```

**优点**:

- 数据库初始化从 45 次减少到 1 次
- 测试总耗时从 ~90秒减少到 ~10秒（估计）
- 不再超时

**注意事项**:

- 需要仔细清理测试数据避免测试间干扰
- ID 生成需要使用时间戳或计数器避免冲突

#### 方案 2: Mock 数据库（彻底解决）

```javascript
beforeEach(() => {
  // 完全 mock 数据库操作
  db = {
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    })),
  };
});
```

**优点**:

- 最快速度（无 I/O）
- 真正的单元测试
- 无超时风险

**缺点**:

- 需要重写测试逻辑
- 失去对 SQL 语句的实际验证

#### 方案 3: 增加超时时间（临时方案）

```javascript
// vitest.config.js
export default {
  test: {
    testTimeout: 180000, // 3 minutes
  },
};
```

**优点**: 最简单，无需重构
**缺点**: 治标不治本，测试仍然很慢

## 修复文件

- `desktop-app-vue/tests/unit/enterprise/permission-middleware.test.js`

## 下一步行动

1. **短期**: 使用方案 3（增加超时）让测试能够通过
2. **中期**: 实施方案 1（beforeAll）优化性能
3. **长期**: 考虑方案 2（Mock）进行真正的单元测试重构

## 测试状态

| 状态          | 数量 | 百分比 |
| ------------- | ---- | ------ |
| **通过**      | 7    | 15.6%  |
| **失败/超时** | 38   | 84.4%  |
| **总计**      | 45   | 100%   |

**失败原因分析**:

- SQL 错误: 0 (已修复) ✅
- 性能超时: ~30 (需优化) ⚠️
- 逻辑错误: ~8 (需调查) ⚠️

---

**修复日期**: 2026-01-31
**修复人**: Claude Sonnet 4.5
**状态**: SQL 错误已修复，性能优化待完成
