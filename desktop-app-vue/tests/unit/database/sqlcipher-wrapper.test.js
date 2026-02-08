/**
 * SQLCipher包装器单元测试
 * 测试目标: src/main/database/sqlcipher-wrapper.js
 * 覆盖场景: StatementWrapper、SQLCipherWrapper、加密配置、备份
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================================
// CRITICAL: Mock ALL dependencies BEFORE any imports
// ============================================================

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

// Mock better-sqlite3-multiple-ciphers (not used directly - tests use DI)
vi.mock("better-sqlite3-multiple-ciphers", () => ({
  default: vi.fn(),
}));

// Mock fs module
const mockReadFileSync = vi.fn(() => Buffer.from("database-content"));
const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn(() => true);

vi.mock("fs", () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    existsSync: mockExistsSync,
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    existsSync: mockExistsSync,
  },
}));

describe("SQLCIPHER_CONFIG", () => {
  let SQLCIPHER_CONFIG;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module =
      await import("../../../src/main/database/sqlcipher-wrapper.js");
    SQLCIPHER_CONFIG = module.SQLCIPHER_CONFIG;
  });

  it("应该定义version为4", () => {
    expect(SQLCIPHER_CONFIG.version).toBe(4);
  });

  it("应该定义pageSize为4096", () => {
    expect(SQLCIPHER_CONFIG.pageSize).toBe(4096);
  });

  it("应该定义kdfIterations为256000", () => {
    expect(SQLCIPHER_CONFIG.kdfIterations).toBe(256000);
  });

  it("应该定义hmacAlgorithm为1 (HMAC_SHA1)", () => {
    expect(SQLCIPHER_CONFIG.hmacAlgorithm).toBe(1);
  });

  it("应该定义kdfAlgorithm为2 (PBKDF2_HMAC_SHA512)", () => {
    expect(SQLCIPHER_CONFIG.kdfAlgorithm).toBe(2);
  });
});

describe("StatementWrapper", () => {
  let StatementWrapper;
  let mockDb;
  let mockStmt;
  let stmt;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockStmt = {
      bind: vi.fn(),
      get: vi.fn(() => ({ id: 1, name: "test" })),
      all: vi.fn(() => [{ id: 1 }, { id: 2 }]),
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
      columns: vi.fn(() => [{ name: "id" }, { name: "name" }]),
    };

    mockDb = {
      prepare: vi.fn(() => mockStmt),
    };

    const module =
      await import("../../../src/main/database/sqlcipher-wrapper.js");
    StatementWrapper = module.StatementWrapper;
  });

  afterEach(() => {
    if (stmt) {
      stmt.free();
      stmt = null;
    }
  });

  describe("构造函数", () => {
    it("应该成功创建实例并准备语句", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test");

      expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM test");
      expect(stmt.stmt).toBe(mockStmt);
      expect(stmt.sql).toBe("SELECT * FROM test");
    });

    it("应该在prepare失败时抛出错误", () => {
      mockDb.prepare.mockImplementationOnce(() => {
        throw new Error('near "INVALID": syntax error');
      });

      expect(() => new StatementWrapper(mockDb, "INVALID SQL")).toThrow(
        "SQL prepare error",
      );
    });
  });

  describe("bind", () => {
    it("应该支持数组参数绑定", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test WHERE id = ?");

      const result = stmt.bind([1, "test"]);

      expect(mockStmt.bind).toHaveBeenCalledWith([1, "test"]);
      expect(result).toBe(true);
    });

    it("应该支持对象参数绑定", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test WHERE id = :id");

      const result = stmt.bind({ id: 1 });

      expect(mockStmt.bind).toHaveBeenCalledWith({ id: 1 });
      expect(result).toBe(true);
    });

    it("应该在绑定失败时抛出错误", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test");
      mockStmt.bind.mockImplementationOnce(() => {
        throw new Error("column index out of range");
      });

      expect(() => stmt.bind([1, 2, 3])).toThrow("Bind error");
    });
  });

  describe("get", () => {
    it("应该执行并返回单行结果", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test WHERE id = ?");

      const result = stmt.get(1);

      expect(result).toEqual({ id: 1, name: "test" });
      expect(mockStmt.get).toHaveBeenCalledWith(1);
    });

    it("应该在无结果时返回null", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test WHERE id = ?");
      mockStmt.get.mockReturnValueOnce(undefined);

      const result = stmt.get(999);

      expect(result).toBeNull();
    });

    it("应该在执行失败时抛出错误", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test");
      mockStmt.get.mockImplementationOnce(() => {
        throw new Error("no such table: test");
      });

      expect(() => stmt.get()).toThrow("Get error");
    });
  });

  describe("all", () => {
    it("应该执行并返回所有行", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test");

      const result = stmt.all();

      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      expect(mockStmt.all).toHaveBeenCalled();
    });

    it("应该支持PRAGMA查询返回对象", () => {
      stmt = new StatementWrapper(mockDb, "PRAGMA table_info(test)");
      mockStmt.all.mockReturnValueOnce([
        { cid: 0, name: "id", type: "INTEGER" },
        { cid: 1, name: "name", type: "TEXT" },
      ]);

      const result = stmt.all();

      expect(result).toEqual([
        { cid: 0, name: "id", type: "INTEGER" },
        { cid: 1, name: "name", type: "TEXT" },
      ]);
    });

    it("应该在执行失败时抛出错误", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test");
      mockStmt.all.mockImplementationOnce(() => {
        throw new Error("no such table: test");
      });

      expect(() => stmt.all()).toThrow("All error");
    });
  });

  describe("run", () => {
    it("应该执行INSERT/UPDATE/DELETE并返回结果", () => {
      stmt = new StatementWrapper(mockDb, "INSERT INTO test (name) VALUES (?)");

      const result = stmt.run("Alice");

      expect(result).toEqual({ changes: 1, lastInsertRowid: 1 });
      expect(mockStmt.run).toHaveBeenCalledWith("Alice");
    });

    it("应该返回changes和lastInsertRowid", () => {
      stmt = new StatementWrapper(
        mockDb,
        "UPDATE test SET name = ? WHERE id = ?",
      );
      mockStmt.run.mockReturnValueOnce({ changes: 3, lastInsertRowid: 0 });

      const result = stmt.run("Bob", 1);

      expect(result.changes).toBe(3);
      expect(result.lastInsertRowid).toBe(0);
    });

    it("应该在执行失败时抛出错误", () => {
      stmt = new StatementWrapper(mockDb, "INSERT INTO test (name) VALUES (?)");
      mockStmt.run.mockImplementationOnce(() => {
        throw new Error("UNIQUE constraint failed");
      });

      expect(() => stmt.run("duplicate")).toThrow("Run error");
    });
  });

  describe("getColumnNames", () => {
    it("应该返回列名数组", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test");

      const columns = stmt.getColumnNames();

      expect(columns).toEqual(["id", "name"]);
      expect(mockStmt.columns).toHaveBeenCalled();
    });
  });

  describe("step", () => {
    it("应该返回false（better-sqlite3不需要step）", () => {
      stmt = new StatementWrapper(mockDb, "SELECT 1");

      const result = stmt.step();

      expect(result).toBe(false);
    });
  });

  describe("getAsObject", () => {
    it("应该返回null（新版API不使用）", () => {
      stmt = new StatementWrapper(mockDb, "SELECT 1");

      const result = stmt.getAsObject();

      expect(result).toBeNull();
    });
  });

  describe("free", () => {
    it("应该释放语句", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test");
      expect(stmt.stmt).not.toBeNull();

      stmt.free();

      expect(stmt.stmt).toBeNull();
      stmt = null;
    });
  });

  describe("finalize", () => {
    it("应该调用free方法", () => {
      stmt = new StatementWrapper(mockDb, "SELECT * FROM test");
      const freeSpy = vi.spyOn(stmt, "free");

      stmt.finalize();

      expect(freeSpy).toHaveBeenCalled();
      expect(stmt.stmt).toBeNull();
      stmt = null;
    });
  });
});

describe("SQLCipherWrapper", () => {
  let SQLCipherWrapper;
  let wrapper;
  let localMockDbInstance;
  let LocalMockDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();

    localMockDbInstance = {
      prepare: vi.fn(() => ({
        bind: vi.fn(),
        get: vi.fn(() => ({ count: 0 })),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
        columns: vi.fn(() => [{ name: "id" }, { name: "value" }]),
      })),
      exec: vi.fn(),
      pragma: vi.fn(),
      close: vi.fn(),
      backup: vi.fn(() => ({
        step: vi.fn(),
        finish: vi.fn(),
      })),
    };

    LocalMockDatabase = vi.fn(() => localMockDbInstance);

    const module =
      await import("../../../src/main/database/sqlcipher-wrapper.js");
    SQLCipherWrapper = module.SQLCipherWrapper;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.close();
      wrapper = null;
    }
  });

  describe("构造函数", () => {
    it("应该创建实例并存储路径", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite");

      expect(wrapper.dbPath).toBe("/test/db.sqlite");
      expect(wrapper.db).toBeNull();
    });

    it("应该接受选项参数", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", { key: "testkey" });

      expect(wrapper.key).toBe("testkey");
      expect(wrapper.options.key).toBe("testkey");
    });

    it("应该设置兼容性标记", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite");

      expect(wrapper.__betterSqliteCompat).toBe(true);
    });

    it("应该在未提供key时将key设为null", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite");

      expect(wrapper.key).toBeNull();
    });
  });

  describe("open", () => {
    it("应该成功打开未加密数据库", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);

      wrapper.open();

      expect(LocalMockDatabase).toHaveBeenCalledWith("/test/db.sqlite", {});
      expect(wrapper.db).toBe(localMockDbInstance);
    });

    it("应该成功打开加密数据库", () => {
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "abc123" },
        LocalMockDatabase,
      );

      wrapper.open();

      expect(LocalMockDatabase).toHaveBeenCalledWith("/test/db.sqlite", {
        key: "abc123",
      });
      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "key = \"x'abc123'\"",
      );
    });

    it("应该启用外键约束", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);

      wrapper.open();

      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "foreign_keys = ON",
      );
    });

    it("应该启用WAL模式", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);

      wrapper.open();

      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "journal_mode = WAL",
      );
      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "synchronous = NORMAL",
      );
    });

    it("应该在WAL模式失败时继续", () => {
      localMockDbInstance.pragma.mockImplementation((sql) => {
        if (sql === "journal_mode = WAL") {
          throw new Error("WAL not supported");
        }
      });
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);

      expect(() => wrapper.open()).not.toThrow();
      expect(wrapper.db).toBe(localMockDbInstance);
    });

    it("应该在已打开时跳过", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();
      LocalMockDatabase.mockClear();

      wrapper.open();

      expect(LocalMockDatabase).not.toHaveBeenCalled();
    });

    it("应该在打开失败时抛出错误", () => {
      const FailingDatabase = vi.fn(() => {
        throw new Error("unable to open database file");
      });
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, FailingDatabase);

      expect(() => wrapper.open()).toThrow("Failed to open database");
    });
  });

  describe("_setupEncryption", () => {
    it("应该设置加密密钥", () => {
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "abc123" },
        LocalMockDatabase,
      );
      wrapper.open();

      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "key = \"x'abc123'\"",
      );
    });

    it("应该配置SQLCipher参数", () => {
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "abc123" },
        LocalMockDatabase,
      );
      wrapper.open();

      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "cipher_page_size = 4096",
      );
      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "kdf_iter = 256000",
      );
      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "cipher_hmac_algorithm = 1",
      );
      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "cipher_kdf_algorithm = 2",
      );
    });

    it("应该验证密钥正确性", () => {
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "abc123" },
        LocalMockDatabase,
      );
      wrapper.open();

      expect(localMockDbInstance.prepare).toHaveBeenCalledWith(
        "SELECT count(*) FROM sqlite_master",
      );
    });

    it("应该在密钥无效时抛出错误", () => {
      localMockDbInstance.prepare.mockImplementationOnce(() => {
        throw new Error("file is not a database");
      });
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "badkey" },
        LocalMockDatabase,
      );

      expect(() => wrapper.open()).toThrow("Failed to open database");
    });

    it("应该在数据库未打开时抛出错误", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite");

      expect(() => wrapper._setupEncryption("testkey")).toThrow(
        "Database not opened",
      );
    });
  });

  describe("prepare", () => {
    it("应该准备SQL语句", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();

      const stmt = wrapper.prepare("SELECT * FROM test");

      expect(stmt).toBeDefined();
      expect(stmt.sql).toBe("SELECT * FROM test");
    });

    it("应该在数据库未打开时自动打开", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);

      const stmt = wrapper.prepare("SELECT 1");

      expect(LocalMockDatabase).toHaveBeenCalled();
      expect(wrapper.db).toBe(localMockDbInstance);
      expect(stmt).toBeDefined();
    });

    it("应该返回StatementWrapper实例", async () => {
      const module =
        await import("../../../src/main/database/sqlcipher-wrapper.js");
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();

      const stmt = wrapper.prepare("SELECT * FROM test");

      expect(stmt).toBeInstanceOf(module.StatementWrapper);
    });
  });

  describe("exec", () => {
    it("应该执行SQL语句", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();

      wrapper.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      expect(localMockDbInstance.exec).toHaveBeenCalledWith(
        "CREATE TABLE test (id INTEGER PRIMARY KEY)",
      );
    });

    it("应该在数据库未打开时自动打开", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);

      wrapper.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      expect(LocalMockDatabase).toHaveBeenCalled();
      expect(localMockDbInstance.exec).toHaveBeenCalled();
    });

    it("应该在执行失败时抛出错误", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();
      localMockDbInstance.exec.mockImplementationOnce(() => {
        throw new Error('near "INVALID": syntax error');
      });

      expect(() => wrapper.exec("INVALID SQL")).toThrow("Exec error");
    });
  });

  describe("run", () => {
    it("应该执行SELECT语句并返回结果", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();
      const mockRunStmt = {
        get: vi.fn(),
        all: vi.fn(() => [{ id: 1, name: "test" }]),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
        columns: vi.fn(() => [{ name: "id" }, { name: "name" }]),
        bind: vi.fn(),
        free: vi.fn(),
      };
      localMockDbInstance.prepare.mockReturnValueOnce(mockRunStmt);

      const result = wrapper.run("SELECT * FROM test");

      expect(result).toEqual([
        { columns: ["id", "name"], values: [{ id: 1, name: "test" }] },
      ]);
    });

    it("应该执行INSERT/UPDATE语句并返回changes", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();
      const mockRunStmt = {
        get: vi.fn(),
        all: vi.fn(),
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 5 })),
        columns: vi.fn(() => []),
        bind: vi.fn(),
        free: vi.fn(),
      };
      localMockDbInstance.prepare.mockReturnValueOnce(mockRunStmt);

      const result = wrapper.run("INSERT INTO test (name) VALUES (?)", [
        "Alice",
      ]);

      expect(result).toEqual([{ columns: [], values: [[1, 5]] }]);
    });

    it("应该支持参数绑定", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();
      const mockRunStmt = {
        get: vi.fn(),
        all: vi.fn(),
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
        columns: vi.fn(() => []),
        bind: vi.fn(),
        free: vi.fn(),
      };
      localMockDbInstance.prepare.mockReturnValueOnce(mockRunStmt);

      wrapper.run("INSERT INTO test (name) VALUES (?)", ["Bob"]);

      expect(mockRunStmt.run).toHaveBeenCalledWith(["Bob"]);
    });
  });

  describe("export", () => {
    const mockFs = { readFileSync: vi.fn() };

    it("应该导出数据库到Buffer", () => {
      mockFs.readFileSync.mockReturnValueOnce(Buffer.from("database-content"));
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        {},
        LocalMockDatabase,
        mockFs,
      );
      wrapper.open();

      const result = wrapper.export();

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(Buffer.from("database-content"));
    });

    it("应该在导出后重新打开数据库", () => {
      mockFs.readFileSync.mockReturnValueOnce(Buffer.from("database-content"));
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        {},
        LocalMockDatabase,
        mockFs,
      );
      wrapper.open();

      wrapper.export();

      expect(localMockDbInstance.close).toHaveBeenCalled();
      expect(wrapper.db).toBe(localMockDbInstance);
    });

    it("应该在数据库未打开时抛出错误", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite");

      expect(() => wrapper.export()).toThrow("Database not opened");
    });
  });

  describe("getHandle", () => {
    it("应该返回原始数据库对象", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();

      const handle = wrapper.getHandle();

      expect(handle).toBe(localMockDbInstance);
    });

    it("应该在数据库未打开时自动打开", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);

      const handle = wrapper.getHandle();

      expect(LocalMockDatabase).toHaveBeenCalled();
      expect(handle).toBe(localMockDbInstance);
    });
  });

  describe("close", () => {
    it("应该关闭数据库", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();

      wrapper.close();

      expect(localMockDbInstance.close).toHaveBeenCalled();
    });

    it("应该将db设为null", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();

      wrapper.close();

      expect(wrapper.db).toBeNull();
    });

    it("应该处理关闭失败", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();
      localMockDbInstance.close.mockImplementationOnce(() => {
        throw new Error("database is locked");
      });

      // close() catches the error internally and logs it
      expect(() => wrapper.close()).not.toThrow();
      // The source code uses logger.error from its own import, which is mocked
    });

    it("应该在数据库未打开时不抛出错误", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite");

      expect(() => wrapper.close()).not.toThrow();
    });
  });

  describe("rekey", () => {
    it("应该更新数据库密钥", () => {
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "oldkey" },
        LocalMockDatabase,
      );
      wrapper.open();

      wrapper.rekey("newkey");

      expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
        "rekey = \"x'newkey'\"",
      );
    });

    it("应该更新wrapper的key属性", () => {
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "oldkey" },
        LocalMockDatabase,
      );
      wrapper.open();

      wrapper.rekey("newkey");

      expect(wrapper.key).toBe("newkey");
    });

    it("应该在rekey失败时抛出错误", () => {
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "oldkey" },
        LocalMockDatabase,
      );
      wrapper.open();
      localMockDbInstance.pragma.mockImplementationOnce(() => {
        throw new Error("unable to rekey");
      });

      expect(() => wrapper.rekey("newkey")).toThrow("Rekey failed");
    });

    it("应该在数据库未打开时抛出错误", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite");

      expect(() => wrapper.rekey("newkey")).toThrow("Database not opened");
    });
  });

  describe("removeEncryption", () => {
    it("应该移除数据库加密", () => {
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "testkey" },
        LocalMockDatabase,
      );
      wrapper.open();

      wrapper.removeEncryption();

      expect(localMockDbInstance.pragma).toHaveBeenCalledWith("rekey = ''");
    });

    it("应该将key设为null", () => {
      wrapper = new SQLCipherWrapper(
        "/test/db.sqlite",
        { key: "testkey" },
        LocalMockDatabase,
      );
      wrapper.open();

      wrapper.removeEncryption();

      expect(wrapper.key).toBeNull();
    });

    it("应该在数据库未打开时抛出错误", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite");

      expect(() => wrapper.removeEncryption()).toThrow("Database not opened");
    });
  });

  describe("backup", () => {
    it("应该创建数据库备份", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();

      wrapper.backup("/backup.db");

      expect(localMockDbInstance.backup).toHaveBeenCalledWith("/backup.db");
    });

    it("应该一次性完成备份", () => {
      const mockBackup = { step: vi.fn(), finish: vi.fn() };
      localMockDbInstance.backup.mockReturnValueOnce(mockBackup);
      wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
      wrapper.open();

      wrapper.backup("/backup.db");

      expect(mockBackup.step).toHaveBeenCalledWith(-1);
      expect(mockBackup.finish).toHaveBeenCalled();
    });

    it("应该在数据库未打开时抛出错误", () => {
      wrapper = new SQLCipherWrapper("/test/db.sqlite");

      expect(() => wrapper.backup("/backup.db")).toThrow("Database not opened");
    });
  });
});

describe("工厂函数", () => {
  let createEncryptedDatabase;
  let createUnencryptedDatabase;
  let SQLCipherWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module =
      await import("../../../src/main/database/sqlcipher-wrapper.js");
    createEncryptedDatabase = module.createEncryptedDatabase;
    createUnencryptedDatabase = module.createUnencryptedDatabase;
    SQLCipherWrapper = module.SQLCipherWrapper;
  });

  describe("createEncryptedDatabase", () => {
    it("应该创建加密数据库实例", () => {
      const db = createEncryptedDatabase("/test/db.sqlite", "testkey");

      expect(db).toBeInstanceOf(SQLCipherWrapper);
      expect(db.dbPath).toBe("/test/db.sqlite");
      expect(db.key).toBe("testkey");
    });

    it("应该支持额外选项", () => {
      const db = createEncryptedDatabase("/test/db.sqlite", "testkey", {
        readonly: true,
      });

      expect(db.options.key).toBe("testkey");
      expect(db.options.readonly).toBe(true);
    });
  });

  describe("createUnencryptedDatabase", () => {
    it("应该创建未加密数据库实例", () => {
      const db = createUnencryptedDatabase("/test/db.sqlite");

      expect(db).toBeInstanceOf(SQLCipherWrapper);
      expect(db.dbPath).toBe("/test/db.sqlite");
      expect(db.key).toBeNull();
    });

    it("应该支持选项参数", () => {
      const db = createUnencryptedDatabase("/test/db.sqlite", {
        readonly: true,
      });

      expect(db.options.readonly).toBe(true);
    });
  });
});

describe("边界情况", () => {
  let SQLCipherWrapper;
  let wrapper;
  let localMockDbInstance;
  let LocalMockDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();

    localMockDbInstance = {
      prepare: vi.fn(() => ({
        bind: vi.fn(),
        get: vi.fn(() => ({ count: 0 })),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
        columns: vi.fn(() => [{ name: "id" }]),
      })),
      exec: vi.fn(),
      pragma: vi.fn(),
      close: vi.fn(),
      backup: vi.fn(() => ({ step: vi.fn(), finish: vi.fn() })),
    };
    LocalMockDatabase = vi.fn(() => localMockDbInstance);

    const module =
      await import("../../../src/main/database/sqlcipher-wrapper.js");
    SQLCipherWrapper = module.SQLCipherWrapper;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.close();
      wrapper = null;
    }
  });

  it("应该处理空路径", () => {
    wrapper = new SQLCipherWrapper("");

    expect(wrapper.dbPath).toBe("");
  });

  it("应该处理空密钥（转换为null）", () => {
    wrapper = new SQLCipherWrapper("/test/db.sqlite", { key: "" });

    expect(wrapper.key).toBeNull();
  });

  it("应该处理特殊字符路径", () => {
    wrapper = new SQLCipherWrapper(
      "/test/路径 with spaces/db.sqlite",
      {},
      LocalMockDatabase,
    );

    wrapper.open();

    expect(LocalMockDatabase).toHaveBeenCalledWith(
      "/test/路径 with spaces/db.sqlite",
      {},
    );
    expect(wrapper.db).toBe(localMockDbInstance);
  });

  it("应该处理长密钥", () => {
    const longKey = "a".repeat(256);
    wrapper = new SQLCipherWrapper(
      "/test/db.sqlite",
      { key: longKey },
      LocalMockDatabase,
    );

    wrapper.open();

    expect(localMockDbInstance.pragma).toHaveBeenCalledWith(
      `key = "x'${"a".repeat(256)}'"`,
    );
  });
});

describe("错误处理", () => {
  let SQLCipherWrapper;
  let wrapper;
  let localMockDbInstance;
  let LocalMockDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();

    localMockDbInstance = {
      prepare: vi.fn(() => ({
        bind: vi.fn(),
        get: vi.fn(() => ({ count: 0 })),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
        columns: vi.fn(() => [{ name: "id" }]),
      })),
      exec: vi.fn(),
      pragma: vi.fn(),
      close: vi.fn(),
      backup: vi.fn(() => ({ step: vi.fn(), finish: vi.fn() })),
    };
    LocalMockDatabase = vi.fn(() => localMockDbInstance);

    const module =
      await import("../../../src/main/database/sqlcipher-wrapper.js");
    SQLCipherWrapper = module.SQLCipherWrapper;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.close();
      wrapper = null;
    }
  });

  it("应该在数据库未打开时无法rekey", () => {
    wrapper = new SQLCipherWrapper("/test/db.sqlite");

    expect(() => wrapper.rekey("newkey")).toThrow("Database not opened");
  });

  it("应该在数据库未打开时无法removeEncryption", () => {
    wrapper = new SQLCipherWrapper("/test/db.sqlite");

    expect(() => wrapper.removeEncryption()).toThrow("Database not opened");
  });

  it("应该在数据库未打开时无法backup", () => {
    wrapper = new SQLCipherWrapper("/test/db.sqlite");

    expect(() => wrapper.backup("/backup.db")).toThrow("Database not opened");
  });

  it("应该处理open失败", () => {
    const FailingDatabase = vi.fn(() => {
      throw new Error("cannot open database");
    });
    wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, FailingDatabase);

    expect(() => wrapper.open()).toThrow("Failed to open database");
  });

  it("应该处理exec失败", () => {
    wrapper = new SQLCipherWrapper("/test/db.sqlite", {}, LocalMockDatabase);
    wrapper.open();
    localMockDbInstance.exec.mockImplementationOnce(() => {
      throw new Error("syntax error");
    });

    expect(() => wrapper.exec("BAD SQL")).toThrow("Exec error");
  });

  it("应该处理export失败", () => {
    const failingFs = {
      readFileSync: vi.fn(() => {
        throw new Error("ENOENT: no such file or directory");
      }),
    };
    wrapper = new SQLCipherWrapper(
      "/test/db.sqlite",
      {},
      LocalMockDatabase,
      failingFs,
    );
    wrapper.open();

    expect(() => wrapper.export()).toThrow("Export failed");
  });
});

describe("安全性", () => {
  let SQLCIPHER_CONFIG;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module =
      await import("../../../src/main/database/sqlcipher-wrapper.js");
    SQLCIPHER_CONFIG = module.SQLCIPHER_CONFIG;
  });

  it("应该使用256000次KDF迭代（高安全性）", () => {
    expect(SQLCIPHER_CONFIG.kdfIterations).toBeGreaterThanOrEqual(256000);
  });

  it("应该使用4096字节页大小", () => {
    expect(SQLCIPHER_CONFIG.pageSize).toBe(4096);
  });

  it("应该使用PBKDF2_HMAC_SHA512算法", () => {
    expect(SQLCIPHER_CONFIG.kdfAlgorithm).toBe(2);
  });

  it("应该使用HMAC_SHA1算法", () => {
    expect(SQLCIPHER_CONFIG.hmacAlgorithm).toBe(1);
  });

  it("应该不在日志中暴露密钥", async () => {
    const module =
      await import("../../../src/main/database/sqlcipher-wrapper.js");
    const localMockDb = {
      prepare: vi.fn(() => ({ get: vi.fn(() => ({ count: 0 })) })),
      exec: vi.fn(),
      pragma: vi.fn(),
      close: vi.fn(),
      backup: vi.fn(() => ({ step: vi.fn(), finish: vi.fn() })),
    };
    const LocalMockDb = vi.fn(() => localMockDb);
    const secretKey = "super_secret_key_12345";
    const w = new module.SQLCipherWrapper(
      "/test/db.sqlite",
      { key: secretKey },
      LocalMockDb,
    );
    mockLogger.info.mockClear();

    w.open();

    for (const call of mockLogger.info.mock.calls) {
      const logStr = call.join(" ");
      expect(logStr).not.toContain(secretKey);
    }
    w.close();
  });
});
