/**
 * USBTransport Unit Tests
 * Target: src/main/ukey/usb-transport.js
 * Coverage: Initialization, simulation mode, device operations, constants
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// Mocks
// ============================================================

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// Mock 'usb' package as empty (not installed in test env)
// The source uses require('usb') inside try/catch so it gracefully falls back
vi.mock('usb', () => ({
  default: null,
  getDeviceList: vi.fn(() => []),
  findByIds: vi.fn(() => null)
}));

describe('USBTransport', () => {
  let USBTransport, TRANSPORT_STATUS;
  let transport;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import('../../../src/main/ukey/usb-transport.js');
    USBTransport = mod.USBTransport;
    TRANSPORT_STATUS = mod.TRANSPORT_STATUS;

    transport = new USBTransport();
  });

  afterEach(async () => {
    if (transport) await transport.close();
  });

  // ============================================================
  // Constructor
  // ============================================================

  describe('constructor', () => {
    it('should set default status to DISCONNECTED', () => {
      expect(transport.status).toBe(TRANSPORT_STATUS.DISCONNECTED);
    });

    it('should detect current platform', () => {
      expect(transport.platform).toBe(process.platform);
    });

    it('should initialize internal state to null', () => {
      expect(transport._device).toBeNull();
      expect(transport._interface).toBeNull();
      expect(transport._endpoint).toBeNull();
      expect(transport._usbLib).toBeNull();
    });

    it('should accept config object', () => {
      const t = new USBTransport({ vendorId: 0x1234 });
      expect(t.config.vendorId).toBe(0x1234);
    });
  });

  // ============================================================
  // initialize
  // ============================================================

  describe('initialize()', () => {
    it('should fall back to simulation when usb not available', async () => {
      const result = await transport.initialize();
      expect(result.success).toBe(true);
      expect(result.hasUSB).toBe(false);
      expect(transport._usbLib).toBeNull();
    });

    it('should set status to DISCONNECTED after init', async () => {
      await transport.initialize();
      expect(transport.status).toBe(TRANSPORT_STATUS.DISCONNECTED);
    });

    it('should return platform in result', async () => {
      const result = await transport.initialize();
      expect(result.platform).toBe(process.platform);
    });
  });

  // ============================================================
  // scanDevices
  // ============================================================

  describe('scanDevices()', () => {
    it('should return simulated device when no USB lib', async () => {
      await transport.initialize();
      const devices = await transport.scanDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0].transport).toBe('simulated');
      expect(devices[0].manufacturer).toBe('Simulated');
      expect(devices[0].product).toBe('Simulated U-Key');
      expect(devices[0].serialNumber).toBe('SIM-001');
    });
  });

  // ============================================================
  // open
  // ============================================================

  describe('open()', () => {
    it('should set connected and emit event in simulation mode', async () => {
      await transport.initialize();
      const spy = vi.fn();
      transport.on('connected', spy);

      const result = await transport.open(0x1234, 0x5678);
      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(transport.status).toBe(TRANSPORT_STATUS.CONNECTED);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        vendorId: 0x1234,
        productId: 0x5678,
        simulated: true
      }));
    });

    it('should set device to simulated object', async () => {
      await transport.initialize();
      await transport.open(0, 0);
      expect(transport._device).toEqual({ simulated: true });
    });
  });

  // ============================================================
  // transfer
  // ============================================================

  describe('transfer()', () => {
    it('should return SW_OK (0x9000) in simulation mode', async () => {
      await transport.initialize();
      await transport.open(0, 0);

      const data = Buffer.from([0x00, 0xA4, 0x04, 0x00]);
      const result = await transport.transfer(data);

      expect(result).toBeInstanceOf(Buffer);
      expect(result[0]).toBe(0x90);
      expect(result[1]).toBe(0x00);
    });

    it('should throw when not connected', async () => {
      await transport.initialize();
      // Don't call open()
      await expect(transport.transfer(Buffer.from([0x00]))).rejects.toThrow('Device not connected');
    });
  });

  // ============================================================
  // close
  // ============================================================

  describe('close()', () => {
    it('should reset state', async () => {
      await transport.initialize();
      await transport.open(0, 0);
      expect(transport.status).toBe(TRANSPORT_STATUS.CONNECTED);

      await transport.close();
      expect(transport.status).toBe(TRANSPORT_STATUS.DISCONNECTED);
      expect(transport._device).toBeNull();
      expect(transport._interface).toBeNull();
      expect(transport._endpoint).toBeNull();
    });

    it('should emit disconnected event', async () => {
      await transport.initialize();
      await transport.open(0, 0);

      const spy = vi.fn();
      transport.on('disconnected', spy);

      await transport.close();
      expect(spy).toHaveBeenCalled();
    });

    it('should be safe to call when already disconnected', async () => {
      await transport.close(); // should not throw
      expect(transport.status).toBe(TRANSPORT_STATUS.DISCONNECTED);
    });
  });

  // ============================================================
  // getStatus
  // ============================================================

  describe('getStatus()', () => {
    it('should return status object when disconnected', () => {
      const status = transport.getStatus();
      expect(status.status).toBe(TRANSPORT_STATUS.DISCONNECTED);
      expect(status.platform).toBe(process.platform);
      expect(status.hasUSB).toBe(false);
      expect(status.isConnected).toBe(false);
      expect(status.isSimulated).toBe(false);
    });

    it('should reflect connected state after open', async () => {
      await transport.initialize();
      await transport.open(0, 0);

      const status = transport.getStatus();
      expect(status.status).toBe(TRANSPORT_STATUS.CONNECTED);
      expect(status.isConnected).toBe(true);
      expect(status.isSimulated).toBe(true);
    });
  });

  // ============================================================
  // Constants
  // ============================================================

  describe('TRANSPORT_STATUS', () => {
    it('should have DISCONNECTED, CONNECTING, CONNECTED, ERROR', () => {
      expect(TRANSPORT_STATUS.DISCONNECTED).toBe('disconnected');
      expect(TRANSPORT_STATUS.CONNECTING).toBe('connecting');
      expect(TRANSPORT_STATUS.CONNECTED).toBe('connected');
      expect(TRANSPORT_STATUS.ERROR).toBe('error');
    });
  });
});
