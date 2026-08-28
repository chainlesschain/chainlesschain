const { EventEmitter } = require("events");
const { AppServerPilotClient } = require("../../vendor/agent-sdk/index.js");
const {
  spawnWithDesktopBroker,
} = require("../../process/desktop-process-broker.js");

const MAX_PARAMS_BYTES = 256 * 1024;

function normalizeParams(value) {
  const params = value == null ? {} : value;
  const prototype =
    typeof params === "object" && params !== null
      ? Object.getPrototypeOf(params)
      : null;
  if (
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw new TypeError("App Server pilot parameters must be an object");
  }
  const serialized = JSON.stringify(params);
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized) > MAX_PARAMS_BYTES
  ) {
    throw new RangeError("App Server pilot parameters exceed 256 KiB");
  }
  return JSON.parse(serialized);
}

/**
 * Feature-gated Desktop host for the shared Agent SDK App Server client.
 *
 * Every process goes through the Desktop broker and the renderer-facing layer
 * exposes fixed Thread/Turn methods only. Approval server requests retain the
 * SDK's default fail-closed response until a reviewed Desktop UI is wired.
 */
class DesktopAppServerPilot extends EventEmitter {
  constructor(options = {}) {
    super();
    const ClientClass = options.ClientClass || AppServerPilotClient;
    const spawnProcess = options.spawnProcess || spawnWithDesktopBroker;
    this.client =
      options.client ||
      new ClientClass({
        cliPath: options.cliPath,
        cwd: options.cwd,
        stateDirectory: options.stateDirectory,
        serverQueueCap: options.serverQueueCap ?? 256,
        maxPendingRequests: options.maxPendingRequests ?? 128,
        requestTimeoutMs: options.requestTimeoutMs ?? 120_000,
        clientName: "chainlesschain-desktop-app-server-pilot",
        clientVersion: options.clientVersion || "1",
        spawn: (command, args, spawnOptions = {}) =>
          spawnProcess(command, args, {
            ...spawnOptions,
            windowsHide: true,
            shell: false,
            origin: "desktop:coding-agent-app-server-pilot",
            provenance: {
              component: "coding-agent-app-server-pilot",
            },
          }),
      });

    this.on("error", () => {});
    for (const eventName of [
      "ready",
      "notification",
      "stderr",
      "overloaded",
      "exit",
      "error",
    ]) {
      this.client.on(eventName, (payload) => this.emit(eventName, payload));
    }
  }

  get status() {
    return {
      enabled: true,
      surface: "desktop",
      ...this.client.status,
    };
  }

  start() {
    return this.client.start();
  }

  close() {
    return this.client.close();
  }

  threadStart(params = {}) {
    return this.client.threadStart(normalizeParams(params));
  }

  threadResume(params) {
    return this.client.threadResume(normalizeParams(params));
  }

  threadFork(params) {
    return this.client.threadFork(normalizeParams(params));
  }

  threadRead(params) {
    return this.client.threadRead(normalizeParams(params));
  }

  threadList(params = {}) {
    return this.client.threadList(normalizeParams(params));
  }

  threadArchive(params) {
    return this.client.threadArchive(normalizeParams(params));
  }

  turnStart(params) {
    return this.client.turnStart(normalizeParams(params));
  }

  turnInterrupt(params) {
    return this.client.turnInterrupt(normalizeParams(params));
  }

  graphCompile(params) {
    return this.client.graphCompile(normalizeParams(params));
  }

  graphRun(params) {
    return this.client.graphRun(normalizeParams(params));
  }

  graphStatus(params) {
    return this.client.graphStatus(normalizeParams(params));
  }

  graphHistory(params) {
    return this.client.graphHistory(normalizeParams(params));
  }

  graphCancel(params) {
    return this.client.graphCancel(normalizeParams(params));
  }

  graphReconcile(params) {
    return this.client.graphReconcile(normalizeParams(params));
  }
}

module.exports = {
  DesktopAppServerPilot,
  MAX_PARAMS_BYTES,
  normalizeParams,
};
