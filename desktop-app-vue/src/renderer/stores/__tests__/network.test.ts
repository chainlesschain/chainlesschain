/**
 * useNetworkStore — Pinia store unit tests
 *
 * Covers:
 *  - isOnline initialized from navigator.onLine
 *  - updateOnlineStatus reflects the current navigator.onLine
 *  - initNetworkListeners: window online/offline events update isOnline
 *  - removeNetworkListeners: events no longer update isOnline after removal
 *
 * NB: drives the real jsdom window events; navigator.onLine is overridden via
 * Object.defineProperty per-test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useNetworkStore } from "../network";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

describe("useNetworkStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setOnline(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setOnline(true);
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("isOnline mirrors navigator.onLine at creation", () => {
      setOnline(false);
      const store = useNetworkStore();
      expect(store.isOnline).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // updateOnlineStatus
  // -------------------------------------------------------------------------

  describe("updateOnlineStatus", () => {
    it("re-reads navigator.onLine", () => {
      const store = useNetworkStore();
      expect(store.isOnline).toBe(true);
      setOnline(false);
      store.updateOnlineStatus();
      expect(store.isOnline).toBe(false);
      setOnline(true);
      store.updateOnlineStatus();
      expect(store.isOnline).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // listeners
  // -------------------------------------------------------------------------

  describe("network listeners", () => {
    it("initNetworkListeners makes online/offline events update isOnline", () => {
      const store = useNetworkStore();
      store.initNetworkListeners();

      setOnline(false);
      window.dispatchEvent(new Event("offline"));
      expect(store.isOnline).toBe(false);

      setOnline(true);
      window.dispatchEvent(new Event("online"));
      expect(store.isOnline).toBe(true);

      store.removeNetworkListeners();
    });

    it("removeNetworkListeners stops events from updating isOnline", () => {
      const store = useNetworkStore();
      store.initNetworkListeners();
      store.removeNetworkListeners();

      setOnline(false);
      window.dispatchEvent(new Event("offline"));
      expect(store.isOnline).toBe(true); // unchanged after removal
    });
  });
});
