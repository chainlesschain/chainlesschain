import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import rootPathModule from "../../../src/main/project/project-root-path.js";
import FileSyncManager from "../../../src/main/file-sync/sync-manager.js";
import ExternalDeviceFileManager from "../../../src/main/file/external-device-file-manager.js";

const {
  assertManagedProjectRoot,
  assertExistingProjectRootOwnershipAvailable,
  assertNewProjectIdAvailable,
  createManagedRootForExistingProjectExclusive,
  resolveManagedProjectRoot,
  resolveProjectChildPath,
} = rootPathModule;

const tempRoots = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("managed project root resolver", () => {
  it("keeps a safe single-segment project id inside the configured root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-root-path-"));
    tempRoots.push(root);

    const resolved = resolveManagedProjectRoot(root, "project-123");

    expect(resolved).toBe(path.resolve(root, "project-123"));
    expect(assertManagedProjectRoot(root, resolved)).toBe(resolved);
  });

  it.each([
    "../escape",
    "..\\escape",
    "/absolute",
    "C:\\absolute",
    "\\\\server\\share",
    ".",
    "..",
    "nested/project",
    "nested\\project",
    "bad\0id",
  ])("rejects an untrusted project id before path construction: %s", (id) => {
    expect(() =>
      resolveManagedProjectRoot(path.resolve("managed"), id),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PROJECT_ROOT_ID_INVALID",
        projectRootBindingFailClosed: true,
      }),
    );
  });

  it("checks create-new IDs with a case-insensitive database lookup", () => {
    const get = vi.fn(() => ({ id: "Project-ABC" }));
    const database = {
      db: {
        prepare: vi.fn((sql) => {
          expect(sql).toContain("COLLATE NOCASE");
          return { get };
        }),
      },
    };

    expect(() =>
      assertNewProjectIdAvailable(database, "project-abc"),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PROJECT_ID_COLLISION",
        projectCreationFailClosed: true,
      }),
    );
    expect(get).toHaveBeenCalledWith("project-abc");
  });

  function createExistingProjectDatabase({
    currentId = "project-abc",
    caseAlias = null,
    attestedRoots = [],
  } = {}) {
    return {
      db: {
        prepare: vi.fn((sql) => {
          if (sql.includes("WHERE id = ? LIMIT 1")) {
            return { get: () => ({ id: currentId }) };
          }
          if (sql.includes("COLLATE NOCASE")) {
            return { get: () => caseAlias };
          }
          if (sql.includes("root_path_local_attested = 1")) {
            return { all: () => attestedRoots };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        }),
      },
    };
  }

  it("rejects a portable case alias before binding an existing marker-0 project", () => {
    const database = createExistingProjectDatabase({
      caseAlias: { id: "Project-ABC" },
    });

    expect(() =>
      assertExistingProjectRootOwnershipAvailable(
        database,
        path.resolve("managed"),
        "project-abc",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PROJECT_ID_COLLISION",
        projectCreationFailClosed: true,
      }),
    );
  });

  it("rejects a canonical root already owned by another attested project", () => {
    const projectsRoot = path.resolve("managed");
    const database = createExistingProjectDatabase({
      attestedRoots: [
        {
          id: "other-project",
          root_path: path.resolve(projectsRoot, "project-abc").toUpperCase(),
        },
      ],
    });

    expect(() =>
      assertExistingProjectRootOwnershipAvailable(
        database,
        projectsRoot,
        "project-abc",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PROJECT_ROOT_OWNERSHIP_COLLISION",
        projectCreationFailClosed: true,
      }),
    );
  });

  it("does not reuse or delete an orphan directory for marker-0 repair", async () => {
    const projectsRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "existing-root-repair-"),
    );
    tempRoots.push(projectsRoot);
    const orphanRoot = path.join(projectsRoot, "project-abc");
    fs.mkdirSync(orphanRoot);
    fs.writeFileSync(path.join(orphanRoot, "sentinel.txt"), "keep");
    const database = createExistingProjectDatabase();

    await expect(
      createManagedRootForExistingProjectExclusive(
        database,
        projectsRoot,
        "project-abc",
      ),
    ).rejects.toMatchObject({
      code: "ERR_PROJECT_ROOT_COLLISION",
      projectCreationFailClosed: true,
    });
    expect(fs.readFileSync(path.join(orphanRoot, "sentinel.txt"), "utf8")).toBe(
      "keep",
    );
  });
});

describe("project child path resolver", () => {
  it("allows a nested relative child underneath the attested root", () => {
    const root = path.resolve("managed", "project-1");
    expect(resolveProjectChildPath(root, "src/index.js")).toBe(
      path.resolve(root, "src", "index.js"),
    );
  });

  it.each([
    "../outside.txt",
    "sub/../outside.txt",
    "sub\\..\\outside.txt",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "C:drive-relative.txt",
    "\\\\server\\share\\file",
    "bad\0name",
  ])("rejects traversal and cross-platform absolute paths: %s", (child) => {
    expect(() =>
      resolveProjectChildPath(path.resolve("managed", "project-1"), child),
    ).toThrowError(
      expect.objectContaining({
        projectRootBindingFailClosed: true,
      }),
    );
  });

  it("prevents FileSyncManager from flushing a DB traversal path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-sync-root-"));
    tempRoots.push(root);
    const outsidePath = path.join(path.dirname(root), "file-sync-outside.txt");
    fs.rmSync(outsidePath, { force: true });

    const database = {
      db: {
        prepare: vi.fn((sql) => {
          if (sql.includes("FROM projects")) {
            return {
              get: () => ({
                root_path: root,
                root_path_local_attested: 1,
              }),
            };
          }
          if (sql.includes("FROM project_files")) {
            return {
              all: () => [
                {
                  id: "file-1",
                  file_path: "../file-sync-outside.txt",
                  content: "must-not-write",
                },
              ],
            };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        }),
      },
    };
    const manager = new FileSyncManager(database, null);

    await expect(manager.flushAllChanges("project-1")).rejects.toMatchObject({
      code: "ERR_PROJECT_CHILD_PATH_INVALID",
    });
    expect(fs.existsSync(outsidePath)).toBe(false);
  });
});

describe("external-device project import boundary", () => {
  function createExternalDatabase(file, project, onInsert = vi.fn()) {
    return {
      prepare: vi.fn((sql) => {
        if (sql.includes("FROM external_device_files")) {
          return { get: () => ({ ...file }) };
        }
        if (sql.includes("FROM projects")) {
          return { get: () => ({ ...project }) };
        }
        if (sql.includes("INSERT INTO project_files")) {
          return { run: onInsert };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
  }

  it("rejects a mobile project without an attested local root", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "external-import-"));
    tempRoots.push(tempRoot);
    const cachePath = path.join(tempRoot, "cached.txt");
    fs.writeFileSync(cachePath, "mobile");
    const database = createExternalDatabase(
      {
        id: "file-1",
        display_name: "cached.txt",
        is_cached: 1,
        cache_path: cachePath,
      },
      {
        id: "../../remote-project",
        root_path: null,
        root_path_local_attested: 0,
      },
    );
    const manager = new ExternalDeviceFileManager(database, null, null, null, {
      cacheDir: tempRoot,
    });

    await expect(
      manager.importToProject("file-1", "../../remote-project"),
    ).rejects.toMatchObject({
      code: "ERR_PROJECT_ROOT_PROVENANCE_UNATTESTED",
      projectRootBindingFailClosed: true,
    });
  });

  it("copies under the attested root and stores a relative project file path", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "external-import-"));
    tempRoots.push(tempRoot);
    const cachePath = path.join(tempRoot, "cached.txt");
    const projectRoot = path.join(tempRoot, "project-1");
    fs.writeFileSync(cachePath, "mobile");
    fs.mkdirSync(projectRoot);
    const insert = vi.fn();
    const database = createExternalDatabase(
      {
        id: "file-1",
        file_id: "mobile-file-1",
        device_id: "mobile-1",
        display_name: "../../escape.txt",
        mime_type: "text/plain",
        file_size: 6,
        category: "DOCUMENT",
        is_cached: 1,
        cache_path: cachePath,
      },
      {
        id: "project-1",
        root_path: projectRoot,
        root_path_local_attested: 1,
      },
      insert,
    );
    const manager = new ExternalDeviceFileManager(database, null, null, null, {
      cacheDir: tempRoot,
    });

    const result = await manager.importToProject("file-1", "project-1");

    const storedRelativePath = insert.mock.calls[0][3];
    expect(storedRelativePath).toMatch(/^files\/external-[\w-]+\.txt$/);
    expect(path.isAbsolute(storedRelativePath)).toBe(false);
    expect(result.filePath).toBe(
      path.resolve(projectRoot, ...storedRelativePath.split("/")),
    );
    expect(fs.readFileSync(result.filePath, "utf8")).toBe("mobile");
    expect(fs.existsSync(path.join(tempRoot, "escape.txt"))).toBe(false);
  });
});

describe("external-device cache authority boundary", () => {
  function createCacheDatabase({
    file,
    project = null,
    expiredFiles = [],
    onClear = vi.fn(),
    onCache = vi.fn(),
    onProjectInsert = vi.fn(),
  }) {
    return {
      prepare: vi.fn((sql) => {
        if (
          sql.includes("SELECT * FROM external_device_files") &&
          sql.includes("WHERE id = ?")
        ) {
          return { get: () => ({ ...file }) };
        }
        if (sql.includes("FROM projects")) {
          return { get: () => (project ? { ...project } : null) };
        }
        if (sql.includes("INSERT INTO project_files")) {
          return { run: onProjectInsert };
        }
        if (sql.includes("SET is_cached = 0, cache_path = NULL")) {
          return { run: onClear };
        }
        if (sql.includes("SET is_cached = 1, cache_path = ?")) {
          return { run: onCache };
        }
        if (
          sql.includes("SELECT id, cache_path, file_size, last_access") ||
          sql.includes("SELECT id, cache_path FROM external_device_files")
        ) {
          return { all: () => expiredFiles.map((item) => ({ ...item })) };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
  }

  it.each([
    ["RAG", (manager) => manager.importToRAG("file-1")],
    [
      "project import",
      (manager) => manager.importToProject("file-1", "project-1"),
    ],
  ])(
    "rejects and clears an out-of-cache historical path before %s reads it",
    async (_name, invoke) => {
      const cacheRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "external-cache-"),
      );
      tempRoots.push(cacheRoot);
      const outsideRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "external-outside-"),
      );
      tempRoots.push(outsideRoot);
      const outsidePath = path.join(outsideRoot, "secret.txt");
      fs.writeFileSync(outsidePath, "must-not-read-or-copy");
      const onClear = vi.fn();
      const onProjectInsert = vi.fn();
      const database = createCacheDatabase({
        file: {
          id: "file-1",
          is_cached: 1,
          cache_path: outsidePath,
          display_name: "secret.txt",
        },
        project: {
          id: "project-1",
          root_path: path.join(cacheRoot, "project-1"),
          root_path_local_attested: 1,
        },
        onClear,
        onProjectInsert,
      });
      const ragManager = { addDocument: vi.fn() };
      const manager = new ExternalDeviceFileManager(
        database,
        null,
        null,
        ragManager,
        { cacheDir: cacheRoot },
      );

      await expect(invoke(manager)).rejects.toMatchObject({
        code: "ERR_EXTERNAL_CACHE_PATH_UNATTESTED",
        externalCachePathFailClosed: true,
      });
      expect(onClear).toHaveBeenCalledWith("file-1");
      expect(onProjectInsert).not.toHaveBeenCalled();
      expect(ragManager.addDocument).not.toHaveBeenCalled();
      expect(fs.readFileSync(outsidePath, "utf8")).toBe(
        "must-not-read-or-copy",
      );
    },
  );

  it("never unlinks an out-of-cache historical path during eviction or cleanup", async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "external-cache-"));
    tempRoots.push(cacheRoot);
    const outsideRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "external-outside-"),
    );
    tempRoots.push(outsideRoot);
    const outsidePath = path.join(outsideRoot, "keep.txt");
    fs.writeFileSync(outsidePath, "keep");
    const onClear = vi.fn();
    const expiredFile = {
      id: "file-1",
      cache_path: outsidePath,
      file_size: 4,
      last_access: 0,
    };
    const database = createCacheDatabase({
      file: expiredFile,
      expiredFiles: [expiredFile],
      onClear,
    });
    const manager = new ExternalDeviceFileManager(database, null, null, null, {
      cacheDir: cacheRoot,
    });

    await manager.evictLRUCacheFiles(4);
    await manager.cleanupExpiredCache(1);

    expect(fs.readFileSync(outsidePath, "utf8")).toBe("keep");
    expect(onClear).toHaveBeenCalledTimes(2);
    expect(onClear).toHaveBeenNthCalledWith(1, "file-1");
    expect(onClear).toHaveBeenNthCalledWith(2, "file-1");
  });

  it("uses a random local leaf for downloads despite malicious remote names", async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "external-cache-"));
    tempRoots.push(cacheRoot);
    const file = {
      id: "file-1",
      device_id: "../../host-device",
      file_id: "..\\remote-file",
      display_name: "../../outside.txt",
      file_size: 6,
      checksum: null,
      is_cached: 0,
      cache_path: null,
    };
    const onCache = vi.fn();
    const database = createCacheDatabase({ file, onCache });
    let downloadTarget;
    const fileTransferManager = {
      downloadFile: vi.fn(async (_deviceId, _transferId, targetPath) => {
        downloadTarget = targetPath;
        fs.writeFileSync(targetPath, "mobile");
      }),
    };
    const manager = new ExternalDeviceFileManager(
      database,
      null,
      fileTransferManager,
      null,
      { cacheDir: cacheRoot },
    );
    manager.securityValidator.validate = vi.fn(() => ({
      valid: true,
      errors: [],
      warnings: [],
    }));
    manager.ensureCacheSpace = vi.fn().mockResolvedValue(undefined);
    manager.createTransferTask = vi.fn().mockResolvedValue("task-1");
    manager.updateTransferTask = vi.fn().mockResolvedValue(undefined);
    manager.sendFilePullRequestAndWait = vi
      .fn()
      .mockResolvedValue({ accepted: true });
    manager.retryManager.execute = vi.fn(async (operation) => operation());

    const result = await manager.pullFile("file-1");

    expect(path.dirname(downloadTarget)).toBe(path.resolve(cacheRoot));
    expect(path.basename(downloadTarget)).toMatch(
      /^external-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(downloadTarget).not.toContain("host-device");
    expect(downloadTarget).not.toContain("remote-file");
    expect(downloadTarget).not.toContain("outside.txt");
    expect(result.cachePath).toBe(downloadTarget);
    expect(onCache.mock.calls[0][0]).toBe(downloadTarget);
  });
});
