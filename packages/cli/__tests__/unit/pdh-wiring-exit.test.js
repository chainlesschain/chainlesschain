import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({
  directory: null,
  failOpen: false,
  events: [],
  consumers: new Map(),
}));

vi.mock("../../src/lib/paths.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getElectronUserDataDir: () => state.directory,
}));
vi.mock("../../src/lib/config-manager.js", () => ({ loadConfig: () => ({}) }));
vi.mock("../../src/lib/personal-data-hub-aichat-wizard.js", () => ({
  getAIChatWizard: () => ({}),
  createAccountsStore: () => ({ list: async () => [] }),
  createVendorAdapterBridge: () => ({}),
}));
vi.mock(
  "@chainlesschain/personal-data-hub/adapters/ai-chat-history/health-checker",
  () => ({
    default: {
      createAIChatHealthChecker: () => ({
        start() {},
        stop() {
          state.events.push("stop");
        },
      }),
    },
  }),
);
vi.mock("@chainlesschain/personal-data-hub/adapters/wechat", () => ({
  default: {},
}));
vi.mock("@chainlesschain/personal-data-hub", async () => {
  const registryModule =
    await import("../../../personal-data-hub/lib/registry.js");
  class Vault {
    open() {
      if (state.failOpen) throw new Error("test open failure");
    }
    close() {
      state.events.push("close");
    }
    getDerivationStore() {
      return {
        registerConsumer({ consumerId, kind }) {
          const consumer = {
            consumerId,
            kind,
            state: "active",
            retirementToken: "owned-token",
          };
          state.consumers.set(consumerId, consumer);
          return { ...consumer };
        },
        retireConsumer(handle) {
          const current = state.consumers.get(handle.consumerId);
          if (handle.retirementToken !== current.retirementToken)
            throw new Error("bad handle");
          current.state = "retired";
          state.events.push("retire");
          return {
            consumerId: current.consumerId,
            kind: current.kind,
            state: current.state,
          };
        },
        listPending: () => [],
        summary: () => ({
          total: 0,
          pending: 0,
          running: 0,
          succeeded: 0,
          failed: 0,
          unsupported: 0,
        }),
      };
    }
  }
  class KeyProvider {
    async get() {
      return "0".repeat(64);
    }
  }
  class InertDependency {
    constructor(options = {}) {
      Object.assign(this, options);
      this.name = "inert-adapter";
    }
    restoreSessions() {}
    async probe() {
      return { ok: true };
    }
    async *fetch() {}
    async write() {
      return {};
    }
    async remove() {
      return {};
    }
  }
  const exports = {
    LocalVault: Vault,
    FileKeyProvider: KeyProvider,
    AdapterRegistry: (registryModule.default || registryModule).AdapterRegistry,
    ANALYSIS_SKILL_NAMES: [],
    createJsonSourceFetch: () => async () => {
      throw new Error("Unexpected source fetch");
    },
    createJsonResponseSourceFetch: () => async () => {
      throw new Error("Unexpected source fetch");
    },
  };
  return {
    default: new Proxy(exports, {
      get: (target, name) => target[name] || InertDependency,
    }),
  };
});

import {
  close,
  getHub,
  getHubMinimal,
} from "../../src/lib/personal-data-hub-wiring.js";

let initialListeners;
const addedExitHooks = () =>
  process
    .listeners("exit")
    .filter((listener) => !initialListeners.includes(listener));

beforeEach(() => {
  close();
  state.directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-pdh-exit-lifecycle-"),
  );
  state.failOpen = false;
  state.events = [];
  state.consumers.clear();
  initialListeners = process.listeners("exit");
});
afterEach(() => {
  close();
  fs.rmSync(state.directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("PDH CLI synchronous process-exit lifecycle", () => {
  it("registers nothing before successful initialization, including failed open", async () => {
    expect(addedExitHooks()).toEqual([]);
    state.failOpen = true;
    await expect(getHub()).rejects.toThrow("test open failure");
    expect(addedExitHooks()).toEqual([]);
    expect(state.consumers.size).toBe(0);
  });

  it("installs one hook for concurrent/repeated initialization and removes it on explicit close", async () => {
    const [hub, same] = await Promise.all([getHub(), getHub()]);
    expect(same).toBe(hub);
    expect(await getHub()).toBe(hub);
    expect(addedExitHooks()).toHaveLength(1);
    close();
    expect(addedExitHooks()).toEqual([]);
    expect(state.consumers.get(hub.registry.consumerId).state).toBe("retired");
    expect(state.events).toEqual(["stop", "retire", "close"]);
    close();
    expect(state.events).toEqual(["stop", "retire", "close"]);
    const reopened = await getHub();
    expect(reopened.registry.consumerId).not.toBe(hub.registry.consumerId);
    expect(addedExitHooks()).toHaveLength(1);
  });

  it("retires an idle successful generation synchronously on exit code zero", async () => {
    const hub = await getHub();
    const [onExit] = addedExitHooks();
    expect(onExit(0)).toBeUndefined();
    expect(state.consumers.get(hub.registry.consumerId).state).toBe("retired");
    expect(state.events).toEqual(["stop", "retire", "close"]);
    expect(addedExitHooks()).toEqual([]);
  });

  it.each([1, 2, 130, undefined])(
    "keeps the generation active on error/unknown exit code %s",
    async (code) => {
      const hub = await getHub();
      addedExitHooks()[0](code);
      expect(state.consumers.get(hub.registry.consumerId).state).toBe("active");
      expect(state.events).toEqual(["stop", "close"]);
      expect(addedExitHooks()).toEqual([]);
    },
  );

  it("keeps a busy generation active even on exit code zero", async () => {
    const hub = await getHub();
    let release;
    const operation = hub.registry._runConsumerOperation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    try {
      addedExitHooks()[0](0);
      expect(state.consumers.get(hub.registry.consumerId).state).toBe("active");
      expect(state.events).toEqual(["stop", "close"]);
      expect(addedExitHooks()).toEqual([]);
    } finally {
      release();
      await operation;
    }
  });

  it("closes a minimal-only hub without creating or retiring a consumer", async () => {
    await getHubMinimal();
    expect(state.consumers.size).toBe(0);
    expect(addedExitHooks()).toHaveLength(1);
    addedExitHooks()[0](0);
    expect(state.events).toEqual(["close"]);
    expect(addedExitHooks()).toEqual([]);
  });
});
