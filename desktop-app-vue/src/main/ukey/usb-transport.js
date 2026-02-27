/**
 * USB Transport
 *
 * Cross-platform USB communication layer using node-usb/libusb.
 * Replaces Windows-only Koffi FFI with cross-platform USB access.
 *
 * @module ukey/usb-transport
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";

// ============================================================
// Constants
// ============================================================

const TRANSPORT_STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
};

// Platform-specific transport selection (for future use)
// const PLATFORM_TRANSPORTS = {
//   WIN32: "koffi",
//   DARWIN: "usb",
//   LINUX: "usb",
// };

// ============================================================
// USBTransport
// ============================================================

class USBTransport extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.status = TRANSPORT_STATUS.DISCONNECTED;
    this.platform = process.platform;
    this._device = null;
    this._interface = null;
    this._endpoint = null;
    this._usbLib = null;
  }

  /**
   * Initialize USB transport.
   * @returns {Object} Init result
   */
  async initialize() {
    logger.info("[USBTransport] Initializing USB transport for platform:", this.platform);

    try {
      // Try to load node-usb
      try {
        this._usbLib = (await import("usb")).default;
        logger.info("[USBTransport] node-usb library loaded successfully");
      } catch {
        logger.warn("[USBTransport] node-usb not available, falling back to simulation mode");
        this._usbLib = null;
      }

      this.status = TRANSPORT_STATUS.DISCONNECTED;
      return { success: true, platform: this.platform, hasUSB: !!this._usbLib };
    } catch (error) {
      logger.error("[USBTransport] Initialization failed:", error);
      this.status = TRANSPORT_STATUS.ERROR;
      throw error;
    }
  }

  /**
   * Scan for connected USB devices matching known VID/PID pairs.
   * @param {Array<Object>} [knownDevices] - Known VID/PID pairs
   * @returns {Array} Found devices
   */
  async scanDevices(knownDevices = []) {
    try {
      if (!this._usbLib) {
        // Simulation mode
        return [{
          vendorId: "0000",
          productId: "0000",
          manufacturer: "Simulated",
          product: "Simulated U-Key",
          serialNumber: "SIM-001",
          transport: "simulated",
        }];
      }

      const devices = this._usbLib.getDeviceList();
      const results = [];

      for (const device of devices) {
        const desc = device.deviceDescriptor;
        const vidPid = `${desc.idVendor.toString(16).padStart(4, "0")}:${desc.idProduct.toString(16).padStart(4, "0")}`;

        const known = knownDevices.find((d) => d.vidPid === vidPid);
        if (known || knownDevices.length === 0) {
          let manufacturer = "";
          let product = "";

          try {
            device.open();
            manufacturer = await this._getStringDescriptor(device, desc.iManufacturer);
            product = await this._getStringDescriptor(device, desc.iProduct);
            device.close();
          } catch {
            // Can't read descriptors from all devices
          }

          results.push({
            vendorId: desc.idVendor.toString(16).padStart(4, "0"),
            productId: desc.idProduct.toString(16).padStart(4, "0"),
            vidPid,
            manufacturer,
            product,
            driverName: known?.driverName || "unknown",
            transport: "usb",
          });
        }
      }

      return results;
    } catch (error) {
      logger.error("[USBTransport] Device scan failed:", error);
      return [];
    }
  }

  /**
   * Open a connection to a specific USB device.
   * @param {number} vendorId - Vendor ID
   * @param {number} productId - Product ID
   * @returns {Object} Connection result
   */
  async open(vendorId, productId) {
    try {
      this.status = TRANSPORT_STATUS.CONNECTING;

      if (!this._usbLib) {
        // Simulation mode
        this.status = TRANSPORT_STATUS.CONNECTED;
        this._device = { simulated: true };
        this.emit("connected", { vendorId, productId, simulated: true });
        return { success: true, simulated: true };
      }

      const device = this._usbLib.findByIds(vendorId, productId);
      if (!device) {
        this.status = TRANSPORT_STATUS.DISCONNECTED;
        throw new Error(`Device not found: ${vendorId}:${productId}`);
      }

      device.open();
      const iface = device.interface(0);

      // Detach kernel driver on Linux
      if (this.platform === "linux" && iface.isKernelDriverActive()) {
        iface.detachKernelDriver();
      }

      iface.claim();
      this._device = device;
      this._interface = iface;

      // Find bulk endpoints
      for (const endpoint of iface.endpoints) {
        if (endpoint.direction === "in") {
          this._endpoint = endpoint;
        }
      }

      this.status = TRANSPORT_STATUS.CONNECTED;
      this.emit("connected", { vendorId, productId });
      return { success: true };
    } catch (error) {
      this.status = TRANSPORT_STATUS.ERROR;
      logger.error("[USBTransport] Open failed:", error);
      throw error;
    }
  }

  /**
   * Send data to the USB device and receive response.
   * @param {Buffer} data - Data to send
   * @returns {Buffer} Response data
   */
  async transfer(data) {
    try {
      if (this.status !== TRANSPORT_STATUS.CONNECTED) {
        throw new Error("Device not connected");
      }

      if (!this._usbLib || (this._device && this._device.simulated)) {
        // Simulation: echo back
        return Buffer.from([0x90, 0x00]); // SW_OK
      }

      // Control transfer
      return new Promise((resolve, reject) => {
        this._device.controlTransfer(
          0x21, // bmRequestType: host-to-device, class, interface
          0x09, // bRequest: SET_REPORT
          0x0300, // wValue
          0, // wIndex
          data,
          (error, result) => {
            if (error) return reject(error);
            resolve(result || Buffer.from([0x90, 0x00]));
          },
        );
      });
    } catch (error) {
      logger.error("[USBTransport] Transfer failed:", error);
      throw error;
    }
  }

  /**
   * Close the USB connection.
   */
  async close() {
    try {
      if (this._interface) {
        this._interface.release(true, () => {});
        this._interface = null;
      }
      if (this._device && !this._device.simulated) {
        this._device.close();
      }
      this._device = null;
      this._endpoint = null;
      this.status = TRANSPORT_STATUS.DISCONNECTED;
      this.emit("disconnected");
    } catch (error) {
      logger.warn("[USBTransport] Close warning:", error.message);
    }
  }

  /**
   * Get current transport status.
   * @returns {Object} Status info
   */
  getStatus() {
    return {
      status: this.status,
      platform: this.platform,
      hasUSB: !!this._usbLib,
      isConnected: this.status === TRANSPORT_STATUS.CONNECTED,
      isSimulated: this._device?.simulated || false,
    };
  }

  _getStringDescriptor(device, index) {
    return new Promise((resolve) => {
      if (!index) return resolve("");
      device.getStringDescriptor(index, (error, value) => {
        resolve(error ? "" : value || "");
      });
    });
  }
}

let _instance;
function getUSBTransport() {
  if (!_instance) _instance = new USBTransport();
  return _instance;
}

export { USBTransport, getUSBTransport, TRANSPORT_STATUS };
