"use strict";
/**
 * AgentSession — duplex client for `cc agent` over stream-json stdio.
 *
 * Spawns the CLI once per session and speaks the NDJSON protocol from
 * ./protocol.ts both directions. This replaces per-consumer argv assembly
 * (VS Code agent-session.js / JetBrains AgentChatSession.java) with one
 * typed transport:
 *
 *   const session = new AgentSession({ onApproval: async (req) => ... });
 *   const ready = new Promise((resolve) => session.on("init", resolve));
 *   session.start();
 *   await ready;
 *   session.on("text", (t) => render(t));
 *   session.send("refactor foo.ts");
 *
 * Approval callback contract: providing `onApproval` implies
 * --interactive-approvals; the SDK answers each approval_request with the
 * callback's verdict and fails CLOSED (deny) if the callback throws.
 * Question callback contract: providing `onQuestion` sets
 * CC_INTERACTIVE_QUESTIONS=1; a null return cancels the question.
 * Session resume contract: pass `resume` to continue a transcript; the
 * live session id (new or resumed) always arrives via the "init" event
 * and `sessionId`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentSession = void 0;
exports.buildSpawnCommand = buildSpawnCommand;
exports.buildAgentArgs = buildAgentArgs;
const node_child_process_1 = require("node:child_process");
const ndjson_js_1 = require("./ndjson.js");
const app_protocol_js_1 = require("./generated/app-protocol.js");
const protocol_js_1 = require("./protocol.js");
function normalizeApprovalVerdict(verdict, invalidReason = "Invalid approval callback decision") {
    if (verdict === true)
        return { kind: "acceptOnce" };
    if (verdict === false)
        return { kind: "decline" };
    if ((0, app_protocol_js_1.isApprovalDecision)(verdict))
        return verdict;
    return { kind: "decline", reason: invalidReason };
}
function approvalBoolean(decision) {
    return ["acceptOnce", "acceptForTurn", "acceptForSession"].includes(decision.kind);
}
/**
 * On Windows `cc` is an npm `.cmd` shim, so the child must go through
 * `cmd.exe /c`. NoDefaultCurrentDirectoryInExePath stops cmd.exe from
 * executing a repo-local `cc.bat` planted in the workspace — the same
 * P0 fix both IDE plugins ship (VS Code hardened-env.js / JetBrains
 * CliLauncher.augmentPath).
 */
function buildSpawnCommand(cliPath, args, platform = process.platform) {
    // A .js entrypoint (e.g. a repo checkout's bin/chainlesschain.js) is not
    // directly spawnable — run it through the current Node.
    if (/\.(m?js|cjs)$/i.test(cliPath)) {
        return { command: process.execPath, args: [cliPath, ...args] };
    }
    if (platform === "win32") {
        return { command: "cmd.exe", args: ["/c", cliPath, ...args] };
    }
    return { command: cliPath, args };
}
function buildAgentArgs(options) {
    const args = [
        "agent",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
    ];
    if (options.includePartialMessages !== false) {
        args.push("--include-partial-messages");
    }
    if (options.onApproval)
        args.push("--interactive-approvals");
    if (options.resume)
        args.push("--resume", options.resume);
    else if (options.sessionId)
        args.push("--session", options.sessionId);
    if (options.forkSession)
        args.push("--fork-session");
    if (options.permissionMode && options.permissionMode !== "default") {
        args.push("--permission-mode", options.permissionMode);
    }
    if (options.model)
        args.push("--model", options.model);
    if (options.provider)
        args.push("--provider", options.provider);
    if (options.extraArgs?.length)
        args.push(...options.extraArgs);
    return args;
}
class AgentSession {
    options;
    child = null;
    listeners = new Map();
    exited = false;
    _sessionId = null;
    constructor(options = {}) {
        this.options = options;
    }
    /** Live session id — set once the system/init event arrives. */
    get sessionId() {
        return this._sessionId;
    }
    get running() {
        return this.child !== null && !this.exited;
    }
    on(event, listener) {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(listener);
        return this;
    }
    off(event, listener) {
        this.listeners.get(event)?.delete(listener);
        return this;
    }
    emit(event, ...args) {
        const set = this.listeners.get(event);
        if (!set)
            return;
        for (const listener of set) {
            try {
                listener(...args);
            }
            catch {
                // A misbehaving listener must never break the protocol pump.
            }
        }
    }
    /** Spawn the CLI child. Listen for `init` before sending the first turn. */
    start() {
        if (this.child)
            throw new Error("AgentSession already started");
        const cliPath = this.options.cliPath || "cc";
        const args = buildAgentArgs(this.options);
        const { command, args: fullArgs } = buildSpawnCommand(cliPath, args);
        const env = {
            ...process.env,
            ...this.options.env,
        };
        if (process.platform === "win32") {
            env.NoDefaultCurrentDirectoryInExePath = "1";
        }
        if (this.options.onQuestion)
            env.CC_INTERACTIVE_QUESTIONS = "1";
        const spawnImpl = this.options.spawn ?? node_child_process_1.spawn;
        const spawnOptions = {
            cwd: this.options.cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
        };
        const child = spawnImpl(command, fullArgs, spawnOptions);
        this.child = child;
        const decode = (0, ndjson_js_1.createNdjsonDecoder)((message) => this.dispatch(message), { onError: () => { } });
        child.stdout?.on("data", (chunk) => decode(chunk.toString("utf8")));
        child.stderr?.on("data", (chunk) => this.emit("stderr", chunk.toString("utf8")));
        child.on("error", (error) => this.emit("error", error));
        child.on("exit", (code) => {
            if (this.exited)
                return;
            this.exited = true;
            // A final unterminated line (error output often lacks the trailing
            // \n) must not be dropped silently.
            try {
                decode.flush();
            }
            catch {
                /* flush is best-effort */
            }
            this.emit("exit", code);
        });
    }
    dispatch(message) {
        if (!(0, protocol_js_1.isAgentEvent)(message))
            return;
        const event = message;
        this.emit("event", event);
        if ((0, protocol_js_1.isSystemInit)(event)) {
            this._sessionId = event.session_id;
            this.emit("init", event);
            return;
        }
        const delta = (0, protocol_js_1.contentDelta)(event);
        if (delta) {
            this.emit(delta.kind === "thinking" ? "thinking" : "text", delta.text);
            return;
        }
        if (event.type === "tool_use") {
            this.emit("tool_use", event);
            return;
        }
        if (event.type === "tool_result") {
            this.emit("tool_result", event);
            return;
        }
        if ((0, protocol_js_1.isApprovalRequest)(event)) {
            this.emit("approval_request", event);
            this.autoRespondApproval(event);
            return;
        }
        if ((0, protocol_js_1.isMcpElicitationRequest)(event)) {
            this.emit("elicitation_request", event);
            this.autoRespondElicitation(event);
            return;
        }
        if (event.type === "elicitation_deferred") {
            this.emit("elicitation_deferred", event);
            return;
        }
        if (event.type === "elicitation_complete") {
            this.emit("elicitation_complete", event);
            return;
        }
        if ((0, protocol_js_1.isQuestionRequest)(event)) {
            this.emit("question_request", event);
            this.autoRespondQuestion(event);
            return;
        }
        if ((0, protocol_js_1.isResult)(event)) {
            this.emit("result", event);
            return;
        }
    }
    autoRespondApproval(request) {
        const callback = this.options.onApproval;
        if (!callback)
            return;
        void (async () => {
            let decision = {
                kind: "decline",
                reason: "Approval callback failed",
            };
            try {
                decision = normalizeApprovalVerdict(await callback(request));
            }
            catch {
                // Fail closed, mirroring the CLI's own timeout path.
            }
            this.respondApproval(request.id, decision, request.binding);
        })();
    }
    autoRespondQuestion(request) {
        const callback = this.options.onQuestion;
        if (!callback)
            return;
        void (async () => {
            let answer = null;
            try {
                answer = await callback(request);
            }
            catch {
                answer = null; // cancel — the CLI resolves it as user_timeout
            }
            this.answerQuestion(request.id, answer, request.binding);
        })();
    }
    autoRespondElicitation(request) {
        const callback = this.options.onElicitation;
        if (!callback)
            return;
        void (async () => {
            try {
                const response = await callback(request);
                if (response?.action === "accept") {
                    this.answerQuestion(request.id, response.content ?? {}, request.binding);
                }
                else {
                    this.answerQuestion(request.id, null, request.binding);
                }
            }
            catch {
                this.answerQuestion(request.id, null, request.binding);
            }
        })();
    }
    /** Write one protocol input event to the child's stdin. */
    write(event) {
        const stdin = this.child?.stdin;
        if (!stdin || stdin.destroyed)
            return false;
        try {
            return stdin.write((0, ndjson_js_1.encodeNdjson)(event));
        }
        catch {
            return false;
        }
    }
    /** Queue one user turn. */
    send(text, options = {}) {
        const event = { type: "user", text };
        if (options.images?.length)
            event.images = options.images;
        if (options.llm)
            event.llm = options.llm;
        return this.write(event);
    }
    /** Abort the in-flight turn without ending the session. */
    interrupt() {
        return this.write({ type: "interrupt" });
    }
    /** Trim conversation history in place between turns. */
    compact() {
        return this.write({ type: "compact" });
    }
    respondApproval(id, verdict, binding) {
        // Preserve the N-1 public method contract exactly. A boolean response must
        // remain a legacy wire event; turning it into a structured decision would
        // make a new CLI require a binding that old callers never received/passed.
        if (typeof verdict === "boolean") {
            return this.write({
                type: "approval",
                id,
                approve: verdict,
                ...(binding ? { binding } : {}),
            });
        }
        const decision = normalizeApprovalVerdict(verdict, "Invalid approval response");
        return this.write({
            type: "approval",
            id,
            decision,
            approve: approvalBoolean(decision),
            ...(binding ? { binding } : {}),
        });
    }
    answerQuestion(id, answer, binding) {
        return this.write({
            type: "answer",
            id,
            answer,
            ...(binding ? { binding } : {}),
        });
    }
    planControl(action) {
        return this.write({ type: "plan", action });
    }
    /**
     * Resolves with the next result event — convenience for
     * send-one-prompt / await-one-turn usage.
     */
    nextResult() {
        return new Promise((resolve, reject) => {
            const onResult = (event) => {
                cleanup();
                resolve(event);
            };
            const onExit = (code) => {
                cleanup();
                reject(new Error(`agent exited (code ${code}) before a result`));
            };
            const cleanup = () => {
                this.off("result", onResult);
                this.off("exit", onExit);
            };
            this.on("result", onResult);
            this.on("exit", onExit);
        });
    }
    /** Graceful shutdown: close stdin so the CLI ends after the current turn. */
    end() {
        try {
            this.child?.stdin?.end();
        }
        catch {
            /* already closed */
        }
    }
    /** Hard kill of the child process tree. */
    kill() {
        const child = this.child;
        if (!child || this.exited)
            return;
        try {
            if (process.platform === "win32" && child.pid) {
                // taskkill /T reaps the cmd.exe → node grandchild, which a plain
                // child.kill() would orphan (same fix as both IDE plugins).
                (0, node_child_process_1.spawnSync)("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
            }
            else {
                child.kill("SIGKILL");
            }
        }
        catch {
            /* process already gone */
        }
    }
}
exports.AgentSession = AgentSession;
