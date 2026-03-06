/**
 * useBleUkeyStore -- Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Getters: pairedDevices, isConnected
 *  - scanDevices()  -> ble-ukey:scan-devices
 *  - pairDevice()   -> ble-ukey:pair-device
 *  - connect()      -> ble-ukey:connect
 *  - disconnect()   -> ble-ukey:disconnect
 *  - Loading / scanning state toggling
 *  - Error handling for each action
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// vi.hoisted runs before imports -- set up electronAPI before store captures it
const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useBleUkeyStore } from '../../../src/renderer/stores/bleUkey';

const makeBLEDevice = (overrides: Partial<any> = {}) => ({
  id: 'dev-1',
  name: 'UKey-BLE',
  rssi: -50,
  distance: 1.2,
  paired: false,
  connected: false,
  lastSeen: Date.now(),
  ...overrides,
});

describe('useBleUkeyStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('devices starts as empty array', () => {
      const store = useBleUkeyStore();
      expect(store.devices).toEqual([]);
    });

    it('scanning starts as false', () => {
      const store = useBleUkeyStore();
      expect(store.scanning).toBe(false);
    });

    it('connectedDevice starts as null', () => {
      const store = useBleUkeyStore();
      expect(store.connectedDevice).toBeNull();
    });

    it('loading starts as false', () => {
      const store = useBleUkeyStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', () => {
      const store = useBleUkeyStore();
      expect(store.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  describe('Getters', () => {
    it('pairedDevices returns only paired devices', () => {
      const store = useBleUkeyStore();
      store.devices = [
        makeBLEDevice({ id: '1', paired: true }),
        makeBLEDevice({ id: '2', paired: false }),
        makeBLEDevice({ id: '3', paired: true }),
      ];
      expect(store.pairedDevices).toHaveLength(2);
      expect(store.pairedDevices.every(d => d.paired)).toBe(true);
    });

    it('pairedDevices returns empty array when no devices', () => {
      const store = useBleUkeyStore();
      expect(store.pairedDevices).toEqual([]);
    });

    it('isConnected returns false initially', () => {
      const store = useBleUkeyStore();
      expect(store.isConnected).toBe(false);
    });

    it('isConnected returns true when connectedDevice is set', () => {
      const store = useBleUkeyStore();
      store.connectedDevice = makeBLEDevice();
      expect(store.isConnected).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  describe('scanDevices', () => {
    it('calls IPC and sets devices on success', async () => {
      const store = useBleUkeyStore();
      const devices = [makeBLEDevice({ id: '1' }), makeBLEDevice({ id: '2' })];
      mockInvoke.mockResolvedValueOnce({ success: true, devices });

      const result = await store.scanDevices(5000);
      expect(mockInvoke).toHaveBeenCalledWith('ble-ukey:scan-devices', { timeout: 5000 });
      expect(result.success).toBe(true);
      expect(store.devices).toEqual(devices);
      expect(store.scanning).toBe(false);
    });

    it('toggles scanning during call', async () => {
      const store = useBleUkeyStore();
      expect(store.scanning).toBe(false);

      let scanningDuringCall = false;
      mockInvoke.mockImplementationOnce(() => {
        scanningDuringCall = store.scanning;
        return Promise.resolve({ success: true, devices: [] });
      });

      await store.scanDevices();
      expect(scanningDuringCall).toBe(true);
      expect(store.scanning).toBe(false);
    });

    it('sets error when result is not success', async () => {
      const store = useBleUkeyStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'BLE unavailable' });

      await store.scanDevices();
      expect(store.error).toBe('BLE unavailable');
      expect(store.devices).toEqual([]);
    });

    it('catches exceptions and sets error', async () => {
      const store = useBleUkeyStore();
      mockInvoke.mockRejectedValueOnce(new Error('Adapter off'));

      const result = await store.scanDevices();
      expect(store.error).toBe('Adapter off');
      expect(result).toEqual({ success: false, error: 'Adapter off' });
      expect(store.scanning).toBe(false);
    });
  });

  describe('pairDevice', () => {
    it('calls IPC and rescans on success', async () => {
      const store = useBleUkeyStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, devices: [makeBLEDevice({ id: '1', paired: true })] });

      const result = await store.pairDevice('dev-1');
      expect(mockInvoke).toHaveBeenCalledWith('ble-ukey:pair-device', { deviceId: 'dev-1' });
      expect(result.success).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const store = useBleUkeyStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Pairing rejected' });

      await store.pairDevice('dev-1');
      expect(store.error).toBe('Pairing rejected');
    });

    it('catches exceptions', async () => {
      const store = useBleUkeyStore();
      mockInvoke.mockRejectedValueOnce(new Error('PIN mismatch'));

      const result = await store.pairDevice('dev-1');
      expect(store.error).toBe('PIN mismatch');
      expect(result).toEqual({ success: false, error: 'PIN mismatch' });
      expect(store.loading).toBe(false);
    });
  });

  describe('connect', () => {
    it('calls IPC and sets connectedDevice on success', async () => {
      const store = useBleUkeyStore();
      const dev = makeBLEDevice({ id: 'dev-1' });
      store.devices = [dev];
      mockInvoke.mockResolvedValueOnce({ success: true });

      const result = await store.connect('dev-1');
      expect(mockInvoke).toHaveBeenCalledWith('ble-ukey:connect', { deviceId: 'dev-1' });
      expect(result.success).toBe(true);
      expect(store.connectedDevice).toEqual(dev);
      expect(store.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const store = useBleUkeyStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Connection timeout' });

      await store.connect('dev-1');
      expect(store.error).toBe('Connection timeout');
      expect(store.connectedDevice).toBeNull();
    });

    it('catches exceptions', async () => {
      const store = useBleUkeyStore();
      mockInvoke.mockRejectedValueOnce(new Error('BLE stack error'));

      const result = await store.connect('dev-1');
      expect(store.error).toBe('BLE stack error');
      expect(result).toEqual({ success: false, error: 'BLE stack error' });
      expect(store.loading).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('calls IPC and clears connectedDevice on success', async () => {
      const store = useBleUkeyStore();
      store.connectedDevice = makeBLEDevice();
      mockInvoke.mockResolvedValueOnce({ success: true });

      const result = await store.disconnect();
      expect(mockInvoke).toHaveBeenCalledWith('ble-ukey:disconnect');
      expect(result.success).toBe(true);
      expect(store.connectedDevice).toBeNull();
      expect(store.loading).toBe(false);
    });

    it('sets error on failure and keeps connectedDevice', async () => {
      const store = useBleUkeyStore();
      const dev = makeBLEDevice();
      store.connectedDevice = dev;
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Busy' });

      await store.disconnect();
      expect(store.error).toBe('Busy');
      // connectedDevice is NOT cleared on failure
      expect(store.connectedDevice).toEqual(dev);
    });

    it('catches exceptions', async () => {
      const store = useBleUkeyStore();
      store.connectedDevice = makeBLEDevice();
      mockInvoke.mockRejectedValueOnce(new Error('IPC fail'));

      const result = await store.disconnect();
      expect(store.error).toBe('IPC fail');
      expect(result).toEqual({ success: false, error: 'IPC fail' });
      expect(store.loading).toBe(false);
    });
  });
});
