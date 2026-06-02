/**
 * useSocialStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: totalUnreadCount / onlineFriends / offlineFriends /
 *    pendingRequestsCount / pinnedSessions / unreadSessionsCount /
 *    unreadNotificationsList
 *  - Pure actions: setFriendOnlineStatus / addNotification / clearAllNotifications /
 *    toggleChatWindow / toggleNotificationPanel
 *  - Notification read actions (mocked IPC): markNotificationAsRead /
 *    markAllNotificationsAsRead
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// social.ts builds ipcRenderer at MODULE LOAD via createRetryableIPC, so the
// mock factory runs before normal const init — use vi.hoisted so mockInvoke
// exists when the factory captures it (avoids TDZ → silent undefined invoke).
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

// NB: path is relative to THIS test file. social.ts (in stores/) imports
// "../utils/ipc" = renderer/utils/ipc; from stores/__tests__/ that's "../../utils/ipc".
vi.mock("../../utils/ipc", () => ({
  createRetryableIPC: () => ({ invoke: mockInvoke }),
}));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useSocialStore } from "../social";
import type {
  Friend,
  ChatSession,
  FriendRequest,
  Notification,
} from "../social";

function makeFriend(overrides: Partial<Friend> = {}): Friend {
  return { friend_did: "did:f1", nickname: "F1", ...overrides };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "s1",
    participant_did: "did:f1",
    friend_nickname: "F1",
    last_message: null,
    last_message_time: null,
    unread_count: 0,
    is_pinned: 0,
    created_at: 1700000000000,
    ...overrides,
  } as ChatSession;
}

function makeRequest(overrides: Partial<FriendRequest> = {}): FriendRequest {
  return {
    id: "r1",
    from_did: "did:x",
    to_did: "did:me",
    status: "pending",
    created_at: 1700000000000,
    ...overrides,
  };
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    type: "system" as any,
    title: "T",
    content: "C",
    is_read: 0,
    created_at: 1700000000000,
    ...overrides,
  };
}

describe("useSocialStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with zero unread and hidden panels", () => {
      const store = useSocialStore();
      expect(store.friends).toEqual([]);
      expect(store.friendRequests).toEqual([]);
      expect(store.onlineStatus instanceof Map).toBe(true);
      expect(store.notifications).toEqual([]);
      expect(store.unreadCount).toBe(0);
      expect(store.unreadNotifications).toBe(0);
      expect(store.chatWindowVisible).toBe(false);
      expect(store.notificationPanelVisible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("totalUnreadCount sums message + notification unread", () => {
      const store = useSocialStore();
      store.unreadCount = 3;
      store.unreadNotifications = 4;
      expect(store.totalUnreadCount).toBe(7);
    });

    it("onlineFriends / offlineFriends split by onlineStatus map", () => {
      const store = useSocialStore();
      store.friends = [
        makeFriend({ friend_did: "a" }),
        makeFriend({ friend_did: "b" }),
        makeFriend({ friend_did: "c" }),
      ];
      store.onlineStatus = new Map([
        ["a", "online"],
        ["b", "away"],
        // c absent → treated offline
      ]) as any;
      expect(store.onlineFriends.map((f) => f.friend_did)).toEqual(["a"]);
      expect(store.offlineFriends.map((f) => f.friend_did)).toEqual(["b", "c"]);
    });

    it("pendingRequestsCount counts only pending requests", () => {
      const store = useSocialStore();
      store.friendRequests = [
        makeRequest({ id: "r1", status: "pending" }),
        makeRequest({ id: "r2", status: "accepted" }),
        makeRequest({ id: "r3", status: "pending" }),
      ];
      expect(store.pendingRequestsCount).toBe(2);
    });

    it("pinnedSessions + unreadSessionsCount derive from chatSessions", () => {
      const store = useSocialStore();
      store.chatSessions = [
        makeSession({ id: "s1", is_pinned: 1, unread_count: 0 }),
        makeSession({ id: "s2", is_pinned: 0, unread_count: 5 }),
        makeSession({ id: "s3", is_pinned: 1, unread_count: 2 }),
      ];
      expect(store.pinnedSessions.map((s) => s.id)).toEqual(["s1", "s3"]);
      expect(store.unreadSessionsCount).toBe(2); // s2, s3
    });

    it("unreadNotificationsList filters is_read === 0", () => {
      const store = useSocialStore();
      store.notifications = [
        makeNotification({ id: "n1", is_read: 0 }),
        makeNotification({ id: "n2", is_read: 1 }),
        makeNotification({ id: "n3", is_read: 0 }),
      ];
      expect(store.unreadNotificationsList.map((n) => n.id)).toEqual([
        "n1",
        "n3",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("setFriendOnlineStatus updates the map", () => {
      const store = useSocialStore();
      store.setFriendOnlineStatus("did:f1", "online");
      expect(store.onlineStatus.get("did:f1")).toBe("online");
    });

    it("addNotification prepends an unread notification and bumps the count", () => {
      const store = useSocialStore();
      store.addNotification({
        type: "system" as any,
        title: "Hi",
        content: "msg",
      });
      expect(store.notifications).toHaveLength(1);
      expect(store.notifications[0]).toMatchObject({
        title: "Hi",
        content: "msg",
        is_read: 0,
      });
      expect(store.unreadNotifications).toBe(1);
      // fires a desktop notification via IPC
      expect(mockInvoke).toHaveBeenCalledWith(
        "notification:send-desktop",
        "Hi",
        "msg",
      );
    });

    it("clearAllNotifications empties the list and zeroes the count", () => {
      const store = useSocialStore();
      store.notifications = [makeNotification()];
      store.unreadNotifications = 1;
      store.clearAllNotifications();
      expect(store.notifications).toEqual([]);
      expect(store.unreadNotifications).toBe(0);
    });

    it("toggleChatWindow toggles or sets explicitly", () => {
      const store = useSocialStore();
      store.toggleChatWindow();
      expect(store.chatWindowVisible).toBe(true);
      store.toggleChatWindow();
      expect(store.chatWindowVisible).toBe(false);
      store.toggleChatWindow(true);
      expect(store.chatWindowVisible).toBe(true);
    });

    it("toggleNotificationPanel toggles or sets explicitly", () => {
      const store = useSocialStore();
      store.toggleNotificationPanel(true);
      expect(store.notificationPanelVisible).toBe(true);
      store.toggleNotificationPanel();
      expect(store.notificationPanelVisible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Notification read actions (IPC + local mutation)
  // -------------------------------------------------------------------------

  describe("notification read actions", () => {
    it("markNotificationAsRead flips one notification and decrements count", async () => {
      const store = useSocialStore();
      store.notifications = [makeNotification({ id: "n1", is_read: 0 })];
      store.unreadNotifications = 1;
      await store.markNotificationAsRead("n1");
      expect(mockInvoke).toHaveBeenCalledWith("notification:mark-read", "n1");
      expect(store.notifications[0].is_read).toBe(1);
      expect(store.unreadNotifications).toBe(0);
    });

    it("markNotificationAsRead does not go negative for an already-read notification", async () => {
      const store = useSocialStore();
      store.notifications = [makeNotification({ id: "n1", is_read: 1 })];
      store.unreadNotifications = 0;
      await store.markNotificationAsRead("n1");
      expect(store.unreadNotifications).toBe(0);
    });

    it("markAllNotificationsAsRead flips all and zeroes the count", async () => {
      const store = useSocialStore();
      store.notifications = [
        makeNotification({ id: "n1", is_read: 0 }),
        makeNotification({ id: "n2", is_read: 0 }),
      ];
      store.unreadNotifications = 2;
      await store.markAllNotificationsAsRead();
      expect(mockInvoke).toHaveBeenCalledWith("notification:mark-all-read");
      expect(store.notifications.every((n) => n.is_read === 1)).toBe(true);
      expect(store.unreadNotifications).toBe(0);
    });
  });
});
