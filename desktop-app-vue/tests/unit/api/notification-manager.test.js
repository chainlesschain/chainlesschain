import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const {
  APINotificationManager,
} = require("../../../src/main/api/notification-manager.js");

class FakeNotification extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.show = vi.fn();
    this.close = vi.fn(() => this.emit("close"));
    FakeNotification.instances.push(this);
  }
}

function createManager(limits = {}) {
  const manager = new APINotificationManager({
    NotificationClass: FakeNotification,
    limits,
  });
  manager.getIconPath = vi.fn(() => "icon.png");
  return manager;
}

afterEach(() => {
  vi.useRealTimers();
  FakeNotification.instances = [];
});

describe("API notification manager resource boundaries", () => {
  it("returns structured overload and releases admission on close", () => {
    const manager = createManager({ maxActiveNotifications: 1 });

    expect(manager.notifyEmailSent("a@example.com", "one")).toEqual({
      accepted: true,
    });
    expect(manager.notifyEmailSent("a@example.com", "two")).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      limit: { maxActiveNotifications: 1 },
    });

    FakeNotification.instances[0].emit("close");
    expect(manager.notifyEmailSent("a@example.com", "three")).toEqual({
      accepted: true,
    });
    manager.cleanup();
  });

  it("expires active notifications and closes them at the TTL", async () => {
    vi.useFakeTimers();
    const manager = createManager({ notificationTtlMs: 25 });

    manager.notifyRSSError("feed", "failure");
    expect(manager.getStats().activeNotifications).toBe(1);

    await vi.advanceTimersByTimeAsync(25);
    expect(FakeNotification.instances[0].close).toHaveBeenCalledTimes(1);
    expect(manager.getStats().activeNotifications).toBe(0);
    manager.cleanup();
  });

  it("retains only a detached bounded projection for click navigation", () => {
    const manager = createManager({ maxClickItems: 2, maxTextBytes: 32 });
    const send = vi.fn();
    manager.setMainWindow({
      isDestroyed: () => false,
      isMinimized: () => false,
      focus: vi.fn(),
      webContents: { send },
    });
    const items = [
      { id: "one", title: "One", content: "x".repeat(100_000) },
      { id: "two", title: "Two", content: "x".repeat(100_000) },
      { id: "three", title: "Three", content: "x".repeat(100_000) },
    ];

    manager.notifyNewArticles("feed", 3, items);
    items[0].id = "mutated";
    FakeNotification.instances[0].emit("click");

    expect(send).toHaveBeenCalledWith("notification:navigate", {
      route: "/rss",
      params: {
        feedTitle: "feed",
        highlightItems: ["one", "two"],
      },
    });
    expect(manager.getStats().activeNotifications).toBe(0);
    manager.cleanup();
  });

  it("bounds batch grouping and ignores prototype-like notification types", () => {
    const manager = createManager({ maxBatchNotifications: 3 });

    const result = manager.notifyBatch([
      { type: "rss", count: 2 },
      { type: "email", count: 3 },
      { type: "__proto__", count: 99 },
      { type: "rss", count: 100 },
    ]);

    expect(result).toMatchObject({ accepted: true, admitted: 3, dropped: 1 });
    expect(result.deliveryResults).toHaveLength(2);
    expect(FakeNotification.instances).toHaveLength(2);
    expect(FakeNotification.instances[0].options.body).toContain("2 篇");
    expect(FakeNotification.instances[1].options.body).toContain("3 封");
    manager.cleanup();
  });

  it("rejects oversized navigation and cleans up idempotently", () => {
    const manager = createManager({ maxNavigationBytes: 32 });
    const send = vi.fn();
    manager.setMainWindow({
      isDestroyed: () => false,
      isMinimized: () => false,
      focus: vi.fn(),
      webContents: { send },
    });
    manager.notifyEmailSent("a@example.com", "subject");

    expect(manager.navigateTo("/email", { value: "x".repeat(100) })).toBe(
      false,
    );
    expect(send).not.toHaveBeenCalled();

    manager.cleanup();
    manager.cleanup();
    expect(FakeNotification.instances[0].close).toHaveBeenCalledTimes(1);
    expect(manager.notifyEmailSent("a@example.com", "after")).toMatchObject({
      accepted: false,
      code: "CANCELED",
    });
  });
});
