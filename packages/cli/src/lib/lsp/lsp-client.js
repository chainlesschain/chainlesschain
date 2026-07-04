/**
 * LSPClient — one connection to a single language server over stdio.
 *
 * Speaks JSON-RPC 2.0 framed by `jsonrpc-stream.js`. Responsibilities:
 *   - spawn the server process (stdio pipes, UTF-8)
 *   - the `initialize` / `initialized` handshake
 *   - correlate `request` id → Promise, dispatch `notification`s to listeners
 *   - request timeouts, graceful `shutdown`/`exit`, and process-level
 *     `error`/`exit` propagation
 *
 * Testability: all process spawning goes through `_deps.spawn` so tests inject a
 * fake stdio pair (see cli-dev.md `_deps` pattern — `vi.mock("child_process")`
 * does not intercept this file). Nothing here is language-specific.
 */

import { spawn as nodeSpawn } from "child_process";
import { EventEmitter } from "events";
import { encodeMessage, MessageBuffer } from "./jsonrpc-stream.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_INIT_TIMEOUT_MS = 30_000;

// Injectable so unit tests can supply a fake child process.
export const _deps = { spawn: nodeSpawn };

export class LSPClient extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.command      server executable
   * @param {string[]} [opts.args]     server args (e.g. ["--stdio"])
   * @param {string} opts.rootPath     absolute project root
   * @param {object} [opts.env]        extra env vars
   * @param {number} [opts.requestTimeoutMs]
   * @param {object} [opts.capabilities] client capabilities override
   */
  constructor(opts = {}) {
    super();
    this.command = opts.command;
    this.args = Array.isArray(opts.args) ? opts.args : [];
    this.rootPath = opts.rootPath;
    this.env = opts.env || {};
    this.requestTimeoutMs = opts.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.capabilitiesOverride = opts.capabilities || null;

    this._child = null;
    this._buffer = new MessageBuffer();
    this._nextId = 1;
    /** @type {Map<number, {resolve,reject,timer}>} */
    this._pending = new Map();
    this._initialized = false;
    this._closed = false;
    /** server-reported capabilities from `initialize` */
    this.serverCapabilities = null;
  }

  get running() {
    return Boolean(this._child) && !this._closed;
  }

  /** Spawn the process and run the initialize handshake. Resolves when ready. */
  async start({ initTimeoutMs = DEFAULT_INIT_TIMEOUT_MS } = {}) {
    if (this._child) throw new Error("LSPClient already started");

    // shell:false — never route the server command through a shell (prevents
    // command injection and GBK codepage surprises on Windows). Callers pass a
    // resolved executable path; see lsp-server-registry.js. `.cmd`/`.bat` shims
    // can't be spawned directly with shell:false since Node's CVE-2024-27980
    // fix, so buildSpawnCommand rewrites them to an explicit `cmd.exe /d /s /c`
    // invocation with verbatim args — still no shell, still injection-safe.
    const spawnSpec = buildSpawnCommand(this.command, this.args);
    this._child = _deps.spawn(spawnSpec.file, spawnSpec.args, {
      cwd: this.rootPath,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
    });

    this._child.on("error", (err) => {
      this._failAll(err);
      this.emit("error", err);
    });
    this._child.on("exit", (code, signal) => {
      const wasClosed = this._closed;
      this._closed = true;
      this._failAll(
        new Error(`language server exited (code=${code}, signal=${signal})`),
      );
      if (!wasClosed) this.emit("exit", { code, signal });
    });

    // UTF-8 decode explicitly (encoding.md) — never rely on system default.
    this._child.stdout.on("data", (chunk) => {
      this._buffer.append(chunk);
      for (const msg of this._buffer.readAll()) this._dispatch(msg);
    });
    // Surface server diagnostics/logs without corrupting the message channel.
    this._child.stderr.on("data", (chunk) => {
      this.emit("stderr", chunk.toString("utf8"));
    });

    try {
      const initResult = await this.request(
        "initialize",
        this._initializeParams(),
        { timeoutMs: initTimeoutMs },
      );
      this.serverCapabilities = initResult?.capabilities || {};
      this.notify("initialized", {});
      this._initialized = true;
      return this.serverCapabilities;
    } catch (err) {
      // The process spawned but the initialize handshake failed or timed out (a
      // hung/slow/broken server). Don't leave it orphaned: an init HANG never
      // fires 'exit', and the manager's crash-loop guard only counts exits, so
      // the process would linger forever holding a port/file locks. Tear it down
      // before rethrowing so the caller's failure path doesn't leak a server.
      this._closed = true;
      this._failAll(err);
      try {
        this._child.kill();
      } catch {
        /* already dead */
      }
      throw err;
    }
  }

  _initializeParams() {
    const rootUri = pathToFileUri(this.rootPath);
    return {
      processId: process.pid,
      clientInfo: { name: "chainlesschain-cc", version: "1" },
      rootUri,
      rootPath: this.rootPath,
      workspaceFolders: [{ uri: rootUri, name: "workspace" }],
      capabilities: this.capabilitiesOverride || defaultClientCapabilities(),
    };
  }

  /** Send a JSON-RPC request and await its result. */
  request(method, params, { timeoutMs } = {}) {
    if (this._closed) {
      return Promise.reject(new Error("LSPClient is closed"));
    }
    const id = this._nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(
          new Error(
            `LSP request "${method}" timed out after ${timeoutMs || this.requestTimeoutMs}ms`,
          ),
        );
      }, timeoutMs || this.requestTimeoutMs);
      // Don't keep the event loop alive purely for a pending LSP request.
      if (typeof timer.unref === "function") timer.unref();
      this._pending.set(id, { resolve, reject, timer });
      this._write(payload);
    });
  }

  /** Send a JSON-RPC notification (no response expected). */
  notify(method, params) {
    if (this._closed) return;
    this._write({ jsonrpc: "2.0", method, params });
  }

  _write(payload) {
    if (!this._child || !this._child.stdin.writable) return;
    try {
      this._child.stdin.write(encodeMessage(payload));
    } catch (err) {
      this.emit("error", err);
    }
  }

  _dispatch(msg) {
    if (msg == null) return;
    // Response to one of our requests.
    if (Object.prototype.hasOwnProperty.call(msg, "id") && msg.method == null) {
      const entry = this._pending.get(msg.id);
      if (!entry) return; // late/duplicate response — ignore
      this._pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        const e = new Error(msg.error.message || "LSP error");
        e.code = msg.error.code;
        e.data = msg.error.data;
        entry.reject(e);
      } else {
        entry.resolve(msg.result);
      }
      return;
    }
    // Server → client request (e.g. workspace/configuration). We don't act on
    // these yet, but must reply so the server doesn't block; reply null.
    if (msg.method != null && Object.prototype.hasOwnProperty.call(msg, "id")) {
      this._write({ jsonrpc: "2.0", id: msg.id, result: null });
      this.emit("serverRequest", msg);
      return;
    }
    // Notification from the server (diagnostics, logs, progress…).
    if (msg.method != null) {
      this.emit("notification", msg.method, msg.params);
      this.emit(`notify:${msg.method}`, msg.params);
    }
  }

  _failAll(err) {
    for (const [, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this._pending.clear();
  }

  /** Graceful LSP shutdown → exit → kill fallback. Idempotent. */
  async stop({ graceTimeoutMs = 2000 } = {}) {
    if (!this._child || this._closed) {
      this._closed = true;
      return;
    }
    try {
      if (this._initialized) {
        await this.request("shutdown", null, { timeoutMs: graceTimeoutMs });
        this.notify("exit", null);
      }
    } catch {
      // Server unresponsive — fall through to hard kill.
    } finally {
      this._closed = true;
      this._failAll(new Error("LSPClient stopped"));
      try {
        this._child.kill();
      } catch {
        /* already dead */
      }
    }
  }
}

/**
 * Compute the actual (file, args) to spawn without a shell. On Windows a
 * `.cmd`/`.bat` batch shim cannot be spawned with shell:false (EINVAL since
 * Node's CVE-2024-27980 fix), so route it through `cmd.exe /d /s /c "<cmd>" …`
 * with windowsVerbatimArguments so cmd.exe — not Node — parses the line. The
 * command path is double-quoted (handles spaces) and our args are constant, so
 * there is no injection surface. Everything else spawns verbatim.
 */
export function buildSpawnCommand(command, args = []) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const comspec = process.env.ComSpec || "cmd.exe";
    // Always quote the command path (a batch path can contain spaces/&); quote
    // args only when they carry shell-significant characters. Verbatim args mean
    // cmd.exe — not Node — parses this line, so our own quoting is authoritative.
    const quotedCmd = `"${String(command).replace(/"/g, '""')}"`;
    const quotedArgs = args.map((a) =>
      /[\s"&|<>^]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a,
    );
    return {
      file: comspec,
      args: ["/d", "/s", "/c", [quotedCmd, ...quotedArgs].join(" ")],
      windowsVerbatimArguments: true,
    };
  }
  return { file: command, args, windowsVerbatimArguments: false };
}

/** LSP wants a `file://` URI; build one that round-trips on Windows and POSIX. */
export function pathToFileUri(p) {
  if (!p) return "";
  let normalized = String(p).replace(/\\/g, "/");
  // Windows drive path → file:///C:/...
  if (/^[a-zA-Z]:\//.test(normalized)) {
    normalized = "/" + normalized;
  }
  const encoded = normalized
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return "file://" + encoded;
}

/**
 * Canonicalize a `file://` URI so keys match regardless of who produced them.
 * Windows language servers echo back a lowercase drive letter
 * (`file:///c%3A/…`) while `path.resolve` yields uppercase (`C%3A`), so a Map
 * keyed on the raw URI misses. Lowercasing the drive letter reconciles both.
 */
export function normalizeUri(uri) {
  if (!uri) return uri;
  return String(uri).replace(
    /^(file:\/\/\/)([A-Za-z])(%3[Aa]|:)/,
    (_m, p, drive, colon) => p + drive.toLowerCase() + colon,
  );
}

/** Convert a `file://` URI back to a native filesystem path. */
export function fileUriToPath(uri) {
  if (!uri) return "";
  let p = String(uri).replace(/^file:\/\//, "");
  p = decodeURIComponent(p);
  // /C:/... → C:/... on Windows
  if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1);
  return process.platform === "win32" ? p.replace(/\//g, "\\") : p;
}

function defaultClientCapabilities() {
  return {
    textDocument: {
      synchronization: { dynamicRegistration: false, didSave: true },
      definition: { dynamicRegistration: false, linkSupport: false },
      references: { dynamicRegistration: false },
      hover: {
        dynamicRegistration: false,
        contentFormat: ["markdown", "plaintext"],
      },
      documentSymbol: {
        dynamicRegistration: false,
        hierarchicalDocumentSymbolSupport: true,
      },
      publishDiagnostics: { relatedInformation: true },
      rename: { dynamicRegistration: false, prepareSupport: true },
    },
    workspace: {
      workspaceFolders: true,
      symbol: { dynamicRegistration: false },
      configuration: true,
    },
  };
}
