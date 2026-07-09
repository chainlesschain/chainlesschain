"use strict";
/**
 * One-shot `cc <cmd> --json` helpers — session listing/resume metadata and
 * workspace checkpoints as SDK contracts. Runs the CLI at a process
 * boundary (never deep-imports CLI internals), so the JSON output of these
 * commands is the stability surface.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCliJson = runCliJson;
exports.listSessions = listSessions;
exports.showSession = showSession;
exports.listCheckpoints = listCheckpoints;
exports.createCheckpoint = createCheckpoint;
exports.showCheckpoint = showCheckpoint;
exports.restoreCheckpoint = restoreCheckpoint;
const node_child_process_1 = require("node:child_process");
const agent_session_js_1 = require("./agent-session.js");
function runCliJson(args, options = {}) {
    const cliPath = options.cliPath || "cc";
    const { command, args: fullArgs } = (0, agent_session_js_1.buildSpawnCommand)(cliPath, args);
    const impl = options.execFileImpl ?? node_child_process_1.execFile;
    const env = { ...process.env, ...options.env };
    if (process.platform === "win32") {
        env.NoDefaultCurrentDirectoryInExePath = "1";
    }
    return new Promise((resolve, reject) => {
        impl(command, fullArgs, {
            cwd: options.cwd,
            env,
            timeout: options.timeoutMs ?? 30_000,
            maxBuffer: 32 * 1024 * 1024,
            encoding: "utf8",
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`cc ${args.join(" ")} failed: ${error.message}${stderr ? `\n${String(stderr).slice(0, 500)}` : ""}`));
                return;
            }
            try {
                resolve(JSON.parse(String(stdout)));
            }
            catch {
                reject(new Error(`cc ${args.join(" ")} returned non-JSON output: ${String(stdout).slice(0, 200)}`));
            }
        });
    });
}
function asArray(value) {
    if (Array.isArray(value))
        return value;
    if (value && typeof value === "object") {
        const obj = value;
        for (const key of ["sessions", "checkpoints", "items", "results"]) {
            if (Array.isArray(obj[key]))
                return obj[key];
        }
    }
    return [];
}
/** `cc session list --json` */
async function listSessions(options = {}) {
    const raw = await runCliJson(["session", "list", "--json"], options);
    return asArray(raw);
}
/** `cc session show <id> --json` */
function showSession(id, options = {}) {
    return runCliJson(["session", "show", id, "--json"], options);
}
/** `cc checkpoint list --json` */
async function listCheckpoints(options = {}) {
    const raw = await runCliJson(["checkpoint", "list", "--json"], options);
    return asArray(raw);
}
/** `cc checkpoint create [paths...] --json` */
function createCheckpoint(paths = [], options = {}) {
    return runCliJson(["checkpoint", "create", ...paths, "--json"], options);
}
/** `cc checkpoint show <id> --json` */
function showCheckpoint(id, options = {}) {
    return runCliJson(["checkpoint", "show", id, "--json"], options);
}
/** `cc checkpoint restore <id> --json` — rewinds workspace files. */
function restoreCheckpoint(id, options = {}) {
    return runCliJson(["checkpoint", "restore", id, "--json"], options);
}
