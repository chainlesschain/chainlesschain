/**
 * settings-manager 文件监听生命周期测试 —— 验证 fs.watch 不泄漏：
 * 单例只创建一个 FSWatcher、重复调用不累积、close() 关闭并清空、
 * destroySettingsManager() 释放全局实例。
 */

const os = require("os");
const path = require("path");
const fs = require("fs");

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
    getVersion: vi.fn(() => "test"),
  },
}));

const {
  SettingsManager,
  getSettingsManager,
  destroySettingsManager,
} = require("../settings-manager.js");

let tmpDir;
let settingsPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-"));
  settingsPath = path.join(tmpDir, "settings.json");
});

afterEach(() => {
  try {
    destroySettingsManager();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("SettingsManager file watcher lifecycle", () => {
  it("creates exactly one watcher and does not duplicate on repeated watch calls", () => {
    const sm = new SettingsManager({ settingsPath });
    expect(sm._fileWatcher).toBeTruthy();
    const first = sm._fileWatcher;
    sm.watchSettingsFile(); // repeat — must be a no-op
    expect(sm._fileWatcher).toBe(first);
    sm.close();
  });

  it("close() closes the watcher, clears the reference, and is idempotent", () => {
    const sm = new SettingsManager({ settingsPath });
    expect(sm._fileWatcher).toBeTruthy();
    sm.close();
    expect(sm._fileWatcher).toBeNull();
    expect(() => sm.close()).not.toThrow();
  });

  it("destroySettingsManager closes the watcher and resets the singleton", () => {
    const a = getSettingsManager({ settingsPath });
    expect(a._fileWatcher).toBeTruthy();
    destroySettingsManager();
    expect(a._fileWatcher).toBeNull();
    const b = getSettingsManager({ settingsPath });
    expect(b).not.toBe(a); // fresh instance after destroy
    b.close();
  });
});
