# U-Key IPC 修复 - 详细修改对比

## 修改 1：src/main/ukey/ukey-ipc.js

### 第 1-20 行：添加依赖注入支持

#### 之前：
```javascript
/**
 * U-Key 硬件 IPC 处理器
 * 负责处理 U-Key 硬件设备相关的前后端通信
 *
 * @module ukey-ipc
 * @description 提供 U-Key 硬件检测、PIN验证、签名加密、认证等 IPC 接口
 */

const { ipcMain } = require('electron');

/**
 * 注册所有 U-Key IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.ukeyManager - U-Key 管理器
 */
function registerUKeyIPC({ ukeyManager }) {
  console.log('[UKey IPC] Registering U-Key IPC handlers...');
```

#### 之后：
```javascript
/**
 * U-Key 硬件 IPC 处理器
 * 负责处理 U-Key 硬件设备相关的前后端通信
 *
 * @module ukey-ipc
 * @description 提供 U-Key 硬件检测、PIN验证、签名加密、认证等 IPC 接口
 */

/**
 * 注册所有 U-Key IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.ukeyManager - U-Key 管理器
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 */
function registerUKeyIPC({ ukeyManager, ipcMain: injectedIpcMain }) {
  // 支持依赖注入，用于测试
  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  console.log('[UKey IPC] Registering U-Key IPC handlers...');
```

#### 修改要点：
1. ✅ 移除了顶部 `const { ipcMain } = require('electron');` 语句
2. ✅ 在函数参数中添加 `ipcMain: injectedIpcMain`
3. ✅ 在函数开头添加依赖注入逻辑
4. ✅ 更新了 JSDoc 注释

---

## 修改 2：tests/unit/ukey/ukey-ipc.test.js

### 完整重构

#### 第 1-10 行：更新导入和 describe 块初始化

##### 之前：
```javascript
import { describe, it, expect } from 'vitest';

describe('U-Key IPC 处理器', () => {
  // =====================================================================
  // 定义所有预期的IPC handlers
  // =====================================================================

  const expectedHandlers = {
```

##### 之后：
```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('U-Key IPC 处理器', () => {
  let handlers = {};
  let mockUkeyManager;
  let mockIpcMain;
  let registerUKeyIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    // Mock ukey manager
    mockUkeyManager = {
      detect: vi.fn().mockResolvedValue({
        detected: false,
        unlocked: false,
      }),
      verifyPIN: vi.fn().mockResolvedValue({
        success: false,
      }),
      getDeviceInfo: vi.fn().mockResolvedValue({
        serialNumber: 'TEST-123456',
        model: 'SIMKey-Test',
      }),
      sign: vi.fn().mockResolvedValue({
        signature: 'test-signature',
      }),
      encrypt: vi.fn().mockResolvedValue({
        encrypted: 'test-encrypted-data',
      }),
      decrypt: vi.fn().mockResolvedValue({
        decrypted: 'test-decrypted-data',
      }),
      lock: vi.fn(),
      getPublicKey: vi.fn().mockResolvedValue({
        publicKey: 'test-public-key',
      }),
    };

    // 动态导入
    const module = await import('../../../src/main/ukey/ukey-ipc.js');
    registerUKeyIPC = module.registerUKeyIPC;

    // 注册 U-Key IPC 并注入 mock 对象
    registerUKeyIPC({
      ukeyManager: mockUkeyManager,
      ipcMain: mockIpcMain
    });
  });

  // =====================================================================
  // 定义所有预期的IPC handlers
  // =====================================================================

  const expectedHandlers = {
```

#### 修改要点：
1. ✅ 添加 `beforeEach, vi` 到 vitest 导入
2. ✅ 添加测试级别的变量声明（handlers, mockUkeyManager, mockIpcMain, registerUKeyIPC）
3. ✅ 创建 beforeEach 钩子初始化 mocks
4. ✅ 创建 mockIpcMain 对象来捕获注册的 handlers
5. ✅ 创建完整的 mockUkeyManager 对象，所有方法都返回合理的 mock 值
6. ✅ 动态导入 registerUKeyIPC 函数
7. ✅ 调用 registerUKeyIPC 并注入 mock 对象

### 第 128-157 行：基本功能测试重构

#### 之前：
```javascript
  describe('基本功能测试', () => {
    it('should define exactly 9 U-Key IPC handlers', () => {
      expect(Object.keys(expectedHandlers).length).toBe(9);
    });

    it('should include all required handler channels', () => {
      const requiredChannels = [
        'ukey:detect',
        'ukey:verify-pin',
        'ukey:get-device-info',
        'ukey:sign',
        'ukey:encrypt',
        'ukey:decrypt',
        'ukey:lock',
        'ukey:get-public-key',
        'auth:verify-password',
      ];

      requiredChannels.forEach((channel) => {
        expect(expectedHandlers[channel]).toBeDefined();
        expect(expectedHandlers[channel]).toHaveProperty('category');
        expect(expectedHandlers[channel]).toHaveProperty('params');
        expect(expectedHandlers[channel]).toHaveProperty('async');
      });
    });

    it('all handlers should be configured as async', () => {
      Object.values(expectedHandlers).forEach((handler) => {
        expect(handler.async).toBe(true);
      });
    });
  });
```

#### 之后：
```javascript
  describe('基本功能测试', () => {
    it('should register exactly 9 U-Key IPC handlers', () => {
      expect(Object.keys(handlers).length).toBe(9);
    });

    it('should include all required handler channels', () => {
      const requiredChannels = [
        'ukey:detect',
        'ukey:verify-pin',
        'ukey:get-device-info',
        'ukey:sign',
        'ukey:encrypt',
        'ukey:decrypt',
        'ukey:lock',
        'ukey:get-public-key',
        'auth:verify-password',
      ];

      requiredChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });

    it('all handlers should be registered as functions', () => {
      Object.values(handlers).forEach((handler) => {
        expect(typeof handler).toBe('function');
      });
    });
  });
```

#### 修改要点：
1. ✅ 从 expectedHandlers 改为 handlers（实际注册的）
2. ✅ 从验证静态属性改为验证真实函数
3. ✅ 添加了对函数类型的检查

### 第 163-189 行：设备检测测试重构

#### 之前：
```javascript
  describe('设备检测功能 (ukey:detect)', () => {
    it('should be defined', () => {
      expect(expectedHandlers['ukey:detect']).toBeDefined();
    });

    it('should be categorized as 设备检测', () => {
      expect(expectedHandlers['ukey:detect'].category).toBe('设备检测');
    });

    it('should be async', () => {
      expect(expectedHandlers['ukey:detect'].async).toBe(true);
    });

    it('should not require extra parameters', () => {
      expect(expectedHandlers['ukey:detect'].params).toBe(0);
    });
  });
```

#### 之后：
```javascript
  describe('设备检测功能 (ukey:detect)', () => {
    it('should register ukey:detect handler', () => {
      expect(handlers['ukey:detect']).toBeDefined();
      expect(typeof handlers['ukey:detect']).toBe('function');
    });

    it('should call ukeyManager.detect()', async () => {
      const handler = handlers['ukey:detect'];
      await handler({});
      expect(mockUkeyManager.detect).toHaveBeenCalled();
    });

    it('should return detection result', async () => {
      const handler = handlers['ukey:detect'];
      const result = await handler({});
      expect(result).toHaveProperty('detected');
      expect(result).toHaveProperty('unlocked');
    });

    it('should handle detect errors gracefully', async () => {
      mockUkeyManager.detect.mockRejectedValueOnce(new Error('Detection failed'));
      const handler = handlers['ukey:detect'];
      const result = await handler({});
      expect(result).toHaveProperty('detected', false);
      expect(result).toHaveProperty('error');
    });
  });
```

#### 修改要点：
1. ✅ 从静态属性验证改为真实函数调用测试
2. ✅ 验证 manager 方法被正确调用
3. ✅ 验证返回值结构
4. ✅ 添加错误处理测试

### 后续所有测试：遵循相同模式

- **PIN 管理 (ukey:verify-pin)**
  - 验证 handler 注册
  - 调用 verifyPIN 并验证参数传递
  - 验证返回值
  - 测试错误处理

- **设备信息 (ukey:get-device-info)**
  - 验证 handler 注册
  - 调用 getDeviceInfo 并验证
  - 验证返回值结构
  - 测试 manager 未初始化情况

- **加密操作 (sign/encrypt/decrypt)**
  - 每个都验证 handler 注册和调用
  - 验证返回值
  - 测试参数传递

- **锁定和公钥 (lock/get-public-key)**
  - 验证 handler 注册
  - 调用 manager 方法并验证
  - 验证返回值

- **备用认证 (auth:verify-password)**
  - 验证 handler 注册
  - 测试正确凭据
  - 测试错误凭据
  - 验证返回的用户信息

### 第 405-441 行：总体验证

#### 之前（省略了许多静态验证）：
```javascript
  describe('总体验证', () => {
    it('should have exactly 9 handlers in total', () => {
      expect(Object.keys(expectedHandlers).length).toBe(9);
    });
    // ... 更多静态验证
  });
```

#### 之后：
```javascript
  describe('总体验证', () => {
    it('should register all 9 U-Key IPC handlers', () => {
      expect(Object.keys(handlers).length).toBe(9);
    });

    it('should have all required handler channels', () => {
      expect(handlers['ukey:detect']).toBeDefined();
      expect(handlers['ukey:verify-pin']).toBeDefined();
      expect(handlers['ukey:get-device-info']).toBeDefined();
      expect(handlers['ukey:sign']).toBeDefined();
      expect(handlers['ukey:encrypt']).toBeDefined();
      expect(handlers['ukey:decrypt']).toBeDefined();
      expect(handlers['ukey:lock']).toBeDefined();
      expect(handlers['ukey:get-public-key']).toBeDefined();
      expect(handlers['auth:verify-password']).toBeDefined();
    });

    it('all handlers should be callable functions', () => {
      Object.values(handlers).forEach((handler) => {
        expect(typeof handler).toBe('function');
      });
    });

    it('handlers should support dependency injection', () => {
      const handlers2 = {};
      const mockIpcMain2 = {
        handle: (channel, handler) => {
          handlers2[channel] = handler;
        },
      };
      registerUKeyIPC({
        ukeyManager: mockUkeyManager,
        ipcMain: mockIpcMain2
      });
      expect(Object.keys(handlers2).length).toBe(9);
    });
  });
```

#### 修改要点：
1. ✅ 验证实际注册的 handlers 数量
2. ✅ 验证所有必需的 channels 都被注册
3. ✅ 验证所有 handlers 都是函数
4. ✅ **新增**：添加了依赖注入支持的显式测试

---

## 修改总结

| 方面 | 变化 |
|------|------|
| **代码行数** | 源文件：+5 行；测试文件：-80 行（简化了结构） |
| **导入语句** | 从静态 `require('electron')` 改为动态注入 |
| **Mock 策略** | 从尝试 mock 模块改为创建 mock 对象 |
| **测试类型** | 从静态结构验证改为动态功能测试 |
| **错误处理** | 新增了多个错误场景测试 |
| **依赖注入** | 完全支持，使得测试更加可靠 |
| **代码复用** | 遵循 Organization IPC 和 Import IPC 的模式 |

## 验证清单

- [x] 依赖注入参数添加正确
- [x] Mock 对象创建完整
- [x] 所有 9 个 handlers 都有测试覆盖
- [x] 遵循项目已有的成功模式
- [x] 代码风格一致
- [x] 注释清晰准确
- [x] 错误处理场景覆盖
