const EventEmitter = require("events");
const fs = require("fs");

const OFFICIAL_PACKAGE_NAME = "@signalapp/libsignal-client";

const _deps = {
  importOfficialLibrary: () => import(OFFICIAL_PACKAGE_NAME),
  resolveOfficialPackageJson: () =>
    require.resolve(`${OFFICIAL_PACKAGE_NAME}/package.json`),
  readPackageJson: async (packageJsonPath) => {
    const content = await fs.promises.readFile(packageJsonPath, "utf8");
    return JSON.parse(content);
  },
  platform: () => process.platform,
  arch: () => process.arch,
  versions: () => ({ ...process.versions }),
};

function createBaseDiagnostics() {
  return {
    driver: "official",
    packageName: OFFICIAL_PACKAGE_NAME,
    status: "unknown",
    packageInstalled: false,
    packageVersion: null,
    packageJsonPath: null,
    exportKeys: [],
    recommendedDriver: "legacy",
    runtime: {
      platform: _deps.platform(),
      arch: _deps.arch(),
      versions: _deps.versions(),
    },
    errors: [],
  };
}

function createMissingDependencyError() {
  return new Error(
    "Official Signal driver requires @signalapp/libsignal-client. The package is not installed in this workspace. Keep config.signal.driver='legacy'.",
  );
}

function createLoadFailureError(reason) {
  return new Error(
    `Official Signal driver probe failed to load @signalapp/libsignal-client: ${reason}. Keep config.signal.driver='legacy'.`,
  );
}

function createAdapterNotImplementedError() {
  return new Error(
    "Official Signal driver POC can load @signalapp/libsignal-client, but the protocol adapter is not implemented yet. Keep config.signal.driver='legacy'.",
  );
}

class OfficialSignalDriver extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.deps = config._deps || _deps;
    this.store = null;
    this.identityKeyPair = null;
    this.registrationId = null;
    this.preKeys = new Map();
    this.signedPreKey = null;
    this.sessions = new Map();
    this.initialized = false;
    this.library = null;
    this.diagnostics = {
      ...createBaseDiagnostics(),
      runtime: {
        platform: this.deps.platform(),
        arch: this.deps.arch(),
        versions: this.deps.versions(),
      },
    };
  }

  async probeSupport() {
    const diagnostics = {
      ...this.diagnostics,
      exportKeys: [],
      errors: [],
      runtime: {
        platform: this.deps.platform(),
        arch: this.deps.arch(),
        versions: this.deps.versions(),
      },
    };

    let packageJsonPath;
    try {
      packageJsonPath = this.deps.resolveOfficialPackageJson();
      diagnostics.packageInstalled = true;
      diagnostics.packageJsonPath = packageJsonPath;
    } catch (error) {
      diagnostics.status = "missing_dependency";
      diagnostics.errors.push(error.message);
      this.diagnostics = diagnostics;
      return diagnostics;
    }

    try {
      const packageJson = await this.deps.readPackageJson(packageJsonPath);
      diagnostics.packageVersion = packageJson.version || null;
    } catch (error) {
      diagnostics.errors.push(`package.json read failed: ${error.message}`);
    }

    try {
      const officialLibrary = await this.deps.importOfficialLibrary();
      diagnostics.status = "package_loaded";
      diagnostics.exportKeys = Object.keys(officialLibrary || {}).sort();
      this.library = officialLibrary;
      this.diagnostics = diagnostics;
      return diagnostics;
    } catch (error) {
      diagnostics.status = "load_error";
      diagnostics.errors.push(error.message);
      this.diagnostics = diagnostics;
      return diagnostics;
    }
  }

  getDiagnostics() {
    return {
      ...this.diagnostics,
      exportKeys: [...this.diagnostics.exportKeys],
      errors: [...this.diagnostics.errors],
      runtime: {
        ...this.diagnostics.runtime,
        versions: { ...this.diagnostics.runtime.versions },
      },
    };
  }

  async loadSignalLibrary() {
    const diagnostics = await this.probeSupport();

    if (diagnostics.status === "missing_dependency") {
      throw createMissingDependencyError();
    }

    if (diagnostics.status === "load_error") {
      throw createLoadFailureError(diagnostics.errors[0] || "unknown error");
    }

    return this.library;
  }

  async initialize() {
    await this.loadSignalLibrary();
    throw createAdapterNotImplementedError();
  }

  async loadOrGenerateIdentity() {
    throw createAdapterNotImplementedError();
  }

  async generateIdentity() {
    throw createAdapterNotImplementedError();
  }

  async generatePreKeys() {
    throw createAdapterNotImplementedError();
  }

  async getPreKeyBundle() {
    throw createAdapterNotImplementedError();
  }

  async processPreKeyBundle() {
    throw createAdapterNotImplementedError();
  }

  ensureArrayBuffer(data) {
    return data;
  }

  async encryptMessage() {
    throw createAdapterNotImplementedError();
  }

  async decryptMessage() {
    throw createAdapterNotImplementedError();
  }

  async hasSession() {
    throw createAdapterNotImplementedError();
  }

  async deleteSession() {
    throw createAdapterNotImplementedError();
  }

  async getSessions() {
    throw createAdapterNotImplementedError();
  }

  arrayBufferFromObject(obj) {
    return obj;
  }

  toUint8Array(data) {
    return data;
  }

  async close() {
    this.initialized = false;
    this.library = null;
    this.sessions.clear();
    this.preKeys.clear();
    this.emit("closed");
  }
}

module.exports = OfficialSignalDriver;
module.exports._deps = _deps;
