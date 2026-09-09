import { afterEach, describe, expect, it, vi } from "vitest";

const handlers = new Map();
const ipcMain = {
  handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
  removeHandler: vi.fn((channel) => handlers.delete(channel)),
};
const hub = {
  entityResolver: {},
  drainResolver: vi.fn(),
  runSkill: vi.fn(),
};
const hubWiring = { getHub: vi.fn(async () => hub) };

vi.mock("electron", () => ({ ipcMain }));
vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../personal-data-hub/wiring.js", () => ({
  getHub: vi.fn(async () => hub),
}));
vi.mock("../../personal-data-hub/aichat-wizard-factory.js", () => ({
  getAIChatWizard: vi.fn(),
}));
vi.mock("@chainlesschain/personal-data-hub", () => ({
  ingestSystemDataAndroidSnapshot: vi.fn(),
}));

const { register, unregister } = require("../personal-data-hub-ipc.js");

describe("Personal Data Hub evolution ingress", () => {
  afterEach(() => {
    unregister();
    handlers.clear();
    hub.drainResolver.mockReset();
    hub.runSkill.mockReset();
  });

  it("keeps the branded Desktop host in main-process closures for resolver drains and skills", async () => {
    const desktopModelIngressHost = Object.freeze({});
    register({ desktopModelIngressHost, ipcMain, hubWiring });

    await handlers.get("personal-data-hub:resolver-drain")({}, { limit: 7 });
    await handlers.get("personal-data-hub:run-skill")(
      {},
      { name: "daily-summary", options: { locale: "zh-CN" } },
    );

    expect(hub.drainResolver).toHaveBeenCalledWith(
      { limit: 7 },
      desktopModelIngressHost,
    );
    expect(hub.runSkill).toHaveBeenCalledWith(
      "daily-summary",
      { locale: "zh-CN" },
      desktopModelIngressHost,
    );
  });

  it("preserves the legacy no-deployment path without inventing authority", async () => {
    register({ ipcMain, hubWiring });

    await handlers.get("personal-data-hub:resolver-drain")({}, {});
    await handlers.get("personal-data-hub:run-skill")(
      {},
      { name: "daily-summary" },
    );

    expect(hub.drainResolver).toHaveBeenCalledWith({ limit: 50 }, null);
    expect(hub.runSkill).toHaveBeenCalledWith("daily-summary", {}, null);
  });
});
