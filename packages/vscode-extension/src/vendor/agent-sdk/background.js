"use strict";
/**
 * BackgroundSessionClient — attach to a running background agent.
 *
 * Speaks the NDJSON control protocol from
 * packages/cli/src/lib/background-session-transport.js over the local pipe
 * (Windows named pipe / POSIX domain socket). Auth is possession-based:
 * the token lives in the 0600 state file next to the pipe path, so any
 * same-user process may attach.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.backgroundAgentsDir = backgroundAgentsDir;
exports.readBackgroundAgentState = readBackgroundAgentState;
exports.attachBackgroundSession = attachBackgroundSession;
const node_net_1 = __importDefault(require("node:net"));
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const ndjson_js_1 = require("./ndjson.js");
function backgroundAgentsDir() {
    return (0, node_path_1.join)((0, node_os_1.homedir)(), ".chainlesschain", "background-agents");
}
/** Read a background agent's state file (`<dir>/<id>.json`). */
function readBackgroundAgentState(id, dir = backgroundAgentsDir()) {
    const raw = (0, node_fs_1.readFileSync)((0, node_path_1.join)(dir, `${id}.json`), "utf8");
    return JSON.parse(raw);
}
/**
 * Connect + authenticate. Resolves only after the server's hello ack, so a
 * resolved handle is immediately usable.
 */
function attachBackgroundSession(options) {
    let pipePath = options.pipePath;
    let token = options.token;
    if (!pipePath || !token) {
        if (!options.id) {
            return Promise.reject(new Error("attachBackgroundSession requires id, or pipePath + token"));
        }
        const state = readBackgroundAgentState(options.id, options.dir);
        pipePath = pipePath || state.transport?.pipe;
        token = token || state.transport?.token;
        if (!pipePath || !token) {
            return Promise.reject(new Error(`background agent ${options.id} has no interactive transport`));
        }
    }
    const timeoutMs = options.timeoutMs ?? 5000;
    return new Promise((resolve, reject) => {
        let settled = false;
        const socket = node_net_1.default.connect(pipePath);
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                socket.destroy();
                reject(new Error("session transport handshake timed out"));
            }
        }, timeoutMs);
        timer.unref?.();
        const write = (message) => {
            if (socket.destroyed)
                return false;
            try {
                return socket.write((0, ndjson_js_1.encodeNdjson)(message));
            }
            catch {
                return false;
            }
        };
        socket.on("data", (0, ndjson_js_1.createNdjsonDecoder)((message) => {
            if (!settled) {
                if (message.type === "hello") {
                    settled = true;
                    clearTimeout(timer);
                    resolve({
                        hello: message,
                        send: write,
                        prompt: (text) => write({ type: "prompt", text }),
                        requestStatus: () => write({ type: "status" }),
                        stopTurn: () => write({ type: "stop" }),
                        detach: () => {
                            write({ type: "detach" });
                            socket.end();
                        },
                    });
                }
                return;
            }
            try {
                options.onEvent?.(message);
            }
            catch {
                /* observer errors never kill the connection */
            }
        }));
        socket.on("connect", () => {
            write({ type: "hello", token: token });
        });
        socket.on("error", (error) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(error);
            }
        });
        socket.on("close", () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(new Error("session transport closed during handshake"));
            }
            else {
                try {
                    options.onClose?.();
                }
                catch {
                    /* observer errors are not connection errors */
                }
            }
        });
    });
}
