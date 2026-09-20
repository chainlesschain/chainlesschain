import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const handlers = new Map();
  const ipcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
  };
  return { handlers, ipcMain };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain,
  default: { ipcMain: electronMock.ipcMain },
}));

const {
  registerSkillsIPC,
  unregisterSkillsIPC,
} = require("../skills-ipc.js");

describe("Markdown Skills IPC surface", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    vi.clearAllMocks();
  });

  it("registers only product-consumed skill and credential routes", () => {
    registerSkillsIPC({
      ipcMain: electronMock.ipcMain,
      externalHandlerExecutor: null,
      bundledSkillCredentialStore: {
        status: vi.fn(() => ({})),
        set: vi.fn(),
        clear: vi.fn(),
      },
    });

    expect([...electronMock.handlers.keys()].sort()).toEqual(
      [
        "skills:clear-credential",
        "skills:credential-status",
        "skills:execute",
        "skills:get",
        "skills:list",
        "skills:list-invocable",
        "skills:route",
        "skills:set-credential",
      ].sort(),
    );

    unregisterSkillsIPC({ ipcMain: electronMock.ipcMain });
    expect(electronMock.handlers.size).toBe(0);
  });
});
