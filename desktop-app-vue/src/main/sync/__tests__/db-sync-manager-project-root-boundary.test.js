/**
 * Backend project sync must never create or replace the Desktop-local
 * `projects.root_path` execution-authority binding.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const DBSyncManager = require("../db-sync-manager.js");

let SQL;
let sqlDb;
let database;
let manager;

function normalizeParams(args) {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
}

function createDatabaseFacade(db) {
  return {
    run(sql, params = []) {
      db.run(sql, params);
      return { changes: db.getRowsModified() };
    },
    prepare(sql) {
      return {
        get(...args) {
          const statement = db.prepare(sql);
          try {
            statement.bind(normalizeParams(args));
            return statement.step() ? statement.getAsObject() : undefined;
          } finally {
            statement.free();
          }
        },
      };
    },
  };
}

function backendProject(overrides = {}) {
  return {
    id: "project-1",
    userId: "user-1",
    name: "Remote project",
    description: null,
    projectType: "document",
    status: "active",
    rootPath: "C:\\attacker-controlled\\project",
    fileCount: 0,
    totalSize: 0,
    createdAt: new Date(1_000).toISOString(),
    updatedAt: new Date(2_000).toISOString(),
    deviceId: "backend-device",
    deleted: 0,
    ...overrides,
  };
}

function insertLocalProject({
  id = "project-1",
  name = "Local project",
  rootPath = "/locally/approved",
  updatedAt = 1_000,
  syncedAt = 1_000,
} = {}) {
  database.db.run(
    `INSERT INTO projects (
       id, user_id, name, description, project_type, status, root_path,
       root_path_local_attested, file_count, total_size, created_at, updated_at,
       synced_at, sync_status, device_id, deleted, source_peer_id, pc_root_path
     ) VALUES (?, 'user-1', ?, NULL, 'document', 'active', ?,
       1, 0, 0, 1000, ?, ?, 'synced', 'local-device', 0, NULL, NULL)`,
    [id, name, rootPath, updatedAt, syncedAt],
  );
}

function getProject(id = "project-1") {
  return database.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
}

beforeAll(async () => {
  SQL = await (await import("sql.js")).default();
});

beforeEach(() => {
  sqlDb = new SQL.Database();
  sqlDb.run(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      project_type TEXT NOT NULL,
      status TEXT,
      root_path TEXT,
      root_path_local_attested INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      synced_at INTEGER,
      sync_status TEXT,
      device_id TEXT,
      deleted INTEGER DEFAULT 0,
      source_peer_id TEXT,
      pc_root_path TEXT,
      CHECK(root_path IS NULL OR root_path_local_attested = 1)
    )
  `);
  database = { db: createDatabaseFacade(sqlDb) };
  manager = new DBSyncManager(database, null);
  manager.deviceId = "local-device";
  manager.httpClient = {
    downloadIncremental: vi.fn(),
    getRecord: vi.fn(),
    resolveConflict: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  manager.destroy();
  sqlDb.close();
});

describe("DBSyncManager project root boundary", () => {
  it("creates a backend project with a null local root despite an absolute rootPath", async () => {
    const maliciousRoot = "C:\\attacker-controlled\\new-project";
    manager.httpClient.downloadIncremental.mockResolvedValue({
      newRecords: [backendProject({ rootPath: maliciousRoot })],
      updatedRecords: [],
      deletedIds: [],
    });

    await manager.downloadRemoteChanges("projects");

    const row = getProject();
    expect(row.name).toBe("Remote project");
    expect(row.root_path).toBeNull();
    expect(row.root_path_local_attested).toBe(0);
    expect(row.pc_root_path).toBeNull();
    expect(row.source_peer_id).toBeNull();
    expect(
      manager.fieldMapper.toLocal(backendProject(), "projects"),
    ).not.toHaveProperty("root_path");
  });

  it("updates backend metadata without replacing an existing local root", async () => {
    insertLocalProject();

    await manager.handleUpdate(
      "projects",
      backendProject({
        name: "Remote rename",
        rootPath: "C:\\attacker-controlled\\update",
        updatedAt: new Date(2_000).toISOString(),
      }),
    );

    const row = getProject();
    expect(row.name).toBe("Remote rename");
    expect(row.root_path).toBe("/locally/approved");
    expect(row.root_path_local_attested).toBe(1);
    expect(row.pc_root_path).toBeNull();
    expect(row.source_peer_id).toBeNull();
  });

  it("accepts a remote conflict version without replacing the local root", async () => {
    insertLocalProject({ id: "remote-conflict" });
    manager.httpClient.getRecord.mockResolvedValue(
      backendProject({
        id: "remote-conflict",
        name: "Accepted remote metadata",
        rootPath: "C:\\attacker-controlled\\remote-conflict",
      }),
    );

    await manager.resolveConflict("projects:remote-conflict", "remote");

    const row = getProject("remote-conflict");
    expect(row.name).toBe("Accepted remote metadata");
    expect(row.root_path).toBe("/locally/approved");
    expect(row.root_path_local_attested).toBe(1);
    expect(row.pc_root_path).toBeNull();
    expect(row.source_peer_id).toBeNull();
  });

  it("strips a raw root_path from the conflict merge UPSERT", async () => {
    insertLocalProject({ id: "conflicted-project" });
    const maliciousRoot = "C:\\attacker-controlled\\conflict";

    await manager.resolveConflict("projects:conflicted-project", "merge", {
      user_id: "user-1",
      name: "Merged metadata",
      description: null,
      project_type: "document",
      status: "active",
      root_path: maliciousRoot,
      root_path_local_attested: 1,
      file_count: 0,
      total_size: 0,
      created_at: 1_000,
      synced_at: 1_000,
      device_id: "backend-device",
      deleted: 0,
    });

    const row = getProject("conflicted-project");
    expect(row.name).toBe("Merged metadata");
    expect(row.root_path).toBe("/locally/approved");
    expect(row.root_path_local_attested).toBe(1);
    expect(row.pc_root_path).toBeNull();
    expect(row.source_peer_id).toBeNull();
  });
});
