/**
 * useBleUkeyStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: pairedDevices (d.paired) / isConnected (!!connectedDevice)
 *  - IPC actions (electronAPI.invoke mocked): scanDevices (populate / error),
 *    pairDevice (chains scanDevices), connect (resolve connectedDevice from the
 *    local list / null when unknown), disconnect (clear connectedDevice)
 *
 * NB: store captures `electronAPI` at MODULE LOAD
 * (`const electronAPI = window.electronAPI || window.electron?.ipcRenderer`),
 * so window.electronAPI must exist BEFORE import — set in vi.hoisted, and never
 * delete it here (only reset the mock fn between tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useBleUkeyStore } from "../bleUkey";
import type { BLEDevice } from "../bleUkey";

function device(id: string, paired = false): BLEDevice {
  return {
    id,
    name: `Dev ${id}`,
    rssi: -50,
    distance: 1.2,
    paired,
    connected: false,
    lastSeen: 1700000000000,
  };
}

describe("useBleUkeyStore", () => {
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
    it("starts empty", () => {
      const store = useBleUkeyStore();
      expect(store.devices).toEqual([]);
      expect(store.scanning).toBe(false);
      expect(store.connectedDevice).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("pairedDevices filters d.paired", () => {
      const store = useBleUkeyStore();
      store.devices = [
        device("a", true),
        device("b", false),
        device("c", true),
      ];
      expect(store.pairedDevices.map((d) => d.id)).toEqual(["a", "c"]);
    });

    it("isConnected reflects connectedDevice", () => {
      const store = useBleUkeyStore();
      expect(store.isConnected).toBe(false);
      store.connectedDevice = device("a");
      expect(store.isConnected).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("scanDevices populates and toggles the scanning flag", async () => {
      const store = useBleUkeyStore();
      mockInvoke.mockResolvedValue({
        success: true,
        devices: [device("a"), device("b")],
      });
      await store.scanDevices(5000);
      expect(mockInvoke).toHaveBeenCalledWith("ble-ukey:scan-devices", {
        timeout: 5000,
      });
      expect(store.devices.map((d) => d.id)).toEqual(["a", "b"]);
      expect(store.scanning).toBe(false);
    });

    it("scanDevices records the error on failure", async () => {
      const store = useBleUkeyStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no adapter" });
      await store.scanDevices();
      expect(store.error).toBe("no adapter");
    });

    it("pairDevice chains scanDevices on success", async () => {
      const store = useBleUkeyStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // pair
        .mockResolvedValueOnce({
          success: true,
          devices: [device("a", true)],
        }); // scan
      await store.pairDevice("a");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "ble-ukey:pair-device", {
        deviceId: "a",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "ble-ukey:scan-devices", {
        timeout: undefined,
      });
      expect(store.devices[0].paired).toBe(true);
    });

    it("connect resolves connectedDevice from the local device list", async () => {
      const store = useBleUkeyStore();
      store.devices = [device("a"), device("b")];
      mockInvoke.mockResolvedValue({ success: true });
      await store.connect("b");
      expect(mockInvoke).toHaveBeenCalledWith("ble-ukey:connect", {
        deviceId: "b",
      });
      expect(store.connectedDevice?.id).toBe("b");
    });

    it("connect sets connectedDevice to null for an unknown device", async () => {
      const store = useBleUkeyStore();
      store.devices = [device("a")];
      mockInvoke.mockResolvedValue({ success: true });
      await store.connect("ghost");
      expect(store.connectedDevice).toBeNull();
    });

    it("disconnect clears connectedDevice on success", async () => {
      const store = useBleUkeyStore();
      store.connectedDevice = device("a");
      mockInvoke.mockResolvedValue({ success: true });
      await store.disconnect();
      expect(mockInvoke).toHaveBeenCalledWith("ble-ukey:disconnect");
      expect(store.connectedDevice).toBeNull();
    });
  });
});
