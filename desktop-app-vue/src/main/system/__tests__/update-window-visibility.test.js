/**
 * v5.0.3.96 — covers shouldFallbackToOsNotification.
 *
 * Background: AppUpdateNotifier 卡片画在 BrowserWindow 内（v5.0.3.44 起 notifier-only）；
 * 用户最小化到托盘后从托盘点"检查更新"，downloaded / not-available / error
 * 三状态的 UI 全画在不可见窗口里 = 哑响。修法是 window 隐藏 / 最小化 /
 * destroyed 时额外发 OS 系统通知，点击通知亮窗。这个 helper 给三处事件共用。
 *
 * 这个 helper 只负责"是否应当发通知"判定。点击亮窗 + Notification.show
 * 的副作用在 auto-updater.js#maybeNotify* 手测覆盖（同 classifier，
 * 整文件 require 会拉 electron-updater 真单例）。
 */

import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  shouldFallbackToOsNotification,
} = require("../update-window-visibility.js");

function fakeWin({ visible, minimized, destroyed = false } = {}) {
  return {
    isVisible: () => visible,
    isMinimized: () => minimized,
    isDestroyed: () => destroyed,
  };
}

describe("shouldFallbackToOsNotification", () => {
  it("returns false when window is null (no main window yet)", () => {
    expect(
      shouldFallbackToOsNotification({
        window: null,
        notificationSupported: true,
      }),
    ).toBe(false);
  });

  it("returns false when window is undefined", () => {
    expect(
      shouldFallbackToOsNotification({
        window: undefined,
        notificationSupported: true,
      }),
    ).toBe(false);
  });

  it("returns false when window is destroyed (app quitting)", () => {
    expect(
      shouldFallbackToOsNotification({
        window: fakeWin({ visible: false, minimized: false, destroyed: true }),
        notificationSupported: true,
      }),
    ).toBe(false);
  });

  it("returns false when Notification API not supported (Linux without libnotify)", () => {
    expect(
      shouldFallbackToOsNotification({
        window: fakeWin({ visible: false, minimized: false }),
        notificationSupported: false,
      }),
    ).toBe(false);
  });

  it("returns false when window is visible and not minimized (notifier card OK)", () => {
    expect(
      shouldFallbackToOsNotification({
        window: fakeWin({ visible: true, minimized: false }),
        notificationSupported: true,
      }),
    ).toBe(false);
  });

  it("returns true when window is hidden to tray (real user symptom)", () => {
    // 用户日志里的 case：托盘点检查更新，download 完成时窗口仍在托盘里
    expect(
      shouldFallbackToOsNotification({
        window: fakeWin({ visible: false, minimized: false }),
        notificationSupported: true,
      }),
    ).toBe(true);
  });

  it("returns true when window is minimized (notifier hidden behind taskbar)", () => {
    // isVisible 在最小化时 Electron 行为是 true，但卡片仍画不出来
    expect(
      shouldFallbackToOsNotification({
        window: fakeWin({ visible: true, minimized: true }),
        notificationSupported: true,
      }),
    ).toBe(true);
  });

  it("returns true when window has neither isVisible nor isMinimized (defensive)", () => {
    expect(
      shouldFallbackToOsNotification({
        window: { isDestroyed: () => false },
        notificationSupported: true,
      }),
    ).toBe(true);
  });
});
