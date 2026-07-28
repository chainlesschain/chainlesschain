import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import projectsModule from "../../../src/main/database/database-projects.js";
import migrationsModule from "../../../src/main/database/database-migrations.js";
import schemaModule from "../../../src/main/database/database-schema.js";

const { saveProject, updateProject } = projectsModule;
const { migrateDatabase } = migrationsModule;
const { createTables } = schemaModule;

let SQL;

function normalizeParams(args) {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
}

function createFacade(db) {
  return {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, ...args) {
      db.run(sql, normalizeParams(args));
      return { changes: db.getRowsModified() };
    },
    prepare(sql) {
      const createStatement = () => db.prepare(sql);
      return {
        all(...args) {
          const statement = createStatement();
          const rows = [];
          try {
            statement.bind(normalizeParams(args));
            while (statement.step()) {
              rows.push(statement.getAsObject());
            }
            return rows;
          } finally {
            statement.free();
          }
        },
        get(...args) {
          const statement = createStatement();
          try {
            statement.bind(normalizeParams(args));
            return statement.step() ? statement.getAsObject() : undefined;
          } finally {
            statement.free();
          }
        },
        run(...args) {
          db.run(sql, normalizeParams(args));
          return { changes: db.getRowsModified() };
        },
        free() {},
      };
    },
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createProjectManager(db) {
  const manager = {
    db: createFacade(db),
    saveToFile: vi.fn(),
  };
  manager.getProjectById = (id) =>
    manager.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return manager;
}

function createProjectTable(db) {
  db.run(`
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
      template_id TEXT,
      cover_image_url TEXT,
      tags TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_status TEXT,
      synced_at INTEGER,
      device_id TEXT,
      deleted INTEGER DEFAULT 0,
      category_id TEXT,
      delivered_at TEXT,
      source_peer_id TEXT,
      pc_root_path TEXT,
      CHECK(root_path IS NULL OR root_path_local_attested = 1)
    )
  `);
}

function project(overrides = {}) {
  return {
    id: "project-1",
    user_id: "user-1",
    name: "Project",
    project_type: "document",
    root_path: "C:\\local\\project-1",
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

beforeAll(async () => {
  SQL = await (await import("sql.js")).default();
});

describe("project root local attestation", () => {
  let db;
  let manager;
  let logger;

  beforeEach(() => {
    db = new SQL.Database();
    createProjectTable(db);
    manager = createProjectManager(db);
    logger = createLogger();
  });

  it("only persists a non-null root through the trusted host option", () => {
    saveProject(manager, logger, project());
    expect(manager.getProjectById("project-1")).toMatchObject({
      root_path: null,
      root_path_local_attested: 0,
    });

    saveProject(manager, logger, project(), { attestRootPath: true });
    manager.db.run(
      "UPDATE projects SET pc_root_path = ? WHERE id = ?",
      "C:\\historical\\selector",
      "project-1",
    );
    expect(manager.getProjectById("project-1")).toMatchObject({
      root_path: "C:\\local\\project-1",
      root_path_local_attested: 1,
    });

    // A generic round-trip can preserve the exact attested value.
    saveProject(manager, logger, project());
    expect(manager.getProjectById("project-1")).toMatchObject({
      root_path: "C:\\local\\project-1",
      root_path_local_attested: 1,
      pc_root_path: "C:\\historical\\selector",
    });

    // A renderer/backend-derived replacement is ignored, never stored as a
    // marker-0 host path or allowed to revoke an existing host binding.
    saveProject(
      manager,
      logger,
      project({ root_path: "C:\\attacker-controlled" }),
    );
    expect(manager.getProjectById("project-1")).toMatchObject({
      root_path: "C:\\local\\project-1",
      root_path_local_attested: 1,
      pc_root_path: "C:\\historical\\selector",
    });
  });

  it("atomically attests rebinds, ignores spoofed roots, and permits an explicit clear", () => {
    saveProject(manager, logger, project({ root_path: null }));

    updateProject(
      manager,
      logger,
      "project-1",
      { root_path: "C:\\local\\rebound" },
      { attestRootPath: true },
    );
    expect(manager.getProjectById("project-1")).toMatchObject({
      root_path: "C:\\local\\rebound",
      root_path_local_attested: 1,
    });

    updateProject(manager, logger, "project-1", {
      root_path: "C:\\attacker-controlled",
    });
    expect(manager.getProjectById("project-1")).toMatchObject({
      root_path: "C:\\local\\rebound",
      root_path_local_attested: 1,
    });

    updateProject(
      manager,
      logger,
      "project-1",
      { root_path: "C:\\local\\again" },
      { attestRootPath: true },
    );
    updateProject(
      manager,
      logger,
      "project-1",
      { root_path: null },
      { attestRootPath: true },
    );
    expect(manager.getProjectById("project-1")).toMatchObject({
      root_path: null,
      root_path_local_attested: 0,
    });
  });
});

describe("project root attestation schema and upgrade", () => {
  it("creates fresh projects with a fail-closed CHECK constraint", () => {
    const db = new SQL.Database();
    const manager = {
      db: createFacade(db),
      ensureTaskBoardOwnerSchema: vi.fn(),
      ensureOpsPlaybookDescription: vi.fn(),
      ensureSyncExternalTombstoneResourceType: vi.fn(),
      ensureUserSettingsTable: vi.fn(),
      initDefaultSettings: vi.fn(),
      migrateDatabase: vi.fn(),
      saveToFile: vi.fn(),
    };

    createTables(manager, createLogger());

    const marker = manager.db
      .prepare("PRAGMA table_info(projects)")
      .all()
      .find((column) => column.name === "root_path_local_attested");
    expect(marker).toMatchObject({ notnull: 1, dflt_value: "0" });
    expect(() =>
      manager.db.run(
        `INSERT INTO projects (
           id, user_id, name, project_type, root_path, created_at, updated_at
         ) VALUES ('fresh-invalid', 'u1', 'Invalid', 'document', '/unsafe', 1, 1)`,
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it("quarantines every historical root and installs idempotent guards", () => {
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        project_type TEXT NOT NULL,
        root_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    db.run(
      `INSERT INTO projects (
         id, user_id, name, project_type, root_path, created_at, updated_at
       ) VALUES ('legacy', 'u1', 'Legacy', 'document', '/legacy/host/path', 1, 1)`,
    );
    const manager = {
      db: createFacade(db),
      saveToFile: vi.fn(),
    };
    const logger = createLogger();

    // The security migration runs before unrelated legacy table migrations,
    // so this minimal database intentionally lacks conversations et al.
    migrateDatabase(manager, logger);
    migrateDatabase(manager, logger);

    expect(
      manager.db.prepare("SELECT * FROM projects WHERE id = 'legacy'").get(),
    ).toMatchObject({
      root_path: null,
      root_path_local_attested: 0,
      pc_root_path: "/legacy/host/path",
    });
    expect(() =>
      manager.db.run(
        `INSERT INTO projects (
           id, user_id, name, project_type, root_path,
           root_path_local_attested, created_at, updated_at
         ) VALUES ('invalid', 'u1', 'Invalid', 'document', '/unsafe', 0, 1, 1)`,
      ),
    ).toThrow(/projects_root_path_requires_local_attestation/);
  });

  it("hard-fails initialization when the invariant guards cannot be installed", () => {
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        project_type TEXT NOT NULL,
        root_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    const facade = createFacade(db);
    const originalExec = facade.exec;
    facade.exec = (sql) => {
      if (sql.includes("projects_root_attestation_insert_guard")) {
        throw new Error("simulated_trigger_failure");
      }
      return originalExec(sql);
    };

    expect(() =>
      migrateDatabase({ db: facade, saveToFile: vi.fn() }, createLogger()),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PROJECT_ROOT_ATTESTATION_MIGRATION_FAILED",
        projectRootBindingFailClosed: true,
      }),
    );
  });
});
