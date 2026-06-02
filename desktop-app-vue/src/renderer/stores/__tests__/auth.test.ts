/**
 * useAuthStore — Pinia store unit tests
 *
 * Covers:
 *  - currentUser getter: null when unauthenticated, null when authenticated but
 *    no deviceId, populated when both are set
 *  - logout action: resets the underlying app store's auth flags
 *
 * NB: auth.ts delegates to the real useAppStore (plain state + simple
 * mutations), so we drive that store directly rather than mocking it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useAuthStore } from "../auth";
import { useAppStore } from "../app";

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // currentUser getter
  // -------------------------------------------------------------------------

  describe("currentUser", () => {
    it("is null when not authenticated", () => {
      const auth = useAuthStore();
      expect(auth.currentUser).toBeNull();
    });

    it("is null when authenticated but without a deviceId", () => {
      const app = useAppStore();
      app.setAuthenticated(true);
      app.setDeviceId(null);
      const auth = useAuthStore();
      expect(auth.currentUser).toBeNull();
    });

    it("returns a user derived from the deviceId when authenticated", () => {
      const app = useAppStore();
      app.setAuthenticated(true);
      app.setDeviceId("device-123");
      const auth = useAuthStore();
      expect(auth.currentUser).toEqual({
        id: "device-123",
        name: "用户",
        avatar: "",
      });
    });
  });

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------

  describe("logout", () => {
    it("clears the app store's auth state", () => {
      const app = useAppStore();
      app.setAuthenticated(true);
      app.setDeviceId("device-123");

      const auth = useAuthStore();
      auth.logout();

      expect(app.isAuthenticated).toBe(false);
      expect(app.deviceId).toBeNull();
      expect(auth.currentUser).toBeNull();
    });
  });
});
