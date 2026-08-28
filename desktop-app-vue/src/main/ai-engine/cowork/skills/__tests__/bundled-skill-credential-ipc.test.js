import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  BundledSkillCredentialStore,
} = require("../bundled-skill-credential-store.js");
const {
  BUNDLED_SKILL_CREDENTIAL_CHANNELS,
  registerBundledSkillCredentialIPC,
  unregisterBundledSkillCredentialIPC,
} = require("../bundled-skill-credential-ipc.js");

function memoryStorage() {
  let payload = null;
  return {
    exists: () => payload !== null,
    load: () => (payload === null ? null : structuredClone(payload)),
    save: (next) => {
      payload = structuredClone(next);
      return true;
    },
  };
}

function ipcHarness() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
      removeHandler: vi.fn((channel) => handlers.delete(channel)),
    },
  };
}

describe("bundled Skill credential IPC", () => {
  it("writes after approval without disclosing plaintext to hooks or status", async () => {
    const { handlers, ipcMain } = ipcHarness();
    const hookSystem = {
      trigger: vi.fn(async () => ({ prevented: false, hookResults: [] })),
    };
    const credentialStore = new BundledSkillCredentialStore({
      storage: memoryStorage(),
    });
    registerBundledSkillCredentialIPC({
      ipcMain,
      hookSystem,
      credentialStore,
    });

    const secret = "notion-secret-value";
    await expect(
      handlers.get("skills:set-credential")(
        {},
        {
          key: "notion-api-key",
          value: secret,
        },
      ),
    ).resolves.toEqual({ success: true, configured: true });
    const approvalPayload = hookSystem.trigger.mock.calls[0][1];
    expect(JSON.stringify(approvalPayload)).not.toContain(secret);
    expect(approvalPayload.params).toEqual(
      expect.objectContaining({
        operation: "set",
        key: "notion-api-key",
        valueBytes: Buffer.byteLength(secret),
        valueSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    const status = await handlers.get("skills:credential-status")();
    expect(status).toEqual(
      expect.objectContaining({
        success: true,
        configured: expect.objectContaining({ "notion-api-key": true }),
      }),
    );
    expect(JSON.stringify(status)).not.toContain(secret);
  });

  it("fails closed when approval is missing or prevents a mutation", async () => {
    const { handlers, ipcMain } = ipcHarness();
    const credentialStore = new BundledSkillCredentialStore({
      storage: memoryStorage(),
    });
    registerBundledSkillCredentialIPC({ ipcMain, credentialStore });

    await expect(
      handlers.get("skills:set-credential")(
        {},
        {
          key: "tavily-api-key",
          value: "tavily-secret-value",
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ success: false, prevented: true }),
    );
    expect(credentialStore.get("tavily-api-key")).toBeNull();

    const denyingHooks = {
      trigger: vi.fn(async () => ({
        prevented: true,
        preventReason: "denied by policy",
        hookResults: [],
      })),
    };
    const secondHarness = ipcHarness();
    registerBundledSkillCredentialIPC({
      ipcMain: secondHarness.ipcMain,
      hookSystem: denyingHooks,
      credentialStore,
    });
    credentialStore.set("tavily-api-key", "existing-secret");
    await expect(
      secondHarness.handlers.get("skills:clear-credential")(
        {},
        {
          key: "tavily-api-key",
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ success: false, prevented: true }),
    );
    expect(credentialStore.get("tavily-api-key")).toBe("existing-secret");
  });

  it("registers and removes only the three fixed capability channels", () => {
    const { handlers, ipcMain } = ipcHarness();
    registerBundledSkillCredentialIPC({
      ipcMain,
      hookSystem: { trigger: vi.fn() },
      credentialStore: new BundledSkillCredentialStore({
        storage: memoryStorage(),
      }),
    });
    expect([...handlers.keys()]).toEqual(BUNDLED_SKILL_CREDENTIAL_CHANNELS);

    unregisterBundledSkillCredentialIPC({ ipcMain });
    expect(handlers.size).toBe(0);
  });
});
