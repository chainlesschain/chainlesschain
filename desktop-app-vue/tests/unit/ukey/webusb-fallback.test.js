/**
 * WebUSBFallback Unit Tests
 * Target: src/main/ukey/webusb-fallback.js
 * Coverage: Availability, device request, data transfer, close, singleton
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// Mocks
// ============================================================

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

describe('WebUSBFallback', () => {
  let WebUSBFallback, getWebUSBFallback;
  let fallback;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import('../../../src/main/ukey/webusb-fallback.js');
    WebUSBFallback = mod.WebUSBFallback;
    getWebUSBFallback = mod.getWebUSBFallback;

    fallback = new WebUSBFallback();
  });

  afterEach(async () => {
    if (fallback) await fallback.close();
  });

  // ============================================================
  // Constructor
  // ============================================================

  describe('constructor', () => {
    it('should initialize with disconnected state', () => {
      expect(fallback._connected).toBe(false);
      expect(fallback._deviceInfo).toBeNull();
    });

    it('should accept config object', () => {
      const f = new WebUSBFallback({ timeout: 3000 });
      expect(f.config.timeout).toBe(3000);
    });
  });

  // ============================================================
  // isAvailable
  // ============================================================

  describe('isAvailable()', () => {
    it('should return false in main process', () => {
      expect(fallback.isAvailable()).toBe(false);
    });
  });

  // ============================================================
  // requestDevice
  // ============================================================

  describe('requestDevice()', () => {
    it('should return simulated device info', async () => {
      const device = await fallback.requestDevice([{ vendorId: 0x1234, productId: 0x5678 }]);
      expect(device.vendorId).toBe(0x1234);
      expect(device.productId).toBe(0x5678);
      expect(device.transport).toBe('webusb-fallback');
      expect(device.productName).toBe('WebUSB Device (Fallback)');
    });

    it('should emit connected event', async () => {
      const spy = vi.fn();
      fallback.on('connected', spy);

      await fallback.requestDevice([]);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ transport: 'webusb-fallback' }));
    });

    it('should set _connected to true', async () => {
      await fallback.requestDevice([]);
      expect(fallback._connected).toBe(true);
    });

    it('should use defaults when no filters provided', async () => {
      const device = await fallback.requestDevice([]);
      expect(device.vendorId).toBe(0);
      expect(device.productId).toBe(0);
    });
  });

  // ============================================================
  // open
  // ============================================================

  describe('open()', () => {
    it('should throw when no device selected', async () => {
      await expect(fallback.open()).rejects.toThrow('No device selected');
    });

    it('should succeed after requestDevice', async () => {
      await fallback.requestDevice([]);
      const result = await fallback.open();
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // selectConfiguration
  // ============================================================

  describe('selectConfiguration()', () => {
    it('should return success with configuration value', async () => {
      const result = await fallback.selectConfiguration(1);
      expect(result.success).toBe(true);
      expect(result.configuration).toBe(1);
    });

    it('should accept custom configuration value', async () => {
      const result = await fallback.selectConfiguration(2);
      expect(result.configuration).toBe(2);
    });
  });

  // ============================================================
  // claimInterface
  // ============================================================

  describe('claimInterface()', () => {
    it('should return success with interface number', async () => {
      const result = await fallback.claimInterface(0);
      expect(result.success).toBe(true);
      expect(result.interfaceNumber).toBe(0);
    });

    it('should accept custom interface number', async () => {
      const result = await fallback.claimInterface(3);
      expect(result.interfaceNumber).toBe(3);
    });
  });

  // ============================================================
  // transferOut
  // ============================================================

  describe('transferOut()', () => {
    it('should return ok status with bytes written', async () => {
      const data = Buffer.from([0x00, 0xA4, 0x04, 0x00]);
      const result = await fallback.transferOut(1, data);
      expect(result.status).toBe('ok');
      expect(result.bytesWritten).toBe(4);
    });
  });

  // ============================================================
  // transferIn
  // ============================================================

  describe('transferIn()', () => {
    it('should return SW_OK (0x9000)', async () => {
      const result = await fallback.transferIn(1, 2);
      expect(result.status).toBe('ok');
      expect(result.data).toBeDefined();
      expect(result.data.buffer).toBeDefined();

      const bytes = new Uint8Array(result.data.buffer);
      expect(bytes[0]).toBe(0x90);
      expect(bytes[1]).toBe(0x00);
    });
  });

  // ============================================================
  // close
  // ============================================================

  describe('close()', () => {
    it('should reset state and emit disconnected', async () => {
      await fallback.requestDevice([]);
      expect(fallback._connected).toBe(true);

      const spy = vi.fn();
      fallback.on('disconnected', spy);

      await fallback.close();
      expect(fallback._connected).toBe(false);
      expect(fallback._deviceInfo).toBeNull();
      expect(spy).toHaveBeenCalled();
    });

    it('should be safe to call when already closed', async () => {
      await fallback.close(); // should not throw
      expect(fallback._connected).toBe(false);
    });
  });

  // ============================================================
  // getStatus
  // ============================================================

  describe('getStatus()', () => {
    it('should return status when disconnected', () => {
      const status = fallback.getStatus();
      expect(status.available).toBe(false);
      expect(status.connected).toBe(false);
      expect(status.device).toBeNull();
      expect(status.transport).toBe('webusb-fallback');
    });

    it('should reflect connected state', async () => {
      await fallback.requestDevice([{ vendorId: 0x1234 }]);
      const status = fallback.getStatus();
      expect(status.connected).toBe(true);
      expect(status.device).toBeDefined();
      expect(status.device.vendorId).toBe(0x1234);
    });
  });

  // ============================================================
  // Singleton
  // ============================================================

  describe('getWebUSBFallback()', () => {
    it('should return the same instance', () => {
      const a = getWebUSBFallback();
      const b = getWebUSBFallback();
      expect(a).toBe(b);
    });

    it('should return a WebUSBFallback instance', () => {
      const instance = getWebUSBFallback();
      expect(instance).toBeInstanceOf(WebUSBFallback);
    });
  });
});
