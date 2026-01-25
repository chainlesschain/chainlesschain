/**
 * 数据库适配器单元测试
 * 测试目标: src/main/database/database-adapter.js
 * 覆盖场景: 数据库引擎选择、加密检测、回退逻辑
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';

// ============================================================
// CRITICAL: Mock ALL dependencies BEFORE any imports
// ============================================================

// Mock fs module
const fsMock = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn()
};

vi.mock('fs', () => ({
  default: fsMock,
  ...fsMock
}));

// Mock logger to prevent logging interference
vi.mock('../../../src/shared/logger-config.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

// Mock better-sqlite3 to prevent native binding loading
vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: vi.fn(() => ({
    prepare: vi.fn(),
    exec: vi.fn(),
    close: vi.fn()
  }))
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

const MockKeyManager = vi.fn(() => mockKeyManagerInstance);

vi.mock('../../../src/main/database/key-manager', () => ({
  KeyManager: MockKeyManager
}));

// Mock SQLCipher wrapper (CRITICAL: Must be before database-migration mock)
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

vi.mock('./sqlcipher-wrapper', () => ({
  createEncryptedDatabase: mockCreateEncryptedDatabase,
  createUnencryptedDatabase: mockCreateUnencryptedDatabase
}));

// Mock database migration (CRITICAL: Mock all possible paths)
const mockMigrateDatabase = vi.fn().mockResolvedValue({
  success: true,
  message: 'Migration successful',
  rowsProcessed: 100
});

vi.mock('../../../src/main/database/database-migration', () => ({
  migrateDatabase: mockMigrateDatabase
}));

vi.mock('./database-migration', () => ({
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

const mockSqlJsDatabase = vi.fn(() => mockSqlJsDb);
const mockInitSqlJs = vi.fn(() => Promise.resolve({
  Database: mockSqlJsDatabase
}));

// Mock sql.js for both CommonJS and ES modules
vi.mock('sql.js', () => mockInitSqlJs);

describe('DatabaseAdapter', () => {
  let DatabaseAdapter, DatabaseEngine, createDatabaseAdapter;
  let adapter;
  const testDbPath = path.join('/mock/path', 'test.db');

  beforeEach(async () => {
    // 重置所有mocks
    vi.clearAllMocks();

    // Reset fs mocks - 默认返回false避免触发迁移
    // 使用mockReturnValue而不是mockImplementation，这样测试中可以override
    fsMock.existsSync.mockReturnValue(false);
    fsMock.readFileSync.mockReturnValue(Buffer.from([1, 2, 3]));
    fsMock.writeFileSync.mockReturnValue(undefined);
    fsMock.mkdirSync.mockReturnValue(undefined);

    // Reset database mocks
    mockEncryptedDb.open.mockClear();
    mockEncryptedDb.prepare.mockClear();
    mockEncryptedDb.close.mockClear();
    mockEncryptedDb.rekey.mockClear();
    mockCreateEncryptedDatabase.mockReturnValue(mockEncryptedDb);

    mockSqlJsDb.export.mockReturnValue(new Uint8Array([1, 2, 3]));
    mockSqlJsDatabase.mockReturnValue(mockSqlJsDb);
    mockInitSqlJs.mockResolvedValue({ Database: mockSqlJsDatabase });

    // Reset migration mock
    mockMigrateDatabase.mockResolvedValue({
      success: true,
      message: 'Migration successful',
      rowsProcessed: 100
    });

    // Reset KeyManager mock
    mockKeyManagerInstance.initialize.mockResolvedValue(undefined);
    mockKeyManagerInstance.getOrCreateKey.mockResolvedValue({
      key: 'test-key-hex',
      salt: 'test-salt-hex',
      method: 'password'
    });
    mockKeyManagerInstance.deriveKeyFromPassword.mockResolvedValue({
      key: 'new-test-key-hex',
      salt: 'new-test-salt-hex'
    });
    mockKeyManagerInstance.loadKeyMetadata.mockReturnValue(null);
    mockKeyManagerInstance.saveKeyMetadata.mockResolvedValue(undefined);
    mockKeyManagerInstance.close.mockResolvedValue(undefined);

    // 设置默认环境
    process.env.NODE_ENV = 'test';

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
      expect(adapter.encryptionEnabled).toBe(true);
      expect(adapter.autoMigrate).toBe(true);
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
      delete process.env.DEV_DB_PASSWORD;
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
    it('应该在存在加密数据库时返回SQLCipher', () => {
      fsMock.existsSync.mockImplementation((path) => {
        return path.includes('.encrypted.db');
      });

      adapter = new DatabaseAdapter({ dbPath: testDbPath });
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

      fsMock.existsSync.mockReturnValue(false);

      const engine = adapter.detectEngine();

      expect(engine).toBe(DatabaseEngine.SQL_JS);
    });

    it('应该在启用加密时返回SQLCipher', () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: true
      });

      fsMock.existsSync.mockReturnValue(false);

      const engine = adapter.detectEngine();

      expect(engine).toBe(DatabaseEngine.SQLCIPHER);
    });

    it('应该在禁用加密时返回sql.js', () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });

      fsMock.existsSync.mockReturnValue(false);

      const engine = adapter.detectEngine();

      expect(engine).toBe(DatabaseEngine.SQL_JS);
    });
  });

  describe('shouldMigrate', () => {
    it('应该在原数据库存在但加密数据库不存在时返回true', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
      const encryptedPath = adapter.getEncryptedDbPath();

      // Create a fresh mock for each call
      let callCount = 0;
      fsMock.existsSync.mockImplementation((filePath) => {
        callCount++;
        // First call checks dbPath (should exist)
        if (callCount === 1) return true;
        // Second call checks encryptedPath (should not exist)
        if (callCount === 2) return false;
        return false;
      });

      expect(adapter.shouldMigrate()).toBe(true);
    });

    it('应该在原数据库不存在时返回false', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
      const encryptedPath = adapter.getEncryptedDbPath();

      // Mock based on path - both don't exist
      fsMock.existsSync.mockImplementation((filePath) => {
        // Neither path exists
        return false;
      });

      const result = adapter.shouldMigrate();
      expect(result).toBe(false); // dbPath doesn't exist => false
    });

    it('应该在加密数据库已存在时返回false', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
      const encryptedPath = adapter.getEncryptedDbPath();

      // Mock based on path - both exist
      fsMock.existsSync.mockImplementation((filePath) => {
        // Both paths exist
        return true;
      });

      const result = adapter.shouldMigrate();
      expect(result).toBe(false); // dbPath exists but encryptedPath also exists => false
    });
  });

  describe('initialize', () => {
    it('应该成功初始化SQLCipher引擎', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: true,
        password: 'test-password'
      });

      fsMock.existsSync.mockReturnValue(false);

      // Spy on performMigration to prevent actual migration
      vi.spyOn(adapter, 'performMigration').mockResolvedValue({
        success: true,
        message: 'Migration mocked'
      });

      await adapter.initialize();

      expect(adapter.engine).toBe(DatabaseEngine.SQLCIPHER);
      expect(adapter.keyManager).toBeDefined();
      expect(mockKeyManagerInstance.initialize).toHaveBeenCalled();
    });

    it('应该成功初始化sql.js引擎', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });

      fsMock.existsSync.mockReturnValue(false);

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

      fsMock.existsSync.mockImplementation((filePath) => {
        if (filePath === testDbPath) return true;
        if (filePath.includes('.encrypted.db')) return false;
        return false;
      });

      // Spy on performMigration
      const performMigrationSpy = vi.spyOn(adapter, 'performMigration').mockResolvedValue({
        success: true
      });

      await adapter.initialize();

      expect(performMigrationSpy).toHaveBeenCalled();
    });

    it('应该在autoMigrate=false时跳过迁移', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: true,
        autoMigrate: false,
        password: 'test-password'
      });

      fsMock.existsSync.mockImplementation((filePath) => {
        return filePath === testDbPath;
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

      fsMock.existsSync.mockReturnValue(false);
      // Mock performMigration to avoid real migration
      vi.spyOn(adapter, 'performMigration').mockResolvedValue({ success: true });

      await adapter.initialize();

      // Ensure keyManager is the mock instance
      if (!adapter.keyManager || adapter.keyManager !== mockKeyManagerInstance) {
        adapter.keyManager = mockKeyManagerInstance;
      }
    });

    it('应该从KeyManager获取密钥', async () => {
      const keyResult = await adapter.getEncryptionKey();

      expect(keyResult).toBeDefined();
      expect(keyResult.key).toBe('test-key-hex');
      expect(keyResult.method).toBe('password');
      expect(mockKeyManagerInstance.getOrCreateKey).toHaveBeenCalled();
    });

    it('应该在开发模式无密码时使用默认密码', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DEV_DB_PASSWORD;

      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: null,
        encryptionEnabled: true // Force encryption to initialize keyManager
      });
      adapter.developmentMode = true;

      fsMock.existsSync.mockReturnValue(false);
      vi.spyOn(adapter, 'performMigration').mockResolvedValue({ success: true });

      await adapter.initialize();

      // Ensure keyManager is the mock instance
      if (!adapter.keyManager) {
        adapter.keyManager = mockKeyManagerInstance;
      }

      await adapter.getEncryptionKey();

      expect(mockKeyManagerInstance.getOrCreateKey).toHaveBeenCalledWith(
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

      fsMock.existsSync.mockReturnValue(false);
      vi.spyOn(adapter, 'performMigration').mockResolvedValue({ success: true });
      await adapter.initialize();

      // Ensure keyManager is properly mocked
      if (!adapter.keyManager) {
        adapter.keyManager = mockKeyManagerInstance;
      }

      // Clear mock call history
      mockCreateEncryptedDatabase.mockClear();
      mockEncryptedDb.open.mockClear();

      const db = await adapter.createSQLCipherDatabase();

      expect(mockCreateEncryptedDatabase).toHaveBeenCalled();
      expect(mockEncryptedDb.open).toHaveBeenCalled();
      expect(db).toBe(mockEncryptedDb);
    });
  });

  describe('createSqlJsDatabase', () => {
    it('应该创建sql.js数据库实例（新数据库）', async () => {
      // Mock sql.js file path finding
      fsMock.existsSync.mockImplementation((filePath) => {
        // Return true for sql.js WASM file
        if (filePath.includes('sql-wasm.wasm')) return true;
        // Return false for database files
        if (filePath === testDbPath) return false;
        return false;
      });

      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });

      fsMock.readFileSync.mockClear();

      await adapter.initialize();

      const db = await adapter.createSqlJsDatabase();

      // Verify database instance was created (sql.js loads via require, so we can't spy on it)
      expect(db).toBeDefined();
      expect(db.run).toBeDefined();
      expect(db.exec).toBeDefined();
      expect(fsMock.readFileSync).not.toHaveBeenCalled(); // New database shouldn't read from file
    });

    it('应该加载现有的sql.js数据库', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });

      await adapter.initialize();

      // Set up mocks AFTER initialize to ensure they work for createSqlJsDatabase
      fsMock.existsSync.mockImplementation((filePath) => {
        // Return true for sql.js WASM file and existing database
        if (filePath.includes('sql-wasm.wasm')) return true;
        if (filePath === testDbPath || filePath.includes('test.db')) return true;
        return false;
      });

      const testBuffer = Buffer.from([1, 2, 3]);
      fsMock.readFileSync.mockReturnValue(testBuffer);
      fsMock.readFileSync.mockClear(); // Clear to track new calls

      const db = await adapter.createSqlJsDatabase();

      // Verify existing database was loaded from file
      expect(db).toBeDefined();
      expect(fsMock.readFileSync).toHaveBeenCalled();
      // Note: Can't check exact path due to path normalization in the implementation
    });
  });

  describe('saveDatabase', () => {
    it('应该保存sql.js数据库到文件', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
      adapter.engine = DatabaseEngine.SQL_JS;

      const mockData = new Uint8Array([1, 2, 3]);
      const mockDb = {
        export: vi.fn(() => mockData)
      };

      // Mock fs for directory check - directory exists
      fsMock.existsSync.mockReturnValue(true);
      // Clear writeFileSync history
      fsMock.writeFileSync.mockClear();

      adapter.saveDatabase(mockDb);

      // Verify export was called
      expect(mockDb.export).toHaveBeenCalled();

      // Verify writeFileSync was called
      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        testDbPath,
        expect.any(Buffer)
      );
    });

    it('应该在目录不存在时创建目录', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
      adapter.engine = DatabaseEngine.SQL_JS;

      const mockData = new Uint8Array([1, 2, 3]);
      const mockDb = {
        export: vi.fn(() => mockData)
      };

      // Mock fs for directory check - directory doesn't exist
      fsMock.existsSync.mockReturnValue(false);
      fsMock.mkdirSync.mockClear();
      fsMock.writeFileSync.mockClear();

      adapter.saveDatabase(mockDb);

      expect(mockDb.export).toHaveBeenCalled();
      expect(fsMock.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true })
      );
      expect(fsMock.writeFileSync).toHaveBeenCalled();
    });

    it('应该在SQLCipher模式下跳过保存（自动保存）', () => {
      adapter = new DatabaseAdapter({ dbPath: testDbPath });
      adapter.engine = DatabaseEngine.SQLCIPHER;

      adapter.saveDatabase(mockEncryptedDb);

      expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('应该关闭keyManager', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: 'test-password',
        encryptionEnabled: true
      });

      fsMock.existsSync.mockReturnValue(false);
      vi.spyOn(adapter, 'performMigration').mockResolvedValue({ success: true });
      await adapter.initialize();

      // Ensure keyManager is the mock instance
      adapter.keyManager = mockKeyManagerInstance;

      // Clear previous calls
      mockKeyManagerInstance.close.mockClear();

      await adapter.close();

      expect(mockKeyManagerInstance.close).toHaveBeenCalled();
    });

    it('应该在keyManager不存在时正常关闭', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: false
      });

      vi.spyOn(adapter, 'performMigration').mockResolvedValue({ success: true });
      await adapter.initialize();

      await expect(adapter.close()).resolves.not.toThrow();
    });
  });

  describe('辅助方法', () => {
    beforeEach(async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: 'test-password'
      });

      fsMock.existsSync.mockReturnValue(false);
      vi.spyOn(adapter, 'performMigration').mockResolvedValue({ success: true });
      await adapter.initialize();
    });

    it('getEngine应该返回当前引擎', () => {
      const engine = adapter.getEngine();

      expect(engine).toBeDefined();
      expect([DatabaseEngine.SQL_JS, DatabaseEngine.SQLCIPHER]).toContain(engine);
    });

    it('isEncrypted应该在使用SQLCipher时返回true', async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        encryptionEnabled: true,
        password: 'test-password'
      });

      vi.spyOn(adapter, 'performMigration').mockResolvedValue({ success: true });
      await adapter.initialize();

      const isEncrypted = adapter.isEncrypted();

      expect(isEncrypted).toBe(true);
    });
  });

  describe('changePassword', () => {
    beforeEach(async () => {
      adapter = new DatabaseAdapter({
        dbPath: testDbPath,
        password: 'old-password'
      });
      adapter.encryptionEnabled = true;

      fsMock.existsSync.mockReturnValue(false);
      vi.spyOn(adapter, 'performMigration').mockResolvedValue({ success: true });
      await adapter.initialize();
      adapter.engine = DatabaseEngine.SQLCIPHER;
    });

    it('应该成功修改数据库密码', async () => {
      const oldPassword = 'old-password';
      const newPassword = 'new-password';

      // Mock验证旧密码成功
      const verifyDb = {
        open: vi.fn(),
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({ count: 1 }))
        })),
        close: vi.fn()
      };
      mockCreateEncryptedDatabase.mockReturnValueOnce(verifyDb);

      const result = await adapter.changePassword(oldPassword, newPassword, mockEncryptedDb);

      expect(result.success).toBe(true);
      expect(mockEncryptedDb.rekey).toHaveBeenCalled();
      expect(adapter.password).toBe(newPassword);
    });

    it('应该在旧密码错误时抛出错误', async () => {
      const failingDb = {
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
      fsMock.existsSync.mockReturnValue(false);

      // Mock performMigration on the prototype before creating instance
      const mockPerformMigration = vi.fn().mockResolvedValue({ success: true });
      DatabaseAdapter.prototype.performMigration = mockPerformMigration;

      const createdAdapter = await createDatabaseAdapter({
        dbPath: testDbPath,
        password: 'test-password'
      });

      expect(createdAdapter).toBeInstanceOf(DatabaseAdapter);
      expect(createdAdapter.engine).toBeDefined();
    });
  });
});

