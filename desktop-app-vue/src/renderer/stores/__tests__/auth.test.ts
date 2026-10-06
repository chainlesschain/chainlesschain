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
    vi.stubGlobal("electronAPI", undefined);
    window.electronAPI = {
      auth: { logout: vi.fn().mockResolvedValue(undefined) },
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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
    it("clears the app store's auth state after main-process logout", async () => {
      const app = useAppStore();
      app.setAuthenticated(true);
      app.setDeviceId("device-123");

      const auth = useAuthStore();
      await auth.logout();

      expect(window.electronAPI.auth.logout).toHaveBeenCalledOnce();
      expect(app.isAuthenticated).toBe(false);
      expect(app.deviceId).toBeNull();
      expect(auth.currentUser).toBeNull();
    });

    it("retains visible authentication until main-process revocation completes", async () => {
      let release!: () => void;
      window.electronAPI.auth.logout = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const app = useAppStore();
      app.setAuthenticated(true);
      app.setDeviceId("device-123");
      const pending = useAuthStore().logout();
      expect(app.isAuthenticated).toBe(true);
      release();
      await pending;
      expect(app.isAuthenticated).toBe(false);
    });

    it("does not report logout when the main process rejects revocation", async () => {
      window.electronAPI.auth.logout = vi
        .fn()
        .mockRejectedValue(new Error("unavailable"));
      const app = useAppStore();
      app.setAuthenticated(true);
      app.setDeviceId("device-123");
      await expect(useAuthStore().logout()).rejects.toThrow("unavailable");
      expect(app.isAuthenticated).toBe(true);
      expect(app.deviceId).toBe("device-123");
    });
  });
});
