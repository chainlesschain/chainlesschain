/**
 * ensureOpsPlaybookDescription unit tests.
 *
 * Old DBs created before the AutoRemediator's INSERT/UPDATE statements
 * grew a `description` column would log "table … has no column named
 * description" three times on every boot when default playbooks were
 * seeded. This idempotent migration ALTERs in the column when missing
 * and is a no-op otherwise.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

const {
  ensureOpsPlaybookDescription,
} = require("../../../src/main/database/database-migrations.js");

function makeFakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFakeDbManager(rows, opts = {}) {
  const runs = [];
  const dbManager = {
    db: {
      prepare: vi.fn((sql) => {
        if (/PRAGMA table_info/i.test(sql)) {
          return { all: () => rows };
        }
        throw new Error(`unexpected prepare: ${sql}`);
      }),
      run: vi.fn((sql) => {
        if (opts.runThrows) {
          throw opts.runThrows;
        }
        runs.push(sql);
      }),
    },
    saveToFile: vi.fn(),
    _runs: runs,
  };
  return dbManager;
}

describe("ensureOpsPlaybookDescription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when the table does not exist (PRAGMA returns [])", () => {
    const logger = makeFakeLogger();
    const dbManager = makeFakeDbManager([]);
    ensureOpsPlaybookDescription(dbManager, logger);
    expect(dbManager.db.run).not.toHaveBeenCalled();
    expect(dbManager.saveToFile).not.toHaveBeenCalled();
  });

  it("is a no-op when the description column already exists", () => {
    const logger = makeFakeLogger();
    const dbManager = makeFakeDbManager([
      { name: "id" },
      { name: "name" },
      { name: "description" },
      { name: "active" },
    ]);
    ensureOpsPlaybookDescription(dbManager, logger);
    expect(dbManager.db.run).not.toHaveBeenCalled();
    expect(dbManager.saveToFile).not.toHaveBeenCalled();
  });

  it("ALTERs in the description column when present-but-missing-column", () => {
    const logger = makeFakeLogger();
    const dbManager = makeFakeDbManager([
      { name: "id" },
      { name: "name" },
      { name: "active" },
      // description missing
    ]);
    ensureOpsPlaybookDescription(dbManager, logger);
    expect(dbManager.db.run).toHaveBeenCalledTimes(1);
    expect(dbManager.db.run.mock.calls[0][0]).toMatch(
      /ALTER TABLE ops_remediation_playbooks ADD COLUMN description TEXT DEFAULT ''/,
    );
    expect(dbManager.saveToFile).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it("swallows ALTER errors as a warning (don't poison boot)", () => {
    const logger = makeFakeLogger();
    const dbManager = makeFakeDbManager([{ name: "id" }, { name: "active" }], {
      runThrows: new Error("disk full"),
    });
    expect(() => ensureOpsPlaybookDescription(dbManager, logger)).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
    const warnArgs = logger.warn.mock.calls[0];
    expect(warnArgs.join(" ")).toMatch(
      /ops_remediation_playbooks.*description/,
    );
  });

  it("swallows PRAGMA errors as a warning", () => {
    const logger = makeFakeLogger();
    const dbManager = {
      db: {
        prepare: vi.fn(() => {
          throw new Error("db locked");
        }),
        run: vi.fn(),
      },
      saveToFile: vi.fn(),
    };
    expect(() => ensureOpsPlaybookDescription(dbManager, logger)).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});
