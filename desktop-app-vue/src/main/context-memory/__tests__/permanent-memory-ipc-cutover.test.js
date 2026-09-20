import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module from "node:module";

const ipcMain = {
  handle: vi.fn(),
  removeHandler: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
};

const originalLoad = Module._load;
Module._load = function loadWithElectronMock(request, parent, isMain) {
  if (request === "electron") {
    return { ipcMain };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const permanentMemoryIPC = require("../../llm/permanent-memory-ipc.js");
const {
  registerPermanentMemoryIPC,
  unregisterPermanentMemoryIPC,
} = permanentMemoryIPC;
Module._load = originalLoad;

const STAGE_ENV = "CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE";
const originalStage = process.env[STAGE_ENV];
const handlers = new Map();

beforeEach(() => {
  process.env[STAGE_ENV] = "canonical_default";
  handlers.clear();
  ipcMain.handle.mockImplementation((channel, handler) => {
    handlers.set(channel, handler);
  });
  ipcMain.removeHandler.mockImplementation((channel) => {
    handlers.delete(channel);
  });
});

afterEach(() => {
  unregisterPermanentMemoryIPC();
  if (originalStage === undefined) {
    delete process.env[STAGE_ENV];
  } else {
    process.env[STAGE_ENV] = originalStage;
  }
});

describe("PermanentMemory IPC canonical cutover", () => {
  it("registers only the renderer-consumed permanent memory routes", () => {
    registerPermanentMemoryIPC(null, { canonicalMemory: {} });

    expect([...handlers.keys()].sort()).toEqual(
      [
        "memory:append-to-memory",
        "memory:clear-embedding-cache",
        "memory:extract-from-conversation",
        "memory:extract-from-session",
        "memory:get-index-stats",
        "memory:get-memory-sections",
        "memory:get-recent-daily-notes",
        "memory:get-stats",
        "memory:read-daily-note",
        "memory:read-memory",
        "memory:rebuild-index",
        "memory:save-to-memory",
        "memory:search",
        "memory:update-memory",
        "memory:write-daily-note",
      ].sort(),
    );
    expect(Object.keys(permanentMemoryIPC).sort()).toEqual(
      ["registerPermanentMemoryIPC", "unregisterPermanentMemoryIPC"].sort(),
    );
  });

  it("routes production reads and writes to the canonical adapter", async () => {
    const permanentMemory = {
      writeDailyNote: vi.fn(),
      readMemory: vi.fn(),
    };
    const canonicalMemory = {
      writeDailyNote: vi.fn().mockResolvedValue({
        record: { memoryId: "memory-1" },
        receipt: { status: "committed" },
      }),
      readMemory: vi.fn().mockResolvedValue("canonical projection"),
    };
    registerPermanentMemoryIPC(permanentMemory, { canonicalMemory });

    await expect(
      handlers.get("memory:write-daily-note")({}, { content: "remember" }),
    ).resolves.toMatchObject({
      success: true,
      canonical: true,
      filePath: "canonical://memory-1",
    });
    await expect(handlers.get("memory:read-memory")({})).resolves.toEqual({
      success: true,
      canonical: true,
      content: "canonical projection",
    });
    expect(canonicalMemory.writeDailyNote).toHaveBeenCalledWith("remember", {
      append: true,
    });
    expect(permanentMemory.writeDailyNote).not.toHaveBeenCalled();
    expect(permanentMemory.readMemory).not.toHaveBeenCalled();
  });

  it("keeps canonical routes available without a legacy manager", async () => {
    const canonicalMemory = {
      readMemory: vi.fn().mockResolvedValue("canonical only"),
    };
    registerPermanentMemoryIPC(null, { canonicalMemory });

    await expect(handlers.get("memory:read-memory")({})).resolves.toEqual({
      success: true,
      canonical: true,
      content: "canonical only",
    });
  });
});
