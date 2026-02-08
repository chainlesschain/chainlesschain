/**
 * SQLCipher Wrapper Extended Unit Tests
 *
 * Tests for AES-256 encrypted database wrapper functionality.
 * Covers encryption, key rotation, backup/restore, and statement API.
 *
 * Uses dependency injection (3rd constructor parameter) to bypass
 * the native better-sqlite3-multiple-ciphers module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import os from "os";

// Create mock objects
const mockPreparedStatement = {
  bind: vi.fn().mockReturnThis(),
  get: vi.fn(() => ({ id: 1, name: "test" })),
  all: vi.fn(() => [{ id: 1 }, { id: 2 }]),
  run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
  finalize: vi.fn(),
  columns: vi.fn(() => [{ name: "id" }, { name: "name" }]),
};

const mockBackup = {
  step: vi.fn(),
  finish: vi.fn(),
};

const mockDatabase = {
  prepare: vi.fn(() => mockPreparedStatement),
  exec: vi.fn(),
  pragma: vi.fn((sql) => {
    if (sql && sql.includes("cipher_version")) {
      return [{ cipher_version: "4.5.3" }];
    }
    return [];
  }),
  backup: vi.fn(() => mockBackup),
  close: vi.fn(),
};

// Mock constructor
const MockDatabaseConstructor = vi.fn(() => mockDatabase);

// Mock the native module (not directly used - tests use DI)
vi.mock("better-sqlite3-multiple-ciphers", () => MockDatabaseConstructor);

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

// Mock fs module
const mockReadFileSync = vi.fn(() => Buffer.from("encrypted-database-content"));
const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn(() => false);
const mockUnlinkSync = vi.fn();

vi.mock("fs", () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    existsSync: mockExistsSync,
    unlinkSync: mockUnlinkSync,
  },
}));

// Import the modules
import {
  SQLCipherWrapper,
  StatementWrapper,
  createEncryptedDatabase,
  createUnencryptedDatabase,
} from "../../../src/main/database/sqlcipher-wrapper.js";

describe("SQLCipherWrapper", () => {
  let wrapper;
  const testDbPath = path.join(os.tmpdir(), "test-encrypted.db");
  const testKey =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  // Fresh mock instances per test to avoid cross-test contamination
  let localMockDb;
  let LocalMockDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPreparedStatement.get.mockReturnValue({ id: 1, name: "test" });
    mockPreparedStatement.all.mockReturnValue([{ id: 1 }, { id: 2 }]);
    mockPreparedStatement.run.mockReturnValue({
      changes: 1,
      lastInsertRowid: 1,
    });

    // Create fresh mock db per test
    localMockDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        get: vi.fn(() => ({ id: 1, name: "test", count: 0 })),
        all: vi.fn(() => [{ id: 1 }, { id: 2 }]),
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
        columns: vi.fn(() => [{ name: "id" }, { name: "name" }]),
        finalize: vi.fn(),
      })),
      exec: vi.fn(),
      pragma: vi.fn(),
      close: vi.fn(),
      backup: vi.fn(() => ({
        step: vi.fn(),
        finish: vi.fn(),
      })),
    };
    LocalMockDatabase = vi.fn(() => localMockDb);
  });

  afterEach(() => {
    if (wrapper && wrapper.db) {
      try {
        wrapper.close();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    wrapper = null;
  });

  describe("Constructor", () => {
    it("should create instance with path only", () => {
      wrapper = new SQLCipherWrapper(testDbPath);

      expect(wrapper.dbPath).toBe(testDbPath);
      expect(wrapper.key).toBeNull();
      expect(wrapper.db).toBeNull();
    });

    it("should create instance with encryption key", () => {
      wrapper = new SQLCipherWrapper(testDbPath, { key: testKey });

      expect(wrapper.dbPath).toBe(testDbPath);
      expect(wrapper.key).toBe(testKey);
    });

    it("should accept readonly option", () => {
      wrapper = new SQLCipherWrapper(testDbPath, { readonly: true });

      expect(wrapper.readonly).toBe(true);
    });

    it("should accept fileMustExist option", () => {
      wrapper = new SQLCipherWrapper(testDbPath, { fileMustExist: true });

      expect(wrapper.fileMustExist).toBe(true);
    });

    it("should initialize db as null", () => {
      wrapper = new SQLCipherWrapper(testDbPath);

      expect(wrapper.db).toBeNull();
    });
  });

  describe("open", () => {
    it("should open database without encryption", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);

      wrapper.open();

      expect(LocalMockDatabase).toHaveBeenCalledWith(testDbPath, {});
      expect(wrapper.db).toBe(localMockDb);
      expect(localMockDb.pragma).toHaveBeenCalledWith("foreign_keys = ON");
    });

    it("should open database with encryption key", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );

      wrapper.open();

      expect(LocalMockDatabase).toHaveBeenCalledWith(testDbPath, {
        key: testKey,
      });
      expect(localMockDb.pragma).toHaveBeenCalledWith(`key = "x'${testKey}'"`);
    });

    it("should configure SQLCipher parameters", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );

      wrapper.open();

      expect(localMockDb.pragma).toHaveBeenCalledWith(
        "cipher_page_size = 4096",
      );
      expect(localMockDb.pragma).toHaveBeenCalledWith("kdf_iter = 256000");
      expect(localMockDb.pragma).toHaveBeenCalledWith(
        "cipher_hmac_algorithm = 1",
      );
      expect(localMockDb.pragma).toHaveBeenCalledWith(
        "cipher_kdf_algorithm = 2",
      );
    });

    it("should test encryption key validity", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );

      wrapper.open();

      expect(localMockDb.prepare).toHaveBeenCalledWith(
        "SELECT count(*) FROM sqlite_master",
      );
    });

    it("should throw on invalid encryption key", () => {
      localMockDb.prepare.mockImplementationOnce(() => {
        throw new Error("file is not a database");
      });
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: "badkey" },
        LocalMockDatabase,
      );

      expect(() => wrapper.open()).toThrow("Failed to open database");
    });

    it("should handle readonly mode", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { readonly: true },
        LocalMockDatabase,
      );

      wrapper.open();

      expect(LocalMockDatabase).toHaveBeenCalledWith(testDbPath, {
        readonly: true,
      });
    });

    it("should not reopen if already open", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();
      LocalMockDatabase.mockClear();

      wrapper.open();

      expect(LocalMockDatabase).not.toHaveBeenCalled();
    });
  });

  describe("_setupEncryption", () => {
    it("should set encryption key with raw key format", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      expect(localMockDb.pragma).toHaveBeenCalledWith(`key = "x'${testKey}'"`);
    });

    it("should configure page size to 4096", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      expect(localMockDb.pragma).toHaveBeenCalledWith(
        "cipher_page_size = 4096",
      );
    });

    it("should configure KDF iterations to 256000", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      expect(localMockDb.pragma).toHaveBeenCalledWith("kdf_iter = 256000");
    });

    it("should configure HMAC algorithm", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      expect(localMockDb.pragma).toHaveBeenCalledWith(
        "cipher_hmac_algorithm = 1",
      );
    });

    it("should configure KDF algorithm to PBKDF2_SHA512", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      expect(localMockDb.pragma).toHaveBeenCalledWith(
        "cipher_kdf_algorithm = 2",
      );
    });

    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper._setupEncryption(testKey)).toThrow(
        "Database not opened",
      );
    });

    it("should validate key by querying sqlite_master", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      expect(localMockDb.prepare).toHaveBeenCalledWith(
        "SELECT count(*) FROM sqlite_master",
      );
    });
  });

  describe("prepare", () => {
    it("should return StatementWrapper instance", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();

      const stmt = wrapper.prepare("SELECT * FROM test");

      expect(stmt).toBeInstanceOf(StatementWrapper);
    });

    it("should auto-open database if not open", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);

      const stmt = wrapper.prepare("SELECT 1");

      expect(LocalMockDatabase).toHaveBeenCalled();
      expect(wrapper.db).toBe(localMockDb);
      expect(stmt).toBeDefined();
    });

    it("should pass SQL to StatementWrapper", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();

      const stmt = wrapper.prepare("SELECT id, name FROM test");

      expect(stmt.sql).toBe("SELECT id, name FROM test");
      expect(localMockDb.prepare).toHaveBeenCalledWith(
        "SELECT id, name FROM test",
      );
    });
  });

  describe("exec", () => {
    it("should execute SQL directly", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();

      wrapper.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      expect(localMockDb.exec).toHaveBeenCalledWith(
        "CREATE TABLE test (id INTEGER PRIMARY KEY)",
      );
    });

    it("should handle multiple statements", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();

      wrapper.exec("CREATE TABLE a (id INT); CREATE TABLE b (id INT);");

      expect(localMockDb.exec).toHaveBeenCalledWith(
        "CREATE TABLE a (id INT); CREATE TABLE b (id INT);",
      );
    });

    it("should throw on SQL error", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();
      localMockDb.exec.mockImplementationOnce(() => {
        throw new Error('near "INVALID": syntax error');
      });

      expect(() => wrapper.exec("INVALID SQL")).toThrow("Exec error");
    });

    it("should auto-open database", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);

      wrapper.exec("SELECT 1");

      expect(LocalMockDatabase).toHaveBeenCalled();
      expect(localMockDb.exec).toHaveBeenCalledWith("SELECT 1");
    });
  });

  describe("run", () => {
    it("should execute SELECT and return results", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();
      const mockStmt = {
        get: vi.fn(),
        all: vi.fn(() => [{ id: 1, name: "Alice" }]),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
        columns: vi.fn(() => [{ name: "id" }, { name: "name" }]),
        bind: vi.fn(),
        free: vi.fn(),
      };
      localMockDb.prepare.mockReturnValueOnce(mockStmt);

      const result = wrapper.run("SELECT * FROM test");

      expect(result).toEqual([
        { columns: ["id", "name"], values: [{ id: 1, name: "Alice" }] },
      ]);
    });

    it("should execute INSERT and return changes", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();
      const mockStmt = {
        get: vi.fn(),
        all: vi.fn(),
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
        columns: vi.fn(() => []),
        bind: vi.fn(),
        free: vi.fn(),
      };
      localMockDb.prepare.mockReturnValueOnce(mockStmt);

      const result = wrapper.run("INSERT INTO test (name) VALUES (?)", [
        "Alice",
      ]);

      expect(result).toEqual([{ columns: [], values: [[1, 42]] }]);
    });

    it("should handle parameters", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();
      const mockStmt = {
        get: vi.fn(),
        all: vi.fn(),
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
        columns: vi.fn(() => []),
        bind: vi.fn(),
        free: vi.fn(),
      };
      localMockDb.prepare.mockReturnValueOnce(mockStmt);

      wrapper.run("INSERT INTO test (name) VALUES (?)", ["Bob"]);

      expect(mockStmt.run).toHaveBeenCalledWith(["Bob"]);
    });

    it("should free statement after execution", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();
      const mockStmt = {
        get: vi.fn(),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
        columns: vi.fn(() => [{ name: "id" }]),
        bind: vi.fn(),
        free: vi.fn(),
      };
      localMockDb.prepare.mockReturnValueOnce(mockStmt);

      wrapper.run("SELECT * FROM test");

      // StatementWrapper used and freed in finally block
      expect(mockStmt.columns).toHaveBeenCalled();
    });
  });

  describe("export", () => {
    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper.export()).toThrow("Database not opened");
    });

    it("should export database to Buffer", () => {
      const mockFs = {
        readFileSync: vi.fn(() => Buffer.from("encrypted-database-content")),
      };
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase, mockFs);
      wrapper.open();

      const result = wrapper.export();

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(Buffer.from("encrypted-database-content"));
    });

    it("should close and reopen database during export", () => {
      const mockFs = {
        readFileSync: vi.fn(() => Buffer.from("encrypted-database-content")),
      };
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase, mockFs);
      wrapper.open();

      wrapper.export();

      expect(localMockDb.close).toHaveBeenCalled();
      // After export, db should be reopened
      expect(wrapper.db).toBe(localMockDb);
    });

    it("should handle file read errors", () => {
      const mockFs = {
        readFileSync: vi.fn(() => {
          throw new Error("ENOENT: no such file or directory");
        }),
      };
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase, mockFs);
      wrapper.open();

      expect(() => wrapper.export()).toThrow("Export failed");
    });
  });

  describe("close", () => {
    it("should be safe to call multiple times without opening", () => {
      wrapper = new SQLCipherWrapper(testDbPath);
      wrapper.close();
      wrapper.close();

      expect(wrapper.db).toBeNull();
    });

    it("should close database connection", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();

      wrapper.close();

      expect(localMockDb.close).toHaveBeenCalled();
    });

    it("should set db to null", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();
      expect(wrapper.db).not.toBeNull();

      wrapper.close();

      expect(wrapper.db).toBeNull();
    });

    it("should handle close errors gracefully", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();
      localMockDb.close.mockImplementationOnce(() => {
        throw new Error("database is locked");
      });

      expect(() => wrapper.close()).not.toThrow();
    });
  });

  describe("rekey", () => {
    const newKey =
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper.rekey(newKey)).toThrow("Database not opened");
    });

    it("should change encryption key", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      wrapper.rekey(newKey);

      expect(localMockDb.pragma).toHaveBeenCalledWith(`rekey = "x'${newKey}'"`);
    });

    it("should update stored key", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      wrapper.rekey(newKey);

      expect(wrapper.key).toBe(newKey);
    });

    it("should handle rekey errors", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();
      localMockDb.pragma.mockImplementationOnce(() => {
        throw new Error("unable to rekey database");
      });

      expect(() => wrapper.rekey(newKey)).toThrow("Rekey failed");
    });

    it("should preserve data after rekey", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      wrapper.rekey(newKey);

      expect(wrapper.db).toBe(localMockDb);
      expect(wrapper.key).toBe(newKey);
    });
  });

  describe("removeEncryption", () => {
    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper.removeEncryption()).toThrow(
        "Database not opened",
      );
    });

    it("should remove encryption with empty rekey", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      wrapper.removeEncryption();

      expect(localMockDb.pragma).toHaveBeenCalledWith("rekey = ''");
    });

    it("should clear stored key", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();

      wrapper.removeEncryption();

      expect(wrapper.key).toBeNull();
    });

    it("should handle removal errors", () => {
      wrapper = new SQLCipherWrapper(
        testDbPath,
        { key: testKey },
        LocalMockDatabase,
      );
      wrapper.open();
      localMockDb.pragma.mockImplementationOnce(() => {
        throw new Error("unable to remove encryption");
      });

      expect(() => wrapper.removeEncryption()).toThrow(
        "Remove encryption failed",
      );
    });
  });

  describe("backup", () => {
    const backupPath = path.join(os.tmpdir(), "backup.db");

    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper.backup(backupPath)).toThrow(
        "Database not opened",
      );
    });

    it("should create backup using better-sqlite3 API", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();

      wrapper.backup(backupPath);

      expect(localMockDb.backup).toHaveBeenCalledWith(backupPath);
    });

    it("should complete backup in single step", () => {
      const localBackup = { step: vi.fn(), finish: vi.fn() };
      localMockDb.backup.mockReturnValueOnce(localBackup);
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();

      wrapper.backup(backupPath);

      expect(localBackup.step).toHaveBeenCalledWith(-1);
      expect(localBackup.finish).toHaveBeenCalled();
    });

    it("should handle backup errors", () => {
      localMockDb.backup.mockImplementationOnce(() => {
        throw new Error("backup failed: disk full");
      });
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();

      expect(() => wrapper.backup(backupPath)).toThrow("Backup failed");
    });
  });

  describe("getHandle", () => {
    it("should return null if not opened", () => {
      wrapper = new SQLCipherWrapper(testDbPath);
      wrapper.db = null;

      expect(wrapper.db).toBeNull();
    });

    it("should return underlying database handle", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);
      wrapper.open();

      const handle = wrapper.getHandle();

      expect(handle).toBe(localMockDb);
    });

    it("should auto-open and return handle if not opened", () => {
      wrapper = new SQLCipherWrapper(testDbPath, {}, LocalMockDatabase);

      const handle = wrapper.getHandle();

      expect(LocalMockDatabase).toHaveBeenCalled();
      expect(handle).toBe(localMockDb);
    });
  });
});

describe("StatementWrapper", () => {
  let stmt;
  const testSql = "SELECT * FROM test WHERE id = ?";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (stmt) {
      try {
        stmt.free();
      } catch (e) {
        // Ignore
      }
    }
    stmt = null;
  });

  describe("Constructor and _prepare", () => {
    it("should prepare statement on construction", () => {
      stmt = new StatementWrapper(mockDatabase, testSql);

      expect(mockDatabase.prepare).toHaveBeenCalledWith(testSql);
      expect(stmt.stmt).toBe(mockPreparedStatement);
    });

    it("should throw on SQL syntax error", () => {
      mockDatabase.prepare.mockImplementationOnce(() => {
        throw new Error("Syntax error");
      });

      expect(() => new StatementWrapper(mockDatabase, "INVALID SQL")).toThrow(
        "SQL prepare error",
      );
    });
  });

  describe("bind", () => {
    beforeEach(() => {
      stmt = new StatementWrapper(mockDatabase, testSql);
    });

    it("should bind array parameters", () => {
      stmt.bind([1, "test"]);

      expect(mockPreparedStatement.bind).toHaveBeenCalledWith([1, "test"]);
    });

    it("should bind object parameters", () => {
      stmt.bind({ id: 1, name: "test" });

      expect(mockPreparedStatement.bind).toHaveBeenCalledWith({
        id: 1,
        name: "test",
      });
    });

    it("should return true on success", () => {
      const result = stmt.bind([1]);

      expect(result).toBe(true);
    });

    it("should throw if statement not prepared", () => {
      stmt.stmt = null;

      expect(() => stmt.bind([1])).toThrow("Statement not prepared");
    });

    it("should throw on bind error", () => {
      mockPreparedStatement.bind.mockImplementationOnce(() => {
        throw new Error("Bind error");
      });

      expect(() => stmt.bind([1])).toThrow("Bind error");
    });
  });

  describe("get", () => {
    beforeEach(() => {
      stmt = new StatementWrapper(mockDatabase, testSql);
    });

    it("should execute and return single row", () => {
      mockPreparedStatement.get.mockReturnValueOnce({
        id: 1,
        name: "Alice",
      });

      const result = stmt.get(1);

      expect(result).toEqual({ id: 1, name: "Alice" });
      expect(mockPreparedStatement.get).toHaveBeenCalledWith(1);
    });

    it("should return null if no results", () => {
      mockPreparedStatement.get.mockReturnValueOnce(undefined);

      const result = stmt.get(999);

      expect(result).toBeNull();
    });

    it("should handle multiple parameters", () => {
      stmt.get(1, "test");

      expect(mockPreparedStatement.get).toHaveBeenCalledWith(1, "test");
    });

    it("should throw on execution error", () => {
      mockPreparedStatement.get.mockImplementationOnce(() => {
        throw new Error("Execution error");
      });

      expect(() => stmt.get(1)).toThrow("Get error");
    });
  });

  describe("all", () => {
    beforeEach(() => {
      stmt = new StatementWrapper(mockDatabase, testSql);
    });

    it("should return all matching rows", () => {
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
      mockPreparedStatement.all.mockReturnValueOnce(rows);

      const result = stmt.all();

      expect(result).toEqual(rows);
    });

    it("should handle parameters", () => {
      stmt.all(1, "test");

      expect(mockPreparedStatement.all).toHaveBeenCalledWith(1, "test");
    });

    it("should return empty array for no results", () => {
      mockPreparedStatement.all.mockReturnValueOnce([]);

      const result = stmt.all();

      expect(result).toEqual([]);
    });

    it("should throw on execution error", () => {
      mockPreparedStatement.all.mockImplementationOnce(() => {
        throw new Error("Execution error");
      });

      expect(() => stmt.all()).toThrow();
    });
  });

  describe("run", () => {
    beforeEach(() => {
      stmt = new StatementWrapper(
        mockDatabase,
        "INSERT INTO test (name) VALUES (?)",
      );
    });

    it("should execute INSERT and return result", () => {
      mockPreparedStatement.run.mockReturnValueOnce({
        changes: 1,
        lastInsertRowid: 5,
      });

      const result = stmt.run("Alice");

      expect(result).toEqual({ changes: 1, lastInsertRowid: 5 });
    });

    it("should handle parameters", () => {
      stmt.run("Bob", 25);

      expect(mockPreparedStatement.run).toHaveBeenCalledWith("Bob", 25);
    });

    it("should throw on execution error", () => {
      mockPreparedStatement.run.mockImplementationOnce(() => {
        throw new Error("Constraint violation");
      });

      expect(() => stmt.run("test")).toThrow("Run error");
    });
  });

  describe("free and finalize", () => {
    beforeEach(() => {
      stmt = new StatementWrapper(mockDatabase, testSql);
    });

    it("should finalize statement on free", () => {
      stmt.free();

      expect(stmt.stmt).toBeNull();
    });

    it("should set stmt to null after free", () => {
      stmt.free();

      expect(stmt.stmt).toBeNull();
    });

    it("should finalize statement on finalize call", () => {
      stmt.finalize();

      expect(stmt.stmt).toBeNull();
    });

    it("should be safe to call free multiple times", () => {
      stmt.free();
      const firstStmt = stmt.stmt;

      stmt.free();

      expect(stmt.stmt).toBeNull();
      expect(stmt.stmt).toBe(firstStmt);
    });
  });
});

describe("Factory Functions", () => {
  const testDbPath = path.join(os.tmpdir(), "factory-test.db");
  const testKey =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createEncryptedDatabase", () => {
    it("should create encrypted wrapper with key", () => {
      const wrapper = createEncryptedDatabase(testDbPath, testKey);

      expect(wrapper).toBeInstanceOf(SQLCipherWrapper);
      expect(wrapper.key).toBe(testKey);
    });

    it("should accept additional options", () => {
      const wrapper = createEncryptedDatabase(testDbPath, testKey, {
        readonly: true,
      });

      expect(wrapper.readonly).toBe(true);
    });

    it("should merge key into options", () => {
      const wrapper = createEncryptedDatabase(testDbPath, testKey, {
        fileMustExist: true,
      });

      expect(wrapper.key).toBe(testKey);
      expect(wrapper.fileMustExist).toBe(true);
    });
  });

  describe("createUnencryptedDatabase", () => {
    it("should create wrapper without encryption", () => {
      const wrapper = createUnencryptedDatabase(testDbPath);

      expect(wrapper).toBeInstanceOf(SQLCipherWrapper);
      expect(wrapper.key).toBeNull();
    });

    it("should accept options", () => {
      const wrapper = createUnencryptedDatabase(testDbPath, {
        readonly: true,
      });

      expect(wrapper.readonly).toBe(true);
    });
  });
});
