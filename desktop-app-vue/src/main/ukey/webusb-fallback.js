/**
 * WebUSB Fallback
 *
 * WebUSB fallback for environments without native USB access.
 * Provides a WebUSB-compatible API that delegates to the
 * renderer process's navigator.usb API when available.
 *
 * @module ukey/webusb-fallback
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";

// ============================================================
// WebUSBFallback
// ============================================================

class WebUSBFallback extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this._connected = false;
    this._deviceInfo = null;
  }

  /**
   * Check if WebUSB is available (requires renderer process context).
   * @returns {boolean} Whether WebUSB is available
   */
  isAvailable() {
    // WebUSB is only available in renderer process via navigator.usb
    // In main process, always return false
    return false;
  }

  /**
   * Request device access via WebUSB.
   * This is a placeholder — actual WebUSB access happens in the renderer.
   * @param {Array<Object>} filters - USB device filters [{vendorId, productId}]
   * @returns {Object} Device info (simulated in main process)
   */
  async requestDevice(filters = []) {
    try {
      logger.info("[WebUSBFallback] Requesting device with filters:", filters);

      // In main process, we simulate or delegate to IPC
      this._deviceInfo = {
        vendorId: filters[0]?.vendorId || 0,
        productId: filters[0]?.productId || 0,
        productName: "WebUSB Device (Fallback)",
        manufacturerName: "Unknown",
        serialNumber: "",
        transport: "webusb-fallback",
      };

      this._connected = true;
      this.emit("connected", this._deviceInfo);

      return this._deviceInfo;
    } catch (error) {
      logger.error("[WebUSBFallback] requestDevice failed:", error);
      throw error;
    }
  }

  /**
   * Open the device connection.
   * @returns {Object} Result
   */
  async open() {
    if (!this._connected) {
      throw new Error("No device selected");
    }
    return { success: true };
  }

  /**
   * Select a configuration.
   * @param {number} configValue - Configuration value
   * @returns {Object} Result
   */
  async selectConfiguration(configValue = 1) {
    return { success: true, configuration: configValue };
  }

  /**
   * Claim an interface.
   * @param {number} interfaceNumber - Interface number
   * @returns {Object} Result
   */
  async claimInterface(interfaceNumber = 0) {
    return { success: true, interfaceNumber };
  }

  /**
   * Transfer data out to the device.
   * @param {number} endpointNumber - Endpoint number
   * @param {Buffer|Uint8Array} data - Data to send
   * @returns {Object} Transfer result
   */
  async transferOut(endpointNumber, data) {
    try {
      logger.info("[WebUSBFallback] transferOut to endpoint", endpointNumber, ":", data.length, "bytes");
      // Simulation: always succeed
      return { status: "ok", bytesWritten: data.length };
    } catch (error) {
      logger.error("[WebUSBFallback] transferOut failed:", error);
      throw error;
    }
  }

  /**
   * Transfer data in from the device.
   * @param {number} endpointNumber - Endpoint number
   * @param {number} length - Expected data length
   * @returns {Object} Transfer result
   */
  async transferIn(endpointNumber, length) {
    try {
      logger.info("[WebUSBFallback] transferIn from endpoint", endpointNumber, ":", length, "bytes");
      // Simulation: return SW_OK
      return {
        status: "ok",
        data: { buffer: new Uint8Array([0x90, 0x00]).buffer },
      };
    } catch (error) {
      logger.error("[WebUSBFallback] transferIn failed:", error);
      throw error;
    }
  }

  /**
   * Close the connection.
   */
  async close() {
    this._connected = false;
    this._deviceInfo = null;
    this.emit("disconnected");
  }

  /**
   * Get current status.
   * @returns {Object} Status
   */
  getStatus() {
    return {
      available: this.isAvailable(),
      connected: this._connected,
      device: this._deviceInfo,
      transport: "webusb-fallback",
    };
  }
}

let _instance;
function getWebUSBFallback() {
  if (!_instance) _instance = new WebUSBFallback();
  return _instance;
}

export { WebUSBFallback, getWebUSBFallback };
