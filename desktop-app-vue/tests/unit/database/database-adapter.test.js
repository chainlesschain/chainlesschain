/**
 * 数据库适配器单元测试
 * 测试目标: src/main/database/database-adapter.js
 * 覆盖场景: 数据库引擎选择、加密检测、回退逻辑
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn()
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn()
}));

// Mock KeyManager
const mockKeyManagerInstance = {
  initialize: vi.fn().mockResolvedValue(undefined),
  getOrCreateKey: vi.fn().mockResolvedValue({
    key: 'test-key-hex',
    salt: 'test-salt-hex',
    method: 'password'
  }),
  deriveKeyFromPassword: vi.fn().mockResolvedValue({
    key: 'new-test-key-hex',
    salt: 'new-test-salt-hex'
  }),
  saveKeyMetadata: vi.fn().mockResolvedValue(undefined),
  loadKeyMetadata: vi.fn().mockReturnValue(null),
  close: vi.fn().mockResolvedValue(undefined)
};

const MockKeyManager = vi.fn().mockImplementation(() => mockKeyManagerInstance);

vi.mock('../../../src/main/database/key-manager', () => ({
  KeyManager: MockKeyManager
}));

vi.mock('@main/database/key-manager', () => ({
  KeyManager: MockKeyManager
}));

// Mock SQLCipher wrapper
const mockEncryptedDb = {
  open: vi.fn(),
  prepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(() => ({ count: 1 })),
    all: vi.fn()
  })),
  exec: vi.fn(),
  close: vi.fn(),
  rekey: vi.fn()
};

const mockCreateEncryptedDatabase = vi.fn(() => mockEncryptedDb);
const mockCreateUnencryptedDatabase = vi.fn(() => mockEncryptedDb);

vi.mock('../../../src/main/database/sqlcipher-wrapper', () => ({
  createEncryptedDatabase: mockCreateEncryptedDatabase,
  createUnencryptedDatabase: mockCreateUnencryptedDatabase
}));

vi.mock('@main/database/sqlcipher-wrapper', () => ({
  createEncryptedDatabase: mockCreateEncryptedDatabase,
  createUnencryptedDatabase: mockCreateUnencryptedDatabase
}));

// Mock database migration - use both relative and main paths
const mockMigrateDatabase = vi.fn().mockResolvedValue({
  success: true,
  message: 'Migration successful',
  rowsProcessed: 100
});

vi.mock('../../../src/main/database/database-migration', () => ({
  migrateDatabase: mockMigrateDatabase
}));

vi.mock('@main/database/database-migration', () => ({
  migrateDatabase: mockMigrateDatabase
}));

// Mock sql.js
const mockSqlJsDb = {
  run: vi.fn(),
  exec: vi.fn(),
  export: vi.fn(() => new Uint8Array([1, 2, 3])),
  close: vi.fn()
};

vi.mock('sql.js', () => ({
  default: vi.fn(() => Promise.resolve({
    Database: vi.fn(() => mockSqlJsDb)
  }))
}));

describe('DatabaseAdapter', () => {
  let DatabaseAdapter, DatabaseEngine, createDatabaseAdapter;
  let adapter;
  const testDbPath = path.join('/mock/path', 'test.db');

  beforeEach(async () => {
    // 重置所有mocks
    vi.clearAllMocks();

    // Reset mock implementations
    mockEncryptedDb.open.mockClear();
    mockEncryptedDb.prepare.mockClear();
    mockEncryptedDb.close.mockClear();
    mockEncryptedDb.rekey.mockClear();
    mockCreateEncryptedDatabase.mockReturnValue(mockEncryptedDb);
    mockMigrateDatabase.mockResolvedValue({
      success: true,
      message: 'Migration successful',
      rowsProcessed: 100
    });
    mockKeyManagerInstance.getOrCreateKey.mockResolvedValue({
      key: 'test-key-hex',
      salt: 'test-salt-hex',
      method: 'password'
    });

    // 设置默认环境
    process.env.NODE_ENV = 'test';

    // 默认文件不存在
    fs.existsSync.mockReturnValue(false);

    // 动态导入被测模块
    const module = await import('../../../src/main/database/database-adapter.js');
    DatabaseAdapter = module.DatabaseAdapter;
    DatabaseEngine = module.DatabaseEngine;
    createDatabaseAdapter = module.createDatabaseAdapter;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('构造函数', () => {
    it('应该使用默认选项创建实例', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });

      expect(adapter.dbPath).toBe(testDbPath);
      expect(adapter.encryptionEnabled).toBe(true); // 默认启用
      expect(adapter.autoMigrate).toBe(true); // 默认自动迁移
    });

    it('应该支持禁用加密', () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });

      expect(adapter.encryptionEnabled).toBe(false);
    });

    it('应该支持禁用自动迁移', () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        autoMigrate: false
      });

      expect(adapter.autoMigrate).toBe(false);
    });
  });

  describe('isDevelopmentMode', () => {
    it('应该在NODE_ENV=development时返回true', () => {
      process.env.NODE_ENV = 'development';
      adapter = new DatabaseAdapter({ dbPath: testDbPath });

      expect(adapter.isDevelopmentMode()).toBe(true);
    });

    it('应该在NODE_ENV=production时返回false', () => {
      process.env.NODE_ENV = 'production';
      adapter = new DatabaseAdapter({ dbPath: testDbPath });

      expect(adapter.isDevelopmentMode()).toBe(false);
    });

    it('应该在未设置NODE_ENV时返回true', () => {
      delete process.env.NODE_ENV;
      adapter = new DatabaseAdapter({ dbPath: testDbPath });

      expect(adapter.isDevelopmentMode()).toBe(true);
    });
  });

  describe('getDevDefaultPassword', () => {
    it('应该返回环境变量中的密码', () => {
      process.env.DEV_DB_PASSWORD = 'custom_dev_password';
      adapter = new DatabaseAdapter({ dbPath: testDbPath });

      expect(adapter.getDevDefaultPassword()).toBe('custom_dev_password');
    });

    it('应该在未设置环境变量时返回默认密码', () => {
      delete process.env.DEV_DB_PASSWORD;
      adapter = new DatabaseAdapter({ dbPath: testDbPath });

      expect(adapter.getDevDefaultPassword()).toBe('dev_password_2024');
    });
  });

  describe('getEncryptedDbPath', () => {
    it('应该正确生成加密数据库路径', () => {
      adapter = new DatabaseAdapter({ dbPath: '/path/to/database.db' });

      const encryptedPath = adapter.getEncryptedDbPath();

      expect(encryptedPath).toBe('/path/to/database.encrypted.db');
    });

    it('应该处理没有扩展名的路径', () => {
      adapter = new DatabaseAdapter({ dbPath: '/path/to/database' });

      const encryptedPath = adapter.getEncryptedDbPath();

      expect(encryptedPath).toBe('/path/to/database.encrypted');
    });
  });

  describe('detectEngine', () => {
    beforeEach(() => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
    });

    it('应该在存在加密数据库时返回SQLCipher', () => {
      // Mock加密数据库存在
      fs.existsSync.mockImplementation((path) => {
        return path.includes('.encrypted.db');
      });

      const engine = adapter.detectEngine();

      expect(engine).toBe(DatabaseEngine.SQLCIPHER);
    });

    it('应该在开发模式且无密码时返回sql.js', () => {
      process.env.NODE_ENV = 'development';
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: null
      });
      adapter.developmentMode = true;

      fs.existsSync.mockReturnValue(false);

      const engine = adapter.detectEngine();

      expect(engine).toBe(DatabaseEngine.SQL_JS);
    });

    it('应该在启用加密时返回SQLCipher', () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: true
      });

      fs.existsSync.mockReturnValue(false);

      const engine = adapter.detectEngine();

      expect(engine).toBe(DatabaseEngine.SQLCIPHER);
    });

    it('应该在禁用加密时返回sql.js', () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });

      fs.existsSync.mockReturnValue(false);

      const engine = adapter.detectEngine();

      expect(engine).toBe(DatabaseEngine.SQL_JS);
    });
  });

  describe('shouldMigrate', () => {
    beforeEach(() => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
    });

    it('应该在原数据库存在但加密数据库不存在时返回true', () => {
      fs.existsSync.mockImplementation((path) => {
        return path === testDbPath; // 仅原数据库存在
      });

      expect(adapter.shouldMigrate()).toBe(true);
    });

    it('应该在原数据库不存在时返回false', () => {
      fs.existsSync.mockReturnValue(false);

      expect(adapter.shouldMigrate()).toBe(false);
    });

    it('应该在加密数据库已存在时返回false', () => {
      fs.existsSync.mockReturnValue(true); // 两个数据库都存在

      expect(adapter.shouldMigrate()).toBe(false);
    });
  });

  describe('initialize', () => {
    it('应该成功初始化SQLCipher引擎', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: true
      });

      fs.existsSync.mockReturnValue(false);

      await adapter.initialize();

      expect(adapter.engine).toBe(DatabaseEngine.SQLCIPHER);
      expect(adapter.keyManager).toBeDefined();
    });

    it('应该成功初始化sql.js引擎', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });

      fs.existsSync.mockReturnValue(false);

      await adapter.initialize();

      expect(adapter.engine).toBe(DatabaseEngine.SQL_JS);
      expect(adapter.keyManager).toBeNull();
    });

    it('应该在需要时自动执行迁移', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: true,
        autoMigrate: true,
        password: 'test-password'
      });

      // Mock需要迁移的场景
      fs.existsSync.mockImplementation((path) => {
        if (path === testDbPath) return true; // 原数据库存在
        if (path.includes('.encrypted.db')) return false; // 加密数据库不存在
        return false;
      });

      await adapter.initialize();

      expect(mockMigrateDatabase).toHaveBeenCalled();
    });

    it('应该在autoMigrate=false时跳过迁移', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: true,
        autoMigrate: false,
        password: 'test-password'
      });

      fs.existsSync.mockImplementation((path) => {
        return path === testDbPath;
      });

      await adapter.initialize();

      expect(mockMigrateDatabase).not.toHaveBeenCalled();
    });
  });

  describe('getEncryptionKey', () => {
    beforeEach(async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: 'test-password'
      });
      await adapter.initialize();
    });

    it('应该从KeyManager获取密钥', async () => {
      const keyResult = await adapter.getEncryptionKey();

      expect(keyResult).toBeDefined();
      expect(keyResult.key).toBe('test-key-hex');
      expect(keyResult.method).toBe('password');
    });

    it('应该在开发模式无密码时使用默认密码', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DEV_DB_PASSWORD;

      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: null
      });
      adapter.developmentMode = true;
      await adapter.initialize();

      const keyResult = await adapter.getEncryptionKey();

      expect(adapter.keyManager.getOrCreateKey).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'dev_password_2024'
        })
      );
    });

    it('应该在keyManager未初始化时抛出错误', async () => {
      adapter.keyManager = null;

      await expect(adapter.getEncryptionKey()).rejects.toThrow('密钥管理器未初始化');
    });
  });

  describe('createSQLCipherDatabase', () => {
    it('应该创建SQLCipher数据库实例', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: 'test-password'
      });
      await adapter.initialize();

      const db = await adapter.createSQLCipherDatabase();

      expect(mockCreateEncryptedDatabase).toHaveBeenCalled();
      expect(mockEncryptedDb.open).toHaveBeenCalled();
      expect(db).toBe(mockEncryptedDb);
    });
  });

  describe('createSqlJsDatabase', () => {
    it('应该创建sql.js数据库实例（新数据库）', async () => {
      fs.existsSync.mockReturnValue(false);

      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });
      await adapter.initialize();

      const db = await adapter.createSqlJsDatabase();

      expect(db).toBeDefined();
      expect(db).toBe(mockSqlJsDb);
    });

    it('应该加载现有的sql.js数据库', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(Buffer.from([1, 2, 3]));

      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });
      await adapter.initialize();

      const db = await adapter.createSqlJsDatabase();

      expect(fs.readFileSync).toHaveBeenCalledWith(testDbPath);
      expect(db).toBeDefined();
    });
  });

  describe('saveDatabase', () => {
    it('应该保存sql.js数据库到文件', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
      adapter.engine = DatabaseEngine.SQL_JS;

      const mockData = new Uint8Array([1, 2, 3]);
      mockSqlJsDb.export.mockReturnValue(mockData);

      adapter.saveDatabase(mockSqlJsDb);

      expect(mockSqlJsDb.export).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        testDbPath,
        expect.any(Buffer)
      );
    });

    it('应该在目录不存在时创建目录', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
      adapter.engine = DatabaseEngine.SQL_JS;

      fs.existsSync.mockReturnValue(false);
      mockSqlJsDb.export.mockReturnValue(new Uint8Array([1, 2, 3]));

      adapter.saveDatabase(mockSqlJsDb);

      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('应该在SQLCipher模式下跳过保存（自动保存）', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
      adapter.engine = DatabaseEngine.SQLCIPHER;

      adapter.saveDatabase(mockEncryptedDb);

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('应该关闭keyManager', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: 'test-password'
      });
      await adapter.initialize();

      await adapter.close();

      expect(adapter.keyManager.close).toHaveBeenCalled();
    });

    it('应该在keyManager不存在时正常关闭', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });
      await adapter.initialize();

      await expect(adapter.close()).resolves.not.toThrow();
    });
  });

  describe('辅助方法', () => {
    beforeEach(() => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
    });

    it('getEngine应该返回当前引擎', async () => {
      await adapter.initialize();

      const engine = adapter.getEngine();

      expect(engine).toBeDefined();
      expect([DatabaseEngine.SQL_JS, DatabaseEngine.SQLCIPHER]).toContain(engine);
    });

    it('isEncrypted应该在使用SQLCipher时返回true', async () => {
      adapter.encryptionEnabled = true;
      await adapter.initialize();

      const isEncrypted = adapter.isEncrypted();

      expect(isEncrypted).toBe(adapter.engine === DatabaseEngine.SQLCIPHER);
    });
  });

  describe('changePassword', () => {
    beforeEach(async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: 'old-password'
      });
      adapter.encryptionEnabled = true;
      await adapter.initialize();
      adapter.engine = DatabaseEngine.SQLCIPHER;
    });

    it('应该成功修改数据库密码', async () => {
      const oldPassword = 'old-password';
      const newPassword = 'new-password';

      const result = await adapter.changePassword(oldPassword, newPassword, mockEncryptedDb);

      expect(result.success).toBe(true);
      expect(mockEncryptedDb.rekey).toHaveBeenCalled();
      expect(adapter.password).toBe(newPassword);
    });

    it('应该在旧密码错误时抛出错误', async () => {
      // Mock数据库打开失败
      const failingDb = {
        ...mockEncryptedDb,
        open: vi.fn(),
        prepare: vi.fn(() => {
          throw new Error('Invalid password');
        }),
        close: vi.fn()
      };
      mockCreateEncryptedDatabase.mockReturnValueOnce(failingDb);

      await expect(
        adapter.changePassword('wrong-password', 'new-password', mockEncryptedDb)
      ).rejects.toThrow('旧密码验证失败');
    });

    it('应该在未加密数据库上抛出错误', async () => {
      adapter.engine = DatabaseEngine.SQL_JS;

      await expect(
        adapter.changePassword('old', 'new', mockSqlJsDb)
      ).rejects.toThrow('数据库未使用加密，无法修改密码');
    });

    it('应该在keyManager未初始化时抛出错误', async () => {
      adapter.keyManager = null;

      await expect(
        adapter.changePassword('old', 'new', mockEncryptedDb)
      ).rejects.toThrow('密钥管理器未初始化');
    });
  });

  describe('createDatabaseAdapter工厂函数', () => {
    it('应该创建并初始化DatabaseAdapter', async () => {
      fs.existsSync.mockReturnValue(false);

      const adapter = await createDatabaseAdapter({
        dbPath: testDbPath,
        password: 'test-password'
      });

      expect(adapter).toBeInstanceOf(DatabaseAdapter);
      expect(adapter.engine).toBeDefined();
    });
  });
});
