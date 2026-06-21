/**
 * Config IPC 单元测试 — config:set 写保护 (IPC 安全发现 #4)
 *
 * config:set 此前对任意 key 直接 appConfig.set，渲染层可写入敏感配置（如
 * database.sqlcipherKey —— SQLCipher 主密钥）。现拒绝写入受保护前缀（database.*），
 * 同时保持合法的 UI/项目配置写入不受影响。
 *
 * config-ipc.js 直接 require electron 的 ipcMain（非注入），vitest 已将 electron
 * 别名到 tests/__mocks__/electron.ts，其 ipcMain.handle 为 vi.fn() → 可捕获 handler。
 */

import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("Config IPC — config:set 写保护 (#4)", () => {
  let setHandler;
  let updateHandler;
  let mockAppConfig;

  beforeAll(async () => {
    mockAppConfig = {
      set: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => ({})),
    };
    // 注入捕获型 ipcMain（config-ipc 支持 ipcMain 注入，用于测试）。
    const handlers = {};
    const mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };
    const { registerConfigIPC } =
      await import("../../../src/main/config/config-ipc.js");
    registerConfigIPC({ appConfig: mockAppConfig, ipcMain: mockIpcMain });
    setHandler = handlers["config:set"];
    updateHandler = handlers["config:update"];
  });

  it("registers a config:set handler", () => {
    expect(typeof setHandler).toBe("function");
  });

  it("rejects writing database.sqlcipherKey (protected DB key)", async () => {
    mockAppConfig.set.mockClear();
    const res = await setHandler({}, "database.sqlcipherKey", "attacker-key");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/protected config key/);
    expect(mockAppConfig.set).not.toHaveBeenCalled();
  });

  it("rejects any database.* key", async () => {
    mockAppConfig.set.mockClear();
    const res = await setHandler({}, "database.somethingNew", "x");
    expect(res.success).toBe(false);
    expect(mockAppConfig.set).not.toHaveBeenCalled();
  });

  it("allows a normal project key", async () => {
    mockAppConfig.set.mockClear();
    const res = await setHandler({}, "project.rootPath", "/new/path");
    expect(res.success).toBe(true);
    expect(mockAppConfig.set).toHaveBeenCalledWith(
      "project.rootPath",
      "/new/path",
    );
  });

  it("allows ui.useWebShellExperimental (legit renderer write)", async () => {
    mockAppConfig.set.mockClear();
    const res = await setHandler({}, "ui.useWebShellExperimental", true);
    expect(res.success).toBe(true);
    expect(mockAppConfig.set).toHaveBeenCalledWith(
      "ui.useWebShellExperimental",
      true,
    );
  });

  it("config:update skips the protected database namespace but writes the rest", async () => {
    expect(typeof updateHandler).toBe("function");
    mockAppConfig.set.mockClear();
    const res = await updateHandler(
      {},
      {
        project: { rootPath: "/p" },
        database: { sqlcipherKey: "attacker-key" },
      },
    );
    expect(res.success).toBe(true);
    // database 命名空间被跳过（不写入），其它键正常写入。
    expect(mockAppConfig.set).toHaveBeenCalledWith("project", {
      rootPath: "/p",
    });
    expect(mockAppConfig.set).not.toHaveBeenCalledWith(
      "database",
      expect.anything(),
    );
  });
});
