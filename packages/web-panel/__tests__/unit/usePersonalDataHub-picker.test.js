import { beforeEach, describe, expect, it, vi } from "vitest";

const sendRaw = vi.fn();
const shellMode = vi.hoisted(() => ({ isEmbedded: true }));

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

vi.mock("../../src/composables/useShellMode.js", () => ({
  useShellMode: () => shellMode,
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub native source pickers", () => {
  beforeEach(() => {
    sendRaw.mockReset();
    shellMode.isEmbedded = true;
  });

  it("accepts the desktop fs.openDialog path response", async () => {
    sendRaw.mockResolvedValue({
      ok: true,
      result: { canceled: false, path: "C:\\Exports\\snapshot.json" },
    });

    await expect(
      usePersonalDataHub().pickFile({ title: "选择快照" }),
    ).resolves.toBe("C:\\Exports\\snapshot.json");
    expect(sendRaw).toHaveBeenCalledWith(
      {
        type: "fs.openDialog",
        title: "选择快照",
        filters: undefined,
      },
      60000,
    );
  });

  it("keeps compatibility with the legacy filePath response", async () => {
    sendRaw.mockResolvedValue({
      result: {
        ok: true,
        canceled: false,
        filePath: "/exports/snapshot.json",
      },
    });

    await expect(usePersonalDataHub().pickFile()).resolves.toBe(
      "/exports/snapshot.json",
    );
  });

  it("selects an export directory through fs.openDirectory", async () => {
    sendRaw.mockResolvedValue({
      ok: true,
      result: {
        canceled: false,
        path: "C:\\Exports\\Tencent Docs",
        initialized: false,
      },
    });

    await expect(
      usePersonalDataHub().pickDirectory({ title: "选择腾讯文档导出目录" }),
    ).resolves.toBe("C:\\Exports\\Tencent Docs");
    expect(sendRaw).toHaveBeenCalledWith(
      {
        type: "fs.openDirectory",
        title: "选择腾讯文档导出目录",
      },
      60000,
    );
  });

  it("distinguishes a cancelled directory picker from an unavailable host capability", async () => {
    const hub = usePersonalDataHub();
    sendRaw.mockResolvedValueOnce({
      result: { canceled: true, path: null },
    });
    await expect(hub.pickDirectoryResult()).resolves.toEqual({
      status: "cancelled",
      path: null,
    });

    sendRaw.mockResolvedValueOnce({
      ok: false,
      error: "unknown_message_type: fs.openDirectory",
    });
    await expect(hub.pickDirectoryResult()).resolves.toEqual({
      status: "unavailable",
      path: null,
    });

    sendRaw.mockRejectedValueOnce(new Error("main_window_unavailable"));
    await expect(hub.pickDirectoryResult()).resolves.toEqual({
      status: "unavailable",
      path: null,
    });
  });

  it("fails over immediately when a browser host has no native picker capability", async () => {
    shellMode.isEmbedded = false;

    await expect(usePersonalDataHub().pickDirectoryResult()).resolves.toEqual({
      status: "unavailable",
      path: null,
    });
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it("keeps the path-only directory picker backward compatible", async () => {
    const hub = usePersonalDataHub();
    sendRaw.mockResolvedValueOnce({
      result: { canceled: true, path: null },
    });
    await expect(hub.pickDirectory()).resolves.toBeNull();

    sendRaw.mockRejectedValueOnce(new Error("main_window_unavailable"));
    await expect(hub.pickFile()).resolves.toBeNull();
  });
});
