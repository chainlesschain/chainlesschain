"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppServerClient = exports.AppServerRpcError = void 0;
const node_events_1 = require("node:events");
const node_events_2 = require("node:events");
const node_child_process_1 = require("node:child_process");
const agent_session_js_1 = require("./agent-session.js");
const app_protocol_js_1 = require("./generated/app-protocol.js");
const ndjson_js_1 = require("./ndjson.js");
class AppServerRpcError extends Error {
    code;
    data;
    constructor(error) {
        super(error.message);
        this.name = "AppServerRpcError";
        this.code = error.code;
        this.data = error.data;
    }
}
exports.AppServerRpcError = AppServerRpcError;
const APP_SERVER_ERROR_CODE = Object.freeze({
    OVERLOADED: -32001,
    INTERRUPTED: -32010,
});
/**
 * Typed, bounded stdio client for `cc serve --app-server`.
 *
 * Consumers share the generated protocol contract and this transport instead
 * of maintaining their own argv, framing, approval, and timeout behavior.
 */
class AppServerClient extends node_events_1.EventEmitter {
    options;
    child = null;
    pending = new Map();
    nextRequestId = 0;
    closing = false;
    constructor(options = {}) {
        super();
        this.options = options;
    }
    get running() {
        return this.child !== null && !this.closing;
    }
    get pendingRequestCount() {
        return this.pending.size;
    }
    async start() {
        if (this.child)
            throw new Error("AppServerClient already started");
        const args = ["serve", "--app-server"];
        if (this.options.stateDirectory) {
            args.push("--app-server-state-dir", this.options.stateDirectory);
        }
        if (this.options.serverQueueCap != null) {
            args.push("--app-server-queue-cap", String(this.options.serverQueueCap));
        }
        const { command, args: fullArgs } = (0, agent_session_js_1.buildSpawnCommand)(this.options.cliPath || "cc", args);
        const env = {
            ...process.env,
            ...this.options.env,
        };
        if (process.platform === "win32") {
            env.NoDefaultCurrentDirectoryInExePath = "1";
        }
        const spawnOptions = {
            cwd: this.options.cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
        };
        this.child = (this.options.spawn ?? node_child_process_1.spawn)(command, fullArgs, spawnOptions);
        this.closing = false;
        const decode = (0, ndjson_js_1.createNdjsonDecoder)((message) => this.dispatch(message), {
            maxLineLength: this.options.maxLineLength,
            onError: (error) => this.fail(error),
        });
        this.child.stdout?.on("data", (chunk) => decode(chunk));
        this.child.stderr?.on("data", (chunk) => {
            this.emit("stderr", chunk.toString("utf8"));
        });
        this.child.on("error", (error) => this.fail(error));
        this.child.on("exit", (code) => {
            try {
                decode.flush();
            }
            catch (error) {
                this.fail(error);
            }
            const expected = this.closing;
            this.closing = true;
            this.rejectPending(new Error(expected
                ? "App Server connection closed"
                : `App Server exited unexpectedly (${code ?? "signal"})`));
            this.emit("exit", code);
        });
        return this.request("initialize", {
            protocolVersion: app_protocol_js_1.CC_AGENT_PROTOCOL_VERSION,
            minimumProtocolVersion: app_protocol_js_1.CC_AGENT_PROTOCOL_MIN_VERSION,
            client: {
                name: this.options.clientName || "chainlesschain-agent-sdk",
                version: this.options.clientVersion || "1",
            },
            features: this.options.features || [...app_protocol_js_1.CC_AGENT_PROTOCOL_FEATURES],
        });
    }
    async request(method, params = {}) {
        const child = this.child;
        if (!child || this.closing || !child.stdin) {
            throw new Error("AppServerClient is not running");
        }
        const limit = Math.max(1, this.options.maxPendingRequests ?? 256);
        if (this.pending.size >= limit) {
            const error = new AppServerRpcError({
                code: APP_SERVER_ERROR_CODE.OVERLOADED,
                message: "App Server client request queue is overloaded",
                data: { retry_after_ms: 100, max_pending_requests: limit },
            });
            this.emit("overloaded", error);
            throw error;
        }
        const id = String(++this.nextRequestId);
        const response = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new AppServerRpcError({
                    code: APP_SERVER_ERROR_CODE.INTERRUPTED,
                    message: `App Server request timed out: ${method}`,
                }));
            }, Math.max(1, this.options.requestTimeoutMs ?? 120_000));
            timer.unref?.();
            this.pending.set(id, { resolve, reject, timer });
        });
        try {
            await this.write({ jsonrpc: "2.0", id, method, params });
        }
        catch (error) {
            const pending = this.pending.get(id);
            if (pending) {
                clearTimeout(pending.timer);
                this.pending.delete(id);
                pending.reject(error);
            }
        }
        return response;
    }
    async close() {
        const child = this.child;
        if (!child || this.closing)
            return;
        this.closing = true;
        child.stdin?.end();
        if (child.exitCode == null && child.signalCode == null) {
            await Promise.race([
                (0, node_events_2.once)(child, "exit"),
                new Promise((resolve) => setTimeout(resolve, 5_000)),
            ]);
        }
        if (child.exitCode == null && child.signalCode == null)
            child.kill();
        this.rejectPending(new Error("App Server connection closed"));
        this.child = null;
    }
    async write(message) {
        const stdin = this.child?.stdin;
        if (!stdin || stdin.destroyed)
            throw new Error("App Server stdin is closed");
        if (!stdin.write((0, ndjson_js_1.encodeNdjson)(message), "utf8")) {
            await (0, node_events_2.once)(stdin, "drain");
        }
    }
    dispatch(value) {
        try {
            (0, app_protocol_js_1.assertProtocolMessage)(value);
        }
        catch (error) {
            this.fail(error);
            return;
        }
        const message = value;
        if (message.method && message.id != null) {
            void this.answerServerRequest(message);
            return;
        }
        if (message.method) {
            this.emit("notification", message);
            this.emit(message.method, message.params);
            return;
        }
        if (message.id == null)
            return;
        const id = String(message.id);
        const pending = this.pending.get(id);
        if (!pending)
            return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        if (message.error)
            pending.reject(new AppServerRpcError(message.error));
        else
            pending.resolve(message.result);
    }
    async answerServerRequest(request) {
        let result;
        try {
            if (this.options.onServerRequest) {
                result = await this.options.onServerRequest(request);
            }
            else {
                const decline = {
                    kind: "decline",
                    reason: "No App Server request handler is configured",
                };
                result = decline;
            }
            await this.write({ jsonrpc: "2.0", id: request.id, result });
        }
        catch (error) {
            await this.write({
                jsonrpc: "2.0",
                id: request.id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : "Client handler failed",
                },
            }).catch((writeError) => this.fail(writeError));
        }
    }
    fail(error) {
        this.emit("error", error);
    }
    rejectPending(error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
}
exports.AppServerClient = AppServerClient;
