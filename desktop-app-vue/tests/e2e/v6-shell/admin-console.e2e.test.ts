/**
 * E2E — v6 Shell AdminConsole
 *
 * 验证 Ctrl+Shift+A 全局快捷键、/admin 命令、状态栏齿轮按钮三种路径都能
 * 打开 AdminConsole 模态框。当前跟随项目约定 `describe.skip`，待 E2E 登录
 * 辅助函数支持预置 admin 权限 + 跳过慢启动后再开启。
 */

import { test, expect } from "@playwright/test";
import { launchElectronApp, closeElectronApp, login } from "../helpers/common";

test.describe.skip("v6 Shell · AdminConsole", () => {
  test("Ctrl+Shift+A 打开 AdminConsole", async () => {
    const { app, window } = await launchElectronApp();
    try {
      await login(window);
      await window.goto("/v2");
      await window.waitForSelector(".app-shell", { timeout: 15000 });

      // 触发 Ctrl+Shift+A
      await window.keyboard.press("Control+Shift+A");

      const modal = await window.waitForSelector(".admin-console-modal", {
        timeout: 5000,
      });
      expect(await modal.isVisible()).toBe(true);

      // 再按一次应关闭（toggle 语义）
      await window.keyboard.press("Control+Shift+A");
      await window.waitForSelector(".admin-console-modal", {
        state: "hidden",
        timeout: 5000,
      });
    } finally {
      await closeElectronApp(app);
    }
  });

  test("/admin 命令从 Composer 打开 AdminConsole", async () => {
    const { app, window } = await launchElectronApp();
    try {
      await login(window);
      await window.goto("/v2");
      await window.waitForSelector(".composer-input", { timeout: 15000 });

      await window.fill(".composer-input", "/admin");
      await window.keyboard.press("Enter");

      const modal = await window.waitForSelector(".admin-console-modal", {
        timeout: 5000,
      });
      expect(await modal.isVisible()).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test("状态栏齿轮按钮打开 AdminConsole", async () => {
    const { app, window } = await launchElectronApp();
    try {
      await login(window);
      await window.goto("/v2");
      await window.waitForSelector(".admin-shortcut", { timeout: 15000 });

      await window.click(".admin-shortcut");

      const modal = await window.waitForSelector(".admin-console-modal", {
        timeout: 5000,
      });
      expect(await modal.isVisible()).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
