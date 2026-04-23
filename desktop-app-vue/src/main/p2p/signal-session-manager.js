const EventEmitter = require("events");

const DRIVER_EVENTS = ["initialized", "session:created", "session:deleted", "closed"];

function resolveDriverName(config = {}) {
  return config.signal?.driver || config.driver || "legacy";
}

async function createDriver(driverName, config) {
  switch (driverName) {
    case "legacy": {
      const module = await import("./signal-driver-legacy.js");
      const LegacySignalDriver = module.default || module;
      return new LegacySignalDriver(config);
    }
    case "official": {
      const module = await import("./signal-driver-official.js");
      const OfficialSignalDriver = module.default || module;
      return new OfficialSignalDriver(config);
    }
    default:
      throw new Error(`Unsupported Signal driver: ${driverName}`);
  }
}

class SignalSessionManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      userId: config.userId || "default-user",
      deviceId: config.deviceId || 1,
      dataPath: config.dataPath || null,
      ...config,
      signal: {
        ...(config.signal || {}),
        driver: resolveDriverName(config),
      },
    };

    this.driverName = this.config.signal.driver;
    this.driver = null;
    this.driverPromise = null;
  }

  async ensureDriver() {
    if (this.driver) {
      return this.driver;
    }
    if (this.driverPromise) {
      return this.driverPromise;
    }

    this.driverPromise = createDriver(this.driverName, this.config)
      .then((driver) => {
        this.driver = driver;
        this.bridgeDriverEvents(driver);
        return driver;
      })
      .finally(() => {
        this.driverPromise = null;
      });

    return this.driverPromise;
  }

  bridgeDriverEvents(driver) {
    for (const eventName of DRIVER_EVENTS) {
      driver.on(eventName, (payload) => this.emit(eventName, payload));
    }
  }

  get store() {
    return this.driver?.store || null;
  }

  get identityKeyPair() {
    return this.driver?.identityKeyPair || null;
  }

  get registrationId() {
    return this.driver?.registrationId || null;
  }

  get preKeys() {
    return this.driver?.preKeys || new Map();
  }

  get signedPreKey() {
    return this.driver?.signedPreKey || null;
  }

  get sessions() {
    return this.driver?.sessions || new Map();
  }

  get initialized() {
    return this.driver?.initialized || false;
  }

  async initialize() {
    return (await this.ensureDriver()).initialize();
  }

  async loadSignalLibrary() {
    return (await this.ensureDriver()).loadSignalLibrary();
  }

  async loadOrGenerateIdentity() {
    return (await this.ensureDriver()).loadOrGenerateIdentity();
  }

  async generateIdentity() {
    return (await this.ensureDriver()).generateIdentity();
  }

  async generatePreKeys() {
    return (await this.ensureDriver()).generatePreKeys();
  }

  async getPreKeyBundle() {
    return (await this.ensureDriver()).getPreKeyBundle();
  }

  async processPreKeyBundle(recipientId, deviceId, preKeyBundle) {
    return (await this.ensureDriver()).processPreKeyBundle(
      recipientId,
      deviceId,
      preKeyBundle,
    );
  }

  ensureArrayBuffer(data) {
    if (data instanceof ArrayBuffer) {
      return data;
    }
    return this.arrayBufferFromObject(data);
  }

  async encryptMessage(recipientId, deviceId, plaintext) {
    return (await this.ensureDriver()).encryptMessage(
      recipientId,
      deviceId,
      plaintext,
    );
  }

  async decryptMessage(senderId, deviceId, ciphertext) {
    return (await this.ensureDriver()).decryptMessage(
      senderId,
      deviceId,
      ciphertext,
    );
  }

  async hasSession(recipientId, deviceId) {
    return (await this.ensureDriver()).hasSession(recipientId, deviceId);
  }

  async deleteSession(recipientId, deviceId) {
    return (await this.ensureDriver()).deleteSession(recipientId, deviceId);
  }

  async getSessions() {
    return (await this.ensureDriver()).getSessions();
  }

  arrayBufferFromObject(obj) {
    if (!obj) {
      return new ArrayBuffer(0);
    }
    if (obj instanceof ArrayBuffer) {
      return obj;
    }
    if (obj instanceof Uint8Array) {
      const buffer = new ArrayBuffer(obj.length);
      new Uint8Array(buffer).set(obj);
      return buffer;
    }
    if (Buffer.isBuffer(obj)) {
      const buffer = new ArrayBuffer(obj.length);
      new Uint8Array(buffer).set(obj);
      return buffer;
    }
    if (ArrayBuffer.isView(obj)) {
      const buffer = new ArrayBuffer(obj.byteLength);
      new Uint8Array(buffer).set(
        new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength),
      );
      return buffer;
    }

    let array;
    if (obj.type === "Buffer" && Array.isArray(obj.data)) {
      array = obj.data;
    } else if (Array.isArray(obj)) {
      array = obj;
    } else if (typeof obj === "object" && obj !== null) {
      if (typeof obj.length === "number") {
        array = Array.from({ length: obj.length }, (_, i) => obj[i] || 0);
      } else {
        return new ArrayBuffer(0);
      }
    } else {
      return new ArrayBuffer(0);
    }

    const buffer = new ArrayBuffer(array.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < array.length; i++) {
      view[i] = array[i];
    }
    return buffer;
  }

  toUint8Array(data) {
    if (data instanceof Uint8Array) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (Buffer.isBuffer(data)) {
      return new Uint8Array(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return new Uint8Array(this.arrayBufferFromObject(data));
  }

  async close() {
    if (!this.driver) {
      return undefined;
    }

    const result = await this.driver.close();
    this.driver = null;
    return result;
  }
}

module.exports = SignalSessionManager;
module.exports._deps = {};
