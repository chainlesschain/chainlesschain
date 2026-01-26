/**
 * SQLCipher Wrapper Extended Unit Tests
 *
 * Tests for AES-256 encrypted database wrapper functionality.
 * Covers encryption, key rotation, backup/restore, and statement API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import os from "os";

// ============================================
// Mocks (BEFORE imports)
// ============================================

// Mock better-sqlite3-multiple-ciphers
const mockPreparedStatement = {
  bind: vi.fn(),
  get: vi.fn(() => ({ id: 1, name: "test" })),
  all: vi.fn(() => [{ id: 1 }, { id: 2 }]),
  run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
  finalize: vi.fn(),
};

const mockBackup = {
  step: vi.fn(),
  finish: vi.fn(),
};

const mockDatabase = {
  prepare: vi.fn(() => mockPreparedStatement),
  exec: vi.fn(),
  pragma: vi.fn((sql) => {
    // Mock pragma responses
    if (sql === 'cipher_version') {
      return [{ cipher_version: '4.5.3' }];
    }
    return [];
  }),
  backup: vi.fn(() => mockBackup),
  close: vi.fn(),
};

vi.mock("better-sqlite3-multiple-ciphers", () => ({
  default: vi.fn(() => mockDatabase),
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
}));

// Import after mocking
const {
  SQLCipherWrapper,
  StatementWrapper,
  createEncryptedDatabase,
  createUnencryptedDatabase,
} = require("../../../src/main/database/sqlcipher-wrapper");
const Database = require("better-sqlite3-multiple-ciphers");

describe("SQLCipherWrapper", () => {
  let wrapper;
  const testDbPath = path.join(os.tmpdir(), "test-encrypted.db");
  const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeEach(() => {
    vi.clearAllMocks();
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
      wrapper = new SQLCipherWrapper(testDbPath);
      wrapper.open();

      expect(Database).toHaveBeenCalledWith(testDbPath, expect.any(Object));
      expect(wrapper.db).not.toBeNull();
    });

    it("should open database with encryption key", () => {
      wrapper = new SQLCipherWrapper(testDbPath, { key: testKey });
      wrapper.open();

      expect(wrapper.db).not.toBeNull();
      expect(mockDatabase.pragma).toHaveBeenCalled();
    });

    it("should configure SQLCipher parameters", () => {
      wrapper = new SQLCipherWrapper(testDbPath, { key: testKey });
      wrapper.open();

      expect(mockDatabase.pragma).toHaveBeenCalledWith(expect.stringContaining("cipher_page_size"));
      expect(mockDatabase.pragma).toHaveBeenCalledWith(expect.stringContaining("kdf_iter"));
    });

    it("should test encryption key validity", () => {
      wrapper = new SQLCipherWrapper(testDbPath, { key: testKey });
      wrapper.open();

      expect(mockPreparedStatement.get).toHaveBeenCalled();
    });

    it("should throw on invalid encryption key", () => {
      mockPreparedStatement.get.mockImplementationOnce(() => {
        throw new Error("file is not a database");
      });

      wrapper = new SQLCipherWrapper(testDbPath, { key: "invalid" });

      expect(() => wrapper.open()).toThrow("Invalid encryption key");
    });

    it("should handle readonly mode", () => {
      wrapper = new SQLCipherWrapper(testDbPath, { readonly: true });
      wrapper.open();

      expect(Database).toHaveBeenCalledWith(testDbPath, expect.objectContaining({ readonly: true }));
    });

    it("should not reopen if already open", () => {
      wrapper = new SQLCipherWrapper(testDbPath);
      wrapper.open();
      const firstDb = wrapper.db;

      wrapper.open();

      expect(wrapper.db).toBe(firstDb);
    });
  });

  describe("_setupEncryption", () => {
    beforeEach(() => {
      wrapper = new SQLCipherWrapper(testDbPath, { key: testKey });
      wrapper.open();
    });

    it("should set encryption key with raw key format", () => {
      expect(mockDatabase.pragma).toHaveBeenCalledWith(expect.stringContaining(`x'${testKey}'`));
    });

    it("should configure page size to 4096", () => {
      expect(mockDatabase.pragma).toHaveBeenCalledWith("cipher_page_size = 4096");
    });

    it("should configure KDF iterations to 256000", () => {
      expect(mockDatabase.pragma).toHaveBeenCalledWith("kdf_iter = 256000");
    });

    it("should configure HMAC algorithm", () => {
      expect(mockDatabase.pragma).toHaveBeenCalledWith("cipher_hmac_algorithm = 1");
    });

    it("should configure KDF algorithm to PBKDF2_SHA512", () => {
      expect(mockDatabase.pragma).toHaveBeenCalledWith("cipher_kdf_algorithm = 2");
    });

    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper._setupEncryption(testKey)).toThrow("Database not opened");
    });

    it("should validate key by querying sqlite_master", () => {
      expect(mockDatabase.prepare).toHaveBeenCalledWith("SELECT count(*) FROM sqlite_master");
    });
  });

  describe("prepare", () => {
    beforeEach(() => {
      wrapper = new SQLCipherWrapper(testDbPath);
    });

    it("should return StatementWrapper instance", () => {
      const stmt = wrapper.prepare("SELECT * FROM test");

      expect(stmt).toBeInstanceOf(StatementWrapper);
    });

    it("should auto-open database if not open", () => {
      expect(wrapper.db).toBeNull();

      wrapper.prepare("SELECT * FROM test");

      expect(wrapper.db).not.toBeNull();
    });

    it("should pass SQL to StatementWrapper", () => {
      const sql = "SELECT id, name FROM users";
      const stmt = wrapper.prepare(sql);

      expect(mockDatabase.prepare).toHaveBeenCalledWith(sql);
    });
  });

  describe("exec", () => {
    beforeEach(() => {
      wrapper = new SQLCipherWrapper(testDbPath);
      wrapper.open();
    });

    it("should execute SQL directly", () => {
      const sql = "CREATE TABLE test (id INTEGER)";
      wrapper.exec(sql);

      expect(mockDatabase.exec).toHaveBeenCalledWith(sql);
    });

    it("should handle multiple statements", () => {
      const sql = "CREATE TABLE t1 (id INT); CREATE TABLE t2 (name TEXT);";
      wrapper.exec(sql);

      expect(mockDatabase.exec).toHaveBeenCalledWith(sql);
    });

    it("should throw on SQL error", () => {
      mockDatabase.exec.mockImplementationOnce(() => {
        throw new Error("SQL syntax error");
      });

      expect(() => wrapper.exec("INVALID SQL")).toThrow("Exec error");
    });

    it("should auto-open database", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      newWrapper.exec("CREATE TABLE test (id INT)");

      expect(newWrapper.db).not.toBeNull();
    });
  });

  describe("run", () => {
    beforeEach(() => {
      wrapper = new SQLCipherWrapper(testDbPath);
      wrapper.open();
    });

    it("should execute SELECT and return results", () => {
      mockPreparedStatement.all.mockReturnValueOnce([{ id: 1 }, { id: 2 }]);

      const result = wrapper.run("SELECT * FROM test");

      expect(result).toEqual([{
        columns: expect.any(Array),
        values: [{ id: 1 }, { id: 2 }],
      }]);
    });

    it("should execute INSERT and return changes", () => {
      mockPreparedStatement.run.mockReturnValueOnce({ changes: 1, lastInsertRowid: 5 });

      const result = wrapper.run("INSERT INTO test (name) VALUES (?)", ["Alice"]);

      expect(result).toEqual([{
        columns: [],
        values: [[1, 5]],
      }]);
    });

    it("should handle parameters", () => {
      wrapper.run("SELECT * FROM test WHERE id = ?", [1]);

      expect(mockPreparedStatement.all).toHaveBeenCalledWith([1]);
    });

    it("should free statement after execution", () => {
      wrapper.run("SELECT * FROM test");

      expect(mockPreparedStatement.finalize).toHaveBeenCalled();
    });
  });

  describe("export", () => {
    beforeEach(() => {
      wrapper = new SQLCipherWrapper(testDbPath);
      wrapper.open();
    });

    it("should export database to Buffer", () => {
      const buffer = wrapper.export();

      expect(buffer).toBeInstanceOf(Buffer);
      expect(mockReadFileSync).toHaveBeenCalledWith(testDbPath);
    });

    it("should close and reopen database during export", () => {
      wrapper.export();

      expect(mockDatabase.close).toHaveBeenCalled();
      expect(Database).toHaveBeenCalledTimes(2); // Initial open + reopen
    });

    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper.export()).toThrow("Database not opened");
    });

    it("should handle file read errors", () => {
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error("File not found");
      });

      expect(() => wrapper.export()).toThrow("Export failed");
    });
  });

  describe("close", () => {
    beforeEach(() => {
      wrapper = new SQLCipherWrapper(testDbPath);
      wrapper.open();
    });

    it("should close database connection", () => {
      wrapper.close();

      expect(mockDatabase.close).toHaveBeenCalled();
    });

    it("should set db to null", () => {
      wrapper.close();

      expect(wrapper.db).toBeNull();
    });

    it("should handle close errors gracefully", () => {
      mockDatabase.close.mockImplementationOnce(() => {
        throw new Error("Already closed");
      });

      expect(() => wrapper.close()).toThrow("Close failed");
    });

    it("should be safe to call multiple times", () => {
      wrapper.close();

      mockDatabase.close.mockClear();
      wrapper.close(); // Should not call close again

      expect(mockDatabase.close).not.toHaveBeenCalled();
    });
  });

  describe("rekey", () => {
    const newKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    beforeEach(() => {
      wrapper = new SQLCipherWrapper(testDbPath, { key: testKey });
      wrapper.open();
    });

    it("should change encryption key", () => {
      wrapper.rekey(newKey);

      expect(mockDatabase.pragma).toHaveBeenCalledWith(`rekey = "x'${newKey}'"`);
    });

    it("should update stored key", () => {
      wrapper.rekey(newKey);

      expect(wrapper.key).toBe(newKey);
    });

    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper.rekey(newKey)).toThrow("Database not opened");
    });

    it("should handle rekey errors", () => {
      mockDatabase.pragma.mockImplementationOnce(() => {
        throw new Error("Rekey failed");
      });

      expect(() => wrapper.rekey(newKey)).toThrow("Rekey failed");
    });

    it("should preserve data after rekey", () => {
      wrapper.rekey(newKey);

      // Data should still be accessible
      expect(() => wrapper.prepare("SELECT * FROM sqlite_master")).not.toThrow();
    });
  });

  describe("removeEncryption", () => {
    beforeEach(() => {
      wrapper = new SQLCipherWrapper(testDbPath, { key: testKey });
      wrapper.open();
    });

    it("should remove encryption with empty rekey", () => {
      wrapper.removeEncryption();

      expect(mockDatabase.pragma).toHaveBeenCalledWith("rekey = ''");
    });

    it("should clear stored key", () => {
      wrapper.removeEncryption();

      expect(wrapper.key).toBeNull();
    });

    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper.removeEncryption()).toThrow("Database not opened");
    });

    it("should handle removal errors", () => {
      mockDatabase.pragma.mockImplementationOnce(() => {
        throw new Error("Cannot remove encryption");
      });

      expect(() => wrapper.removeEncryption()).toThrow("Remove encryption failed");
    });
  });

  describe("backup", () => {
    const backupPath = path.join(os.tmpdir(), "backup.db");

    beforeEach(() => {
      wrapper = new SQLCipherWrapper(testDbPath, { key: testKey });
      wrapper.open();
    });

    it("should create backup using better-sqlite3 API", () => {
      wrapper.backup(backupPath);

      expect(mockDatabase.backup).toHaveBeenCalledWith(backupPath);
    });

    it("should complete backup in single step", () => {
      wrapper.backup(backupPath);

      expect(mockBackup.step).toHaveBeenCalledWith(-1);
      expect(mockBackup.finish).toHaveBeenCalled();
    });

    it("should throw if database not opened", () => {
      const newWrapper = new SQLCipherWrapper(testDbPath);

      expect(() => newWrapper.backup(backupPath)).toThrow("Database not opened");
    });

    it("should handle backup errors", () => {
      mockDatabase.backup.mockImplementationOnce(() => {
        throw new Error("Backup failed");
      });

      expect(() => wrapper.backup(backupPath)).toThrow("Backup failed");
    });
  });

  describe("getHandle", () => {
    it("should return underlying database handle", () => {
      wrapper = new SQLCipherWrapper(testDbPath);
      wrapper.open();

      const handle = wrapper.getHandle();

      expect(handle).toBe(mockDatabase);
    });

    it("should return null if not opened", () => {
      wrapper = new SQLCipherWrapper(testDbPath);

      const handle = wrapper.getHandle();

      expect(handle).toBeNull();
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

      expect(() => new StatementWrapper(mockDatabase, "INVALID SQL")).toThrow("SQL prepare error");
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

      expect(mockPreparedStatement.bind).toHaveBeenCalledWith({ id: 1, name: "test" });
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
      mockPreparedStatement.get.mockReturnValueOnce({ id: 1, name: "Alice" });

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
      stmt = new StatementWrapper(mockDatabase, "INSERT INTO test (name) VALUES (?)");
    });

    it("should execute INSERT and return result", () => {
      mockPreparedStatement.run.mockReturnValueOnce({ changes: 1, lastInsertRowid: 5 });

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

      expect(mockPreparedStatement.finalize).toHaveBeenCalled();
    });

    it("should set stmt to null after free", () => {
      stmt.free();

      expect(stmt.stmt).toBeNull();
    });

    it("should finalize statement on finalize call", () => {
      stmt.finalize();

      expect(mockPreparedStatement.finalize).toHaveBeenCalled();
    });

    it("should be safe to call free multiple times", () => {
      stmt.free();
      mockPreparedStatement.finalize.mockClear();

      stmt.free();

      expect(mockPreparedStatement.finalize).not.toHaveBeenCalled();
    });
  });
});

describe("Factory Functions", () => {
  const testDbPath = path.join(os.tmpdir(), "factory-test.db");
  const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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
      const wrapper = createEncryptedDatabase(testDbPath, testKey, { readonly: true });

      expect(wrapper.readonly).toBe(true);
    });

    it("should merge key into options", () => {
      const wrapper = createEncryptedDatabase(testDbPath, testKey, { fileMustExist: true });

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
      const wrapper = createUnencryptedDatabase(testDbPath, { readonly: true });

      expect(wrapper.readonly).toBe(true);
    });
  });
});
