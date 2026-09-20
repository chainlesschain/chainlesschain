import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  registerSecureStorageIPC,
  unregisterSecureStorageIPC,
} = require("../secure-storage-ipc");
const { createSecureStoragePrivacy } = require("../secure-storage-privacy");

function setup(overrides = {}, dependencyOverrides = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: vi.fn(),
  };
  const storage = {
    getStorageInfo: vi.fn(() => ({
      exists: true,
      safeStorageAvailable: true,
      storagePath: "C:\\private\\tenant\\secure-config.enc",
      encryptionType: "safeStorage",
      version: 2,
      lastModified: new Date(),
      size: 8192,
      backupCount: 2,
    })),
    save: vi.fn(() => true),
    load: vi.fn(() => ({ openai: { apiKey: "sk-private-secret" } })),
    exists: vi.fn(() => true),
    delete: vi.fn(() => true),
    createBackup: vi.fn(
      () => "C:\\private\\tenant\\backups\\secure-config-one.enc.bak",
    ),
    listBackups: vi.fn(() => [
      {
        path: "C:\\private\\tenant\\backups\\secure-config-one.enc.bak",
        filename: "secure-config-one.enc.bak",
        size: 1234,
        date: new Date(),
      },
    ]),
    restoreFromBackup: vi.fn(() => true),
    exportWithPassword: vi.fn(() => true),
    importWithPassword: vi.fn(() => true),
    migrateToSafeStorage: vi.fn(() => true),
    clearCache: vi.fn(),
    safeStorageAvailable: true,
    ...overrides,
  };
  const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const dialog = {
    showSaveDialog: vi.fn(async () => ({
      canceled: false,
      filePath: "C:\\private\\exports\\secrets.enc",
    })),
    showOpenDialog: vi.fn(async () => ({
      canceled: false,
      filePaths: ["C:\\private\\imports\\secrets.enc"],
    })),
  };
  const BrowserWindow = { fromWebContents: vi.fn(() => ({})) };
  const authorization = dependencyOverrides.authorization || {
    authorize: vi.fn(async (_event, operation) => ({ operation })),
  };
  registerSecureStorageIPC({
    ipcMain,
    storage,
    dialog,
    BrowserWindow,
    privacy: createSecureStoragePrivacy("ipc", sink),
    authorization,
  });
  return {
    handlers,
    ipcMain,
    storage,
    sink,
    dialog,
    BrowserWindow,
    authorization,
  };
}

describe("secure storage IPC privacy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns receipts instead of secrets and local paths", async () => {
    const { handlers, storage } = setup();

    const info = await handlers.get("secure-storage:get-info")();
    const loaded = await handlers.get("secure-storage:load")();
    const created = await handlers.get("secure-storage:create-backup")();
    const backups = await handlers.get("secure-storage:list-backups")();
    const exported = await handlers.get("secure-storage:export")(
      { sender: {} },
      { password: "private-password" },
    );
    const keyStatus = await handlers.get("secure-storage:get-api-key-masked")(
      null,
      { provider: "openai" },
    );

    expect(info.data).toEqual({
      exists: true,
      safeStorageAvailable: true,
      encryptionType: "safeStorage",
      version: 2,
      backupCount: 2,
    });
    expect(loaded.data).toEqual({ configured: true });
    expect(created.data).toEqual({ backupId: "secure-config-one.enc.bak" });
    expect(backups.data).toEqual([{ backupId: "secure-config-one.enc.bak" }]);
    expect(exported.data).toEqual({ exported: true });
    expect(keyStatus.data).toEqual({ configured: true });

    const serialized = JSON.stringify({
      info,
      loaded,
      created,
      backups,
      exported,
      keyStatus,
    });
    expect(serialized).not.toContain("sk-private-secret");
    expect(serialized).not.toContain("private\\tenant");
    expect(serialized).not.toContain("private\\exports");
    expect(storage.exportWithPassword).toHaveBeenCalledWith(
      "private-password",
      "C:\\private\\exports\\secrets.enc",
    );
  });

  it("resolves backup IDs only through the server-side inventory", async () => {
    const { handlers, storage } = setup();

    await expect(
      handlers.get("secure-storage:restore-backup")(
        null,
        "..\\..\\private-secret.enc",
      ),
    ).resolves.toMatchObject({
      success: false,
      code: "CC_SECURE_STORAGE_BACKUP_NOT_FOUND",
    });
    expect(storage.restoreFromBackup).not.toHaveBeenCalled();

    await expect(
      handlers.get("secure-storage:restore-backup")(
        null,
        "secure-config-one.enc.bak",
      ),
    ).resolves.toEqual({ success: true, error: null });
    expect(storage.restoreFromBackup).toHaveBeenCalledWith(
      "C:\\private\\tenant\\backups\\secure-config-one.enc.bak",
    );
  });

  it("does not inspect or return caught errors", async () => {
    let inspected = false;
    const secret = "private-storage-path-and-key";
    const hostile = new Proxy(new Error(secret), {
      get() {
        inspected = true;
        throw new Error("caught error accessor was invoked");
      },
      getOwnPropertyDescriptor() {
        inspected = true;
        throw new Error("caught error descriptor was invoked");
      },
    });
    const { handlers, sink } = setup({
      getStorageInfo() {
        throw hostile;
      },
    });

    const result = await handlers.get("secure-storage:get-info")();

    expect(result).toEqual({
      success: false,
      error: "Secure storage operation failed",
      code: "CC_SECURE_STORAGE_OPERATION_FAILED",
      component: "ipc",
      operation: "get-info",
    });
    expect(inspected).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(secret);
  });

  it("fails before storage side effects when authorization is denied", async () => {
    const authorization = {
      authorize: vi.fn(async () => {
        throw new Error("private authorization details");
      }),
    };
    const { handlers, storage, sink } = setup({}, { authorization });

    const result = await handlers.get("secure-storage:save")(
      {},
      { "openai.apiKey": `sk-${"a".repeat(32)}` },
    );

    expect(result).toEqual({
      success: false,
      error: "Secure storage request is not authorized",
      code: "CC_SECURE_STORAGE_UNAUTHORIZED",
      component: "ipc",
      operation: "save",
    });
    expect(storage.save).not.toHaveBeenCalled();
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(
      "private authorization details",
    );
  });

  it("projects writes onto declared sensitive field paths", async () => {
    const { handlers, storage } = setup();
    const apiKey = `sk-${"a".repeat(32)}`;

    await expect(
      handlers.get("secure-storage:save")({}, { "openai.apiKey": apiKey }),
    ).resolves.toMatchObject({ success: true });
    expect(storage.save).toHaveBeenCalledWith({ "openai.apiKey": apiKey });

    storage.save.mockClear();
    await expect(
      handlers.get("secure-storage:set-api-key")(
        {},
        { provider: "openai", value: apiKey },
      ),
    ).resolves.toMatchObject({ success: true });
    expect(storage.save).toHaveBeenCalledWith({ "openai.apiKey": apiKey });

    storage.save.mockClear();
    await expect(
      handlers.get("secure-storage:set-api-key")(
        {},
        {
          provider: "openai",
          key: "__proto__.polluted",
          value: apiKey,
        },
      ),
    ).resolves.toMatchObject({
      success: false,
      code: "CC_SECURE_STORAGE_OPERATION_FAILED",
      operation: "set-api-key",
    });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed batch fields without evaluating them", async () => {
    let inspected = false;
    const apiKeys = {};
    Object.defineProperty(apiKeys, "openai.apiKey", {
      enumerable: true,
      get() {
        inspected = true;
        return `sk-${"a".repeat(32)}`;
      },
    });
    const { handlers, storage } = setup();

    await expect(
      handlers.get("secure-storage:batch-set-api-keys")({}, apiKeys),
    ).resolves.toMatchObject({
      success: false,
      code: "CC_SECURE_STORAGE_OPERATION_FAILED",
      operation: "batch-set-api-keys",
    });
    expect(inspected).toBe(false);
    expect(storage.load).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("keeps events, operations and source access on fixed boundaries", () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const files = [
      ["llm-config.js", "config", "configPrivacy"],
      ["secure-config-storage.js", "storage", "storagePrivacy"],
      ["secure-storage-ipc.js", "ipc", "privacy"],
    ];

    for (const [file, component, variable] of files) {
      const source = fs.readFileSync(
        path.resolve(__dirname, "..", file),
        "utf8",
      );
      expect(source).not.toMatch(/utils\/logger\.js/u);
      expect(source).not.toMatch(
        /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
      );
      expect(source).not.toMatch(
        /console\.(?:debug|info|warn|error|log)\s*\(/u,
      );
      expect(source).not.toMatch(/\berror\.message\b/u);

      const privacy = createSecureStoragePrivacy(component, sink);
      const eventPattern = new RegExp(
        `${variable}\\.event\\("([a-z-]+)"\\)`,
        "gu",
      );
      for (const match of source.matchAll(eventPattern)) {
        privacy.event(match[1]);
        expect(sink.info).toHaveBeenLastCalledWith(
          "[SecureStorage] internal event",
          { component, event: match[1] },
        );
      }

      if (component === "ipc") {
        for (const match of source.matchAll(
          /privacy\.failure\("([a-z-]+)"\)/gu,
        )) {
          expect(privacy.failure(match[1]).operation).toBe(match[1]);
        }
      }
    }
  });

  it("supports dependency-injected unregistration", () => {
    const ipcMain = { removeHandler: vi.fn() };
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    unregisterSecureStorageIPC({
      ipcMain,
      privacy: createSecureStoragePrivacy("ipc", sink),
    });

    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(23);
  });
});
