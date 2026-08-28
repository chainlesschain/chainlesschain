import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const {
  registerPhase34Collaboration,
} = require("../phases/phase-33-40-collab-ops");

describe("Phase 34 collaboration production wiring", () => {
  let yjsInstance;
  let realtimeInstance;
  let modules;

  beforeEach(() => {
    yjsInstance = { kind: "yjs" };
    realtimeInstance = {
      yjsCollabManager: null,
      setYjsManager: vi.fn(function setYjsManager(manager) {
        this.yjsCollabManager = manager;
      }),
    };
    const YjsCollabManager = vi.fn(function MockYjsCollabManager() {
      return yjsInstance;
    });
    modules = {
      YjsCollabManager,
      getRealtimeCollabManager: vi.fn(() => realtimeInstance),
      registerRealtimeCollabIPC: vi.fn(),
      registerCollabIPC: vi.fn(),
    };
  });

  it("constructs and registers the realtime/Yjs runtime before the legacy room extension", () => {
    const database = { kind: "database" };
    const p2pManager = { kind: "p2p" };
    const mainWindow = { kind: "window" };
    const app = {
      yjsEngine: { kind: "legacy-engine" },
      yjsProvider: { kind: "legacy-provider" },
      collabSessionManager: { kind: "legacy-session" },
      collabGitIntegration: { kind: "legacy-git" },
    };
    const registeredModules = {};

    registerPhase34Collaboration({
      deps: { app, database, p2pManager, mainWindow },
      registeredModules,
      logger: { warn: vi.fn() },
      modules,
    });

    expect(modules.YjsCollabManager).toHaveBeenCalledWith(p2pManager, database);
    expect(realtimeInstance.setYjsManager).toHaveBeenCalledWith(yjsInstance);
    expect(modules.registerRealtimeCollabIPC).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        getRealtimeManager: expect.any(Function),
        getYjsManager: expect.any(Function),
      }),
    );
    const realtimeDeps = modules.registerRealtimeCollabIPC.mock.calls[0][1];
    expect(realtimeDeps.getRealtimeManager()).toBe(realtimeInstance);
    expect(realtimeDeps.getYjsManager()).toBe(yjsInstance);

    expect(modules.registerCollabIPC).toHaveBeenCalledWith(
      expect.objectContaining({
        mainWindow,
        excludedChannels: expect.arrayContaining([
          "collab:get-awareness",
          "collab:update-cursor",
          "collab:yjs-connect",
          "collab:yjs-disconnect",
        ]),
      }),
    );
    expect(registeredModules).toMatchObject({
      realtimeCollabManager: realtimeInstance,
      yjsCollabManager: yjsInstance,
    });
  });

  it("reuses an existing Yjs manager instead of duplicating protocol handlers", () => {
    const existingYjsManager = { kind: "existing-yjs" };
    realtimeInstance.yjsCollabManager = existingYjsManager;

    registerPhase34Collaboration({
      deps: { app: {}, database: {}, p2pManager: {} },
      registeredModules: {},
      logger: { warn: vi.fn() },
      modules,
    });

    expect(modules.YjsCollabManager).not.toHaveBeenCalled();
    const realtimeDeps = modules.registerRealtimeCollabIPC.mock.calls[0][1];
    expect(realtimeDeps.getYjsManager()).toBe(existingYjsManager);
  });

  it("keeps legacy collaboration registration available without a database", () => {
    const logger = { warn: vi.fn() };

    registerPhase34Collaboration({
      deps: { app: {}, database: null, mainWindow: null },
      registeredModules: {},
      logger,
      modules,
    });

    expect(modules.registerRealtimeCollabIPC).not.toHaveBeenCalled();
    expect(modules.registerCollabIPC).toHaveBeenCalledWith(
      expect.objectContaining({ excludedChannels: [] }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("database unavailable"),
    );
  });

  it("keeps the registered runtime under application lifecycle ownership", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/main/index.js"),
      "utf8",
    );

    expect(source).toContain("this.ipcModules = registerAllIPC({");
    expect(source).toContain("this.ipcModules.yjsCollabManager?.destroy?.()");
    expect(source).toContain(
      "this.ipcModules.realtimeCollabManager?.destroy?.()",
    );
  });
});
