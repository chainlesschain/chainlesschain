import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const { hub, state } = vi.hoisted(() => {
  const state = vi.fn();
  return {
    state,
    hub: {
      registry: {
        consumerId: "host-generation",
        getDerivationStatus: vi.fn(),
        retryDerivations: vi.fn(),
      },
      vault: {
        deleteEntity: vi.fn(),
        getDerivationStore: () => ({ getState: state }),
      },
    },
  };
});

describe("PDH derivation desktop IPC ingress", () => {
  let ipcHandlers;
  let unregister;
  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers = new Map();
    const module = { exports: {} };
    vm.runInNewContext(
      readFileSync(
        new URL(
          "../../../../desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        module,
        require: (name) => {
          if (name.endsWith("logger.js"))
            return { logger: { info() {}, warn() {} } };
          if (
            name.endsWith("sync-result.js") ||
            name.endsWith("aichat-wizard-factory.js") ||
            name === "@chainlesschain/personal-data-hub"
          )
            return {};
          throw new Error(`Unexpected require: ${name}`);
        },
      },
    );
    unregister = module.exports.unregister;
    module.exports.register({
      ipcMain: {
        handle: (name, fn) => ipcHandlers.set(name, fn),
        removeHandler: (name) => ipcHandlers.delete(name),
      },
      hubWiring: { getHub: async () => hub },
    });
  });

  it("returns status, host-owned lineage and retry summary, then unregisters every new channel", async () => {
    hub.registry.getDerivationStatus.mockReturnValue({ pending: 1 });
    state.mockReturnValue({ revision: 3 });
    hub.registry.retryDerivations.mockResolvedValue({ failed: 1 });
    expect(
      await ipcHandlers.get("personal-data-hub:derivation-status")(
        {},
        { adapter: "mail" },
      ),
    ).toEqual({ pending: 1 });
    expect(
      await ipcHandlers.get("personal-data-hub:derivation-state")(
        {},
        { entityType: "person", entityId: "p", consumerId: "untrusted" },
      ),
    ).toEqual({ revision: 3 });
    expect(state).toHaveBeenCalledWith("person", "p", {
      consumerId: "host-generation",
    });
    expect(
      await ipcHandlers.get("personal-data-hub:retry-derivations")(
        {},
        { limit: 3 },
      ),
    ).toEqual({ failed: 1 });
    unregister();
    for (const operation of [
      "derivation-status",
      "derivation-state",
      "retry-derivations",
      "delete-entity",
    ]) {
      expect(ipcHandlers.has(`personal-data-hub:${operation}`)).toBe(false);
    }
  });

  it("requires explicit confirmation and a valid identity before normalized deletion", async () => {
    const handler = ipcHandlers.get("personal-data-hub:delete-entity");
    expect(
      await handler({}, { entityType: "event", entityId: "e" }),
    ).toHaveProperty("error");
    expect(
      await handler({}, { entityType: "raw", entityId: "e", confirm: true }),
    ).toHaveProperty("error");
    expect(hub.vault.deleteEntity).not.toHaveBeenCalled();
    const deleted = { entityType: "event", entityId: "e", deleted: true };
    hub.vault.deleteEntity.mockReturnValue(deleted);
    hub.registry.retryDerivations.mockResolvedValue({
      failed: 0,
      remaining: 0,
    });
    expect(
      await handler({}, { entityType: "event", entityId: "e", confirm: true }),
    ).toEqual({ deleted, derivations: { failed: 0, remaining: 0 } });
  });
});
vi.mock("../../src/lib/personal-data-hub-wiring.js", () => ({
  getHub: vi.fn(async () => hub),
  getGovernedAnalysisHub: vi.fn(),
  close: vi.fn(),
}));
import { PERSONAL_DATA_HUB_HANDLERS as handlers } from "../../src/gateways/ws/personal-data-hub-protocol.js";
import { createWsMessageDispatcher } from "../../src/gateways/ws/message-dispatcher.js";

describe("PDH derivation WS ingress", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["delete-entity", "retry-derivations"])(
    "rejects unauthenticated %s before any handler mutation",
    async (operation) => {
      const server = {
        token: "required",
        clients: new Map([["client", { authenticated: false }]]),
        _send: vi.fn(),
      };
      await createWsMessageDispatcher(server).dispatch(
        "client",
        {},
        {
          id: "request",
          type: `personal-data-hub.${operation}`,
          entityType: "event",
          entityId: "e",
          confirm: true,
        },
      );
      expect(server._send).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ code: "AUTH_REQUIRED" }),
      );
      expect(hub.vault.deleteEntity).not.toHaveBeenCalled();
      expect(hub.registry.retryDerivations).not.toHaveBeenCalled();
    },
  );

  it("returns scoped status and host-owned lineage without accepting a client consumer override", async () => {
    hub.registry.getDerivationStatus.mockReturnValue({ failed: 2 });
    expect(
      await handlers["personal-data-hub.derivation-status"]({
        adapter: "mail",
        scope: "a",
      }),
    ).toEqual({ result: { failed: 2 } });
    expect(hub.registry.getDerivationStatus).toHaveBeenCalledWith({
      adapter: "mail",
      scope: "a",
    });
    state.mockReturnValue({ revision: 2 });
    expect(
      await handlers["personal-data-hub.derivation-state"]({
        entityType: "event",
        entityId: "e",
        consumerId: "untrusted",
      }),
    ).toEqual({ result: { revision: 2 } });
    expect(state).toHaveBeenCalledWith("event", "e", {
      consumerId: "host-generation",
    });
  });

  it("forwards only bounded retry options, preserving failed delivery summaries", async () => {
    hub.registry.retryDerivations.mockResolvedValue({
      failed: 1,
      succeeded: 2,
      remaining: 1,
    });
    expect(
      await handlers["personal-data-hub.retry-derivations"]({
        adapter: "mail",
        limit: 5,
        sink: "untrusted",
      }),
    ).toEqual({ result: { failed: 1, succeeded: 2, remaining: 1 } });
    expect(hub.registry.retryDerivations).toHaveBeenCalledWith({
      adapter: "mail",
      scope: undefined,
      limit: 5,
    });
  });

  it.each([
    { entityType: "event", entityId: "e" },
    { entityType: "unknown", entityId: "e", confirm: true },
    { entityType: "event", entityId: " ", confirm: true },
  ])(
    "rejects unconfirmed or invalid deletion before vault mutation",
    async (request) => {
      expect(
        await handlers["personal-data-hub.delete-entity"](request),
      ).toHaveProperty("error");
      expect(hub.vault.deleteEntity).not.toHaveBeenCalled();
      expect(hub.registry.retryDerivations).not.toHaveBeenCalled();
    },
  );

  it("returns canonical deletion and independent pending index removal state", async () => {
    const deleted = { entityType: "event", entityId: "e", deleted: true };
    hub.vault.deleteEntity.mockReturnValue(deleted);
    hub.registry.retryDerivations.mockResolvedValue({
      failed: 1,
      remaining: 1,
    });
    expect(
      await handlers["personal-data-hub.delete-entity"]({
        entityType: "event",
        entityId: "e",
        confirm: true,
      }),
    ).toEqual({
      result: { deleted, derivations: { failed: 1, remaining: 1 } },
    });
    expect(hub.vault.deleteEntity).toHaveBeenCalledWith("event", "e");
  });
});
