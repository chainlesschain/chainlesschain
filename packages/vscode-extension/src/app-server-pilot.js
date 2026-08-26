"use strict";

const { EventEmitter } = require("node:events");
const { AppServerPilotClient } = require("./vendor/agent-sdk/index.js");

/**
 * VS Code host adapter for the shared, fixed-capability App Server client.
 * The extension entry point owns the feature flag and user interaction; this
 * class remains VS Code-free so its process and protocol behavior is testable.
 */
class IdeAppServerPilot extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.ClientClass = options.ClientClass || AppServerPilotClient;
    this.client = options.client || null;
    this.lastThreadId = null;
    this.lastTurnId = null;
    this.on("error", () => {});
    if (this.client) this._attach(this.client);
  }

  get status() {
    return {
      enabled: true,
      surface: "vscode",
      lastThreadId: this.lastThreadId,
      lastTurnId: this.lastTurnId,
      ...(this.client?.status || {
        running: false,
        initialized: false,
        pendingRequestCount: 0,
        capabilities: null,
        lastError: null,
      }),
    };
  }

  _getClient() {
    if (this.client) return this.client;
    const cliPath = this.options.getCliPath?.() || this.options.cliPath || "cc";
    const cwd = this.options.getCwd?.() || this.options.cwd;
    this.client = new this.ClientClass({
      cliPath,
      cwd,
      stateDirectory: this.options.stateDirectory,
      serverQueueCap: this.options.serverQueueCap ?? 256,
      maxPendingRequests: this.options.maxPendingRequests ?? 128,
      requestTimeoutMs: this.options.requestTimeoutMs ?? 120_000,
      clientName: "chainlesschain-vscode-app-server-pilot",
      clientVersion: this.options.clientVersion || "1",
    });
    this._attach(this.client);
    return this.client;
  }

  _attach(client) {
    for (const eventName of [
      "ready",
      "notification",
      "stderr",
      "overloaded",
      "exit",
      "error",
    ]) {
      client.on(eventName, (payload) => this.emit(eventName, payload));
    }
  }

  start() {
    return this._getClient().start();
  }

  async close() {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
    this.lastThreadId = null;
    this.lastTurnId = null;
  }

  async threadStart(params = {}) {
    const result = await this._getClient().threadStart(params);
    this.lastThreadId = result?.thread?.id || this.lastThreadId;
    return result;
  }

  threadResume(params) {
    return this._getClient().threadResume(params);
  }

  threadFork(params) {
    return this._getClient().threadFork(params);
  }

  threadRead(params) {
    return this._getClient().threadRead(params);
  }

  threadList(params = {}) {
    return this._getClient().threadList(params);
  }

  threadArchive(params) {
    return this._getClient().threadArchive(params);
  }

  async turnStart(params) {
    const result = await this._getClient().turnStart(params);
    this.lastThreadId = result?.turn?.threadId || params?.threadId || null;
    this.lastTurnId = result?.turn?.id || this.lastTurnId;
    return result;
  }

  turnInterrupt(params) {
    return this._getClient().turnInterrupt(params);
  }
}

module.exports = { IdeAppServerPilot };
