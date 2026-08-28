"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppServerPilotClient = void 0;
const node_events_1 = require("node:events");
const app_server_client_js_1 = require("./app-server-client.js");
/**
 * Capability-shaped App Server client for product pilots.
 *
 * Unlike AppServerClient, this class deliberately has no generic request()
 * surface. Desktop and IDE hosts can expose these fixed operations without
 * turning a compromised renderer/Webview into an arbitrary local RPC client.
 */
class AppServerPilotClient extends node_events_1.EventEmitter {
    transport;
    startPromise = null;
    capabilities = null;
    lastError = null;
    constructor(options = {}) {
        super();
        const { transport, ...clientOptions } = options;
        this.transport =
            transport ??
                new app_server_client_js_1.AppServerClient(clientOptions);
        // Keep transport failures observable without allowing an unhandled
        // EventEmitter "error" to terminate the Desktop/Extension host.
        this.on("error", () => { });
        this.transport.on("error", (error) => {
            this.lastError = error?.message || String(error);
            this.emit("error", error);
        });
        this.transport.on("stderr", (message) => this.emit("stderr", message));
        this.transport.on("overloaded", (error) => this.emit("overloaded", error));
        this.transport.on("exit", (code) => this.emit("exit", code));
        this.transport.on("notification", (notification) => {
            this.emit("notification", notification);
            this.emit(notification.method, notification.params);
        });
    }
    get status() {
        return {
            running: this.transport.running,
            initialized: this.capabilities !== null,
            pendingRequestCount: this.transport.pendingRequestCount,
            capabilities: this.capabilities,
            lastError: this.lastError,
        };
    }
    async start() {
        if (this.capabilities !== null && this.transport.running) {
            return this.capabilities;
        }
        if (this.startPromise)
            return this.startPromise;
        this.startPromise = this.transport
            .start()
            .then((capabilities) => {
            this.capabilities = capabilities;
            this.lastError = null;
            this.emit("ready", capabilities);
            return capabilities;
        })
            .catch(async (error) => {
            this.lastError = error instanceof Error ? error.message : String(error);
            this.capabilities = null;
            await this.transport.close().catch(() => { });
            throw error;
        })
            .finally(() => {
            this.startPromise = null;
        });
        return this.startPromise;
    }
    async close() {
        await this.transport.close();
        this.capabilities = null;
    }
    threadStart(params = {}) {
        return this.call("thread/start", params);
    }
    threadResume(params) {
        return this.call("thread/resume", params);
    }
    threadFork(params) {
        return this.call("thread/fork", params);
    }
    threadRead(params) {
        return this.call("thread/read", params);
    }
    threadList(params = {}) {
        return this.call("thread/list", params);
    }
    threadArchive(params) {
        return this.call("thread/archive", params);
    }
    turnStart(params) {
        return this.call("turn/start", params);
    }
    turnInterrupt(params) {
        return this.call("turn/interrupt", params);
    }
    graphCompile(params) {
        return this.call("graph/compile", params);
    }
    graphRun(params) {
        return this.call("graph/run", params);
    }
    graphStatus(params) {
        return this.call("graph/status", params);
    }
    graphCancel(params) {
        return this.call("graph/cancel", params);
    }
    graphReconcile(params) {
        return this.call("graph/reconcile", params);
    }
    async call(method, params) {
        await this.start();
        return this.transport.request(method, params);
    }
}
exports.AppServerPilotClient = AppServerPilotClient;
