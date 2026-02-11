/**
 * NotificationManager 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  NotificationManager,
  NotificationLevel,
  NotificationType,
  getNotificationManager,
} = require("../notification-manager");

// Create mock Notification class for testing
class MockNotification {
  constructor(options) {
    this.options = options;
    this.handlers = {};
  }
  on(event, handler) {
    this.handlers[event] = handler;
  }
  show() {}
  close() {
    if (this.handlers.close) {
      this.handlers.close();
    }
  }
  static isSupported() {
    return true;
  }
}

describe("NotificationManager", () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new NotificationManager(
      {
        enableSystemNotifications: true,
        enableToast: true,
        enableSound: false,
        defaultTimeout: 1000,
      },
      { NotificationClass: MockNotification },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with default config", () => {
      expect(manager.config.enableSystemNotifications).toBe(true);
      expect(manager.config.enableToast).toBe(true);
    });

    it("should include default templates", () => {
      expect(manager.config.templates["automation:started"]).toBeDefined();
      expect(manager.config.templates["automation:completed"]).toBeDefined();
    });
  });

  describe("notify", () => {
    it("should send a notification", () => {
      const result = manager.notify({
        title: "Test",
        body: "Test notification",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
    });

    it("should add to history", () => {
      manager.notify({ title: "Test", body: "Message" });

      const history = manager.getHistory();
      expect(history.length).toBe(1);
    });

    it("should update stats", () => {
      manager.notify({
        title: "Test",
        body: "Message",
        level: NotificationLevel.INFO,
      });

      const stats = manager.getStats();
      expect(stats.totalNotifications).toBe(1);
      expect(stats.byLevel[NotificationLevel.INFO]).toBe(1);
    });

    it("should respect quiet hours", () => {
      const now = new Date();
      manager.setQuietHours(0, 24); // Always quiet

      const result = manager.notify({ title: "Test", body: "Message" });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Quiet hours active");
    });
  });

  describe("notifyFromTemplate", () => {
    it("should send notification from template", () => {
      const result = manager.notifyFromTemplate("automation:started", {
        body: "Task started",
      });

      expect(result.success).toBe(true);
    });

    it("should fail for unknown template", () => {
      const result = manager.notifyFromTemplate("unknown:template");

      expect(result.success).toBe(false);
    });
  });

  describe("dismiss", () => {
    it("should dismiss active notification", () => {
      const { id } = manager.notify({ title: "Test", body: "Message" });

      const result = manager.dismiss(id);

      expect(result.success).toBe(true);
    });

    it("should fail for unknown notification", () => {
      const result = manager.dismiss("unknown-id");

      expect(result.success).toBe(false);
    });
  });

  describe("dismissAll", () => {
    it("should dismiss all notifications", () => {
      manager.notify({ title: "Test 1", body: "Message 1" });
      manager.notify({ title: "Test 2", body: "Message 2" });

      const result = manager.dismissAll();

      expect(result.success).toBe(true);
    });
  });

  describe("markAsRead", () => {
    it("should mark notification as read", () => {
      const { id } = manager.notify({ title: "Test", body: "Message" });

      const result = manager.markAsRead(id);

      expect(result.success).toBe(true);
    });

    it("should fail for unknown notification", () => {
      const result = manager.markAsRead("unknown-id");

      expect(result.success).toBe(false);
    });
  });

  describe("markAllAsRead", () => {
    it("should mark all as read", () => {
      manager.notify({ title: "Test 1", body: "Message 1" });
      manager.notify({ title: "Test 2", body: "Message 2" });

      const result = manager.markAllAsRead();

      expect(result.success).toBe(true);
      expect(manager.getUnreadCount()).toBe(0);
    });
  });

  describe("getHistory", () => {
    it("should return notification history", () => {
      manager.notify({ title: "Test 1", body: "Message 1" });
      manager.notify({ title: "Test 2", body: "Message 2" });

      const history = manager.getHistory();

      expect(history.length).toBe(2);
    });

    it("should filter by level", () => {
      manager.notify({
        title: "Info",
        body: "Message",
        level: NotificationLevel.INFO,
      });
      manager.notify({
        title: "Error",
        body: "Message",
        level: NotificationLevel.ERROR,
      });

      const history = manager.getHistory({ level: NotificationLevel.ERROR });

      expect(history.length).toBe(1);
      expect(history[0].level).toBe(NotificationLevel.ERROR);
    });

    it("should filter unread only", () => {
      const { id } = manager.notify({ title: "Test 1", body: "Message 1" });
      manager.notify({ title: "Test 2", body: "Message 2" });
      manager.markAsRead(id);

      const history = manager.getHistory({ unreadOnly: true });

      expect(history.length).toBe(1);
    });
  });

  describe("getUnreadCount", () => {
    it("should return unread count", () => {
      manager.notify({ title: "Test 1", body: "Message 1" });
      manager.notify({ title: "Test 2", body: "Message 2" });

      expect(manager.getUnreadCount()).toBe(2);
    });
  });

  describe("registerTemplate", () => {
    it("should register custom template", () => {
      const result = manager.registerTemplate("custom:test", {
        title: "Custom Test",
        level: NotificationLevel.INFO,
      });

      expect(result.success).toBe(true);
      expect(manager.config.templates["custom:test"]).toBeDefined();
    });
  });

  describe("unregisterTemplate", () => {
    it("should unregister template", () => {
      manager.registerTemplate("custom:test", { title: "Test" });

      const result = manager.unregisterTemplate("custom:test");

      expect(result.success).toBe(true);
      expect(manager.config.templates["custom:test"]).toBeUndefined();
    });

    it("should fail for unknown template", () => {
      const result = manager.unregisterTemplate("unknown");

      expect(result.success).toBe(false);
    });
  });

  describe("getTemplates", () => {
    it("should return all templates", () => {
      const templates = manager.getTemplates();

      expect(templates["automation:started"]).toBeDefined();
    });
  });

  describe("setQuietHours", () => {
    it("should set quiet hours", () => {
      const result = manager.setQuietHours(22, 8);

      expect(result.success).toBe(true);
      expect(manager.config.quietHoursStart).toBe(22);
      expect(manager.config.quietHoursEnd).toBe(8);
    });
  });

  describe("clearQuietHours", () => {
    it("should clear quiet hours", () => {
      manager.setQuietHours(22, 8);

      const result = manager.clearQuietHours();

      expect(result.success).toBe(true);
      expect(manager.config.quietHoursStart).toBeNull();
    });
  });

  describe("getStats", () => {
    it("should return statistics", () => {
      manager.notify({ title: "Test", body: "Message" });

      const stats = manager.getStats();

      expect(stats.totalNotifications).toBe(1);
      expect(stats.unread).toBeDefined();
      expect(stats.active).toBeDefined();
    });
  });

  describe("resetStats", () => {
    it("should reset statistics", () => {
      manager.notify({ title: "Test", body: "Message" });
      manager.resetStats();

      const stats = manager.getStats();
      expect(stats.totalNotifications).toBe(0);
    });
  });

  describe("clearHistory", () => {
    it("should clear history", () => {
      manager.notify({ title: "Test", body: "Message" });
      manager.clearHistory();

      expect(manager.getHistory().length).toBe(0);
    });
  });

  describe("exportConfig and importConfig", () => {
    it("should export config", () => {
      const config = manager.exportConfig();

      expect(config.enableSystemNotifications).toBeDefined();
      expect(config.templates).toBeDefined();
    });

    it("should import config", () => {
      const result = manager.importConfig({
        enableSound: true,
      });

      expect(result.success).toBe(true);
      expect(manager.config.enableSound).toBe(true);
    });
  });

  describe("NotificationLevel constants", () => {
    it("should have all levels defined", () => {
      expect(NotificationLevel.INFO).toBe("info");
      expect(NotificationLevel.SUCCESS).toBe("success");
      expect(NotificationLevel.WARNING).toBe("warning");
      expect(NotificationLevel.ERROR).toBe("error");
      expect(NotificationLevel.CRITICAL).toBe("critical");
    });
  });

  describe("NotificationType constants", () => {
    it("should have all types defined", () => {
      expect(NotificationType.SYSTEM).toBe("system");
      expect(NotificationType.TOAST).toBe("toast");
      expect(NotificationType.BADGE).toBe("badge");
      expect(NotificationType.SOUND).toBe("sound");
    });
  });

  describe("getNotificationManager singleton", () => {
    it("should return singleton instance", () => {
      const m1 = getNotificationManager();
      const m2 = getNotificationManager();

      expect(m1).toBe(m2);
    });
  });
});
