/**
 * LSPManager — pools language servers by (projectRoot, languageId), syncs open
 * documents, translates positions, and recovers from server crashes.
 *
 * One `LSPClient` is expensive (spawns a process + indexes the project), so we
 * lazily start and reuse one per (root, language) family. The manager owns:
 *   - server lifecycle (start / reuse / bounded crash-loop restart / disposeAll)
 *   - textDocument/didOpen + didChange (servers only answer about open docs)
 *   - diagnostics collection (servers push them via publishDiagnostics)
 *   - 1-based (user) ⇄ 0-based (LSP) position conversion, done HERE only
 *
 * The high-level `code-intelligence.js` calls into this; nothing above the
 * manager should touch raw LSP positions/URIs.
 */

import fs from "fs";
import path from "path";
import { LSPClient, pathToFileUri, normalizeUri } from "./lsp-client.js";
import { languageIdForFile, resolveServer } from "./lsp-server-registry.js";

export const _deps = {
  readFileSync: fs.readFileSync,
  existsSync: fs.existsSync,
  createClient: (opts) => new LSPClient(opts),
};

export class LSPManager {
  /**
   * @param {object} [opts]
   * @param {string} [opts.projectRoot] default root; per-file root inferred otherwise
   * @param {number} [opts.maxRestarts] crashes within the window before a server
   *   is quarantined (degrade to text search) instead of re-spawned. Default 3.
   * @param {number} [opts.restartWindowMs] sliding window for the crash count.
   *   A server that stays healthy for this long has its crash history pruned and
   *   can restart fresh. Default 30000.
   * @param {number} [opts.restartBackoffBaseMs] exponential backoff BETWEEN
   *   restart attempts: after the Nth recent crash the (N+1)th re-spawn waits
   *   `base·2^(N-1)` (capped by `restartBackoffMaxMs`) before it is allowed,
   *   spreading out a fast startup-crash loop instead of bursting `maxRestarts`
   *   spawns back-to-back. Default 0 = OFF (byte-identical to the prior
   *   immediate-respawn behaviour); opt-in pending evaluation.
   * @param {number} [opts.restartBackoffMaxMs] cap for the exponential backoff.
   *   Default 8000.
   * @param {() => number} [opts.now] injected clock (deterministic crash-loop tests)
   */
  constructor(opts = {}) {
    this.projectRoot = opts.projectRoot || process.cwd();
    /** key `${root}::${serverId}` → { client, languageId, root, restarts } */
    this._servers = new Map();
    /**
     * key → in-flight `_startServer` promise. A server start awaits a real
     * process spawn + `initialize` handshake, and the read-only agent batch
     * fires several `code_intelligence` calls at once (see agent-core.js), so a
     * bare Map.get(miss)→await→Map.set pool double-spawns when two callers race
     * the same key: the second `_servers.set` orphans the first process (leaked
     * OS process + a still-attached diagnostics listener writing stale state).
     * Sharing one in-flight promise per key collapses the race to a single spawn.
     */
    this._starting = new Map();
    /** open document uri → { version, languageId } */
    this._openDocs = new Map();
    /** uri → latest diagnostics array */
    this._diagnostics = new Map();
    /** uri → { count, at } publish bookkeeping (for settle/readiness) */
    this._diagMeta = new Map();
    // Crash-loop guard: a language server that dies is lazily re-spawned on the
    // next request (ensureFor), but a server that crashes on startup would then
    // thrash — re-spawned on EVERY request forever. Bound it: at most
    // `maxRestarts` crashes inside a sliding `restartWindowMs`, after which the
    // server is quarantined (callers degrade to text search) until the window
    // clears. `restarts` was previously a dead field; this makes it real.
    this.maxRestarts = Number.isFinite(opts.maxRestarts) ? opts.maxRestarts : 3;
    this.restartWindowMs = Number.isFinite(opts.restartWindowMs)
      ? opts.restartWindowMs
      : 30000;
    // Exponential backoff BETWEEN restart attempts (distinct from the quarantine
    // cap above). Without it, a server that crashes on startup is re-spawned on
    // the very next request — bursting `maxRestarts` spawns back-to-back in
    // milliseconds before quarantine. When enabled, the (N+1)th spawn after N
    // recent crashes waits `base·2^(N-1)` (capped), so a fast crash loop can't
    // storm the process table. Default 0 = OFF → byte-identical to the prior
    // immediate-respawn behaviour (opt-in pending evaluation).
    this.restartBackoffBaseMs = Number.isFinite(opts.restartBackoffBaseMs)
      ? Math.max(0, opts.restartBackoffBaseMs)
      : 0;
    this.restartBackoffMaxMs = Number.isFinite(opts.restartBackoffMaxMs)
      ? opts.restartBackoffMaxMs
      : 8000;
    this._now = typeof opts.now === "function" ? opts.now : () => Date.now();
    /** key → array of recent crash timestamps (survives entry re-spawn) */
    this._crashLog = new Map();
    this._disposed = false;
  }

  /** Recent crash timestamps for `key`, pruned to the sliding window. */
  _recentCrashes(key) {
    const cutoff = this._now() - this.restartWindowMs;
    const pruned = (this._crashLog.get(key) || []).filter((t) => t >= cutoff);
    if (pruned.length) this._crashLog.set(key, pruned);
    else this._crashLog.delete(key);
    return pruned;
  }

  /**
   * Minimum delay before the next restart attempt given `crashCount` recent
   * crashes: exponential `base·2^(crashCount-1)`, capped at `restartBackoffMaxMs`.
   * Returns 0 when backoff is disabled (base 0) or `crashCount <= 0` (a first
   * start). Deterministic (no jitter) so crash-loop tests stay reproducible.
   */
  _restartBackoffMs(crashCount) {
    if (this.restartBackoffBaseMs <= 0 || crashCount <= 0) return 0;
    const exp = this.restartBackoffBaseMs * 2 ** (crashCount - 1);
    return Math.min(exp, this.restartBackoffMaxMs);
  }

  /**
   * Ensure a server is running for `filePath` and the file is open. Returns
   * `{ client, uri, languageId }`, or `{ unavailable: true, reason }` when no
   * server is installed (caller degrades to text search).
   */
  async ensureFor(
    filePath,
    { root, waitReady = false, readyTimeoutMs = 8000 } = {},
  ) {
    if (this._disposed) throw new Error("LSPManager disposed");
    const abs = path.resolve(filePath);
    const languageId = languageIdForFile(abs);
    if (!languageId) {
      return {
        unavailable: true,
        reason: `no language mapping for ${path.extname(abs) || "file"}`,
      };
    }
    const projectRoot = root || this._inferRoot(abs);
    const resolved = resolveServer(languageId, projectRoot);
    if (!resolved) {
      return {
        unavailable: true,
        reason: `no language server installed for ${languageId} (install one, e.g. typescript-language-server)`,
      };
    }

    const key = `${projectRoot}::${resolved.id}`;
    let entry = this._servers.get(key);
    if (!entry || !entry.client.running) {
      // A dead/absent server is (re)started — but if it has crash-looped past
      // the cap inside the window, quarantine it so we don't re-spawn on every
      // request. The caller degrades to text search until the window clears.
      const crashes = this._recentCrashes(key);
      if (crashes.length >= this.maxRestarts) {
        const retryInMs = this.restartWindowMs - (this._now() - crashes[0]);
        return {
          unavailable: true,
          reason:
            `${resolved.id} crash-looped (${crashes.length} crashes in ` +
            `${Math.round(this.restartWindowMs / 1000)}s) — quarantined, ` +
            `retrying in ~${Math.max(0, Math.round(retryInMs / 1000))}s`,
          quarantined: true,
        };
      }
      // Under the quarantine cap but recently crashed: when backoff is enabled,
      // space out the re-spawn exponentially so a fast startup-crash loop doesn't
      // storm the process table. The caller degrades to text search until the
      // cooldown elapses — a transient state, distinct from quarantine.
      if (crashes.length > 0) {
        const backoffMs = this._restartBackoffMs(crashes.length);
        if (backoffMs > 0) {
          const lastCrash = crashes[crashes.length - 1];
          const sinceLast = this._now() - lastCrash;
          if (sinceLast < backoffMs) {
            const retryInMs = backoffMs - sinceLast;
            return {
              unavailable: true,
              reason:
                `${resolved.id} restarting after a crash — backing off ` +
                `~${Math.max(0, Math.round(retryInMs / 1000))}s ` +
                `(attempt ${crashes.length + 1}/${this.maxRestarts})`,
              backoff: true,
              retryInMs,
            };
          }
        }
      }
      entry = await this._getOrStartServer(key, resolved, projectRoot);
    }

    const uri = pathToFileUri(abs);
    this._ensureOpen(entry.client, uri, abs, languageId);

    // One-shot callers (the `cc code-intel` CLI) spawn a cold server per run;
    // the server publishes an empty diagnostics set BEFORE it finishes loading
    // the tsconfig project, so an immediate definition/references/diagnostics
    // query sees a partial project. Waiting for the first publish for THIS doc
    // is a reliable "project loaded far enough" signal. Long-lived callers (the
    // agent session) keep the server warm and pass waitReady:false.
    if (waitReady) {
      await this._waitForFirstPublish(uri, readyTimeoutMs);
    }
    return { client: entry.client, uri, languageId, root: projectRoot };
  }

  /** Resolve once the server has published diagnostics for `uri` at least once, or timeout. */
  _waitForFirstPublish(rawUri, timeoutMs) {
    const uri = normalizeUri(rawUri);
    if ((this._diagMeta.get(uri)?.count || 0) > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (
          (this._diagMeta.get(uri)?.count || 0) > 0 ||
          Date.now() - started >= timeoutMs
        ) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  /**
   * Dedupe concurrent starts for `key`: return the in-flight start promise if
   * one exists, otherwise begin one and register it so racing callers share it.
   * The promise self-evicts on settle (resolve OR reject), so a failed start
   * doesn't wedge the key — the next request retries cleanly.
   */
  _getOrStartServer(key, resolved, projectRoot) {
    const inflight = this._starting.get(key);
    if (inflight) return inflight;
    const p = this._startServer(key, resolved, projectRoot).finally(() => {
      this._starting.delete(key);
    });
    this._starting.set(key, p);
    return p;
  }

  async _startServer(key, resolved, projectRoot) {
    const client = _deps.createClient({
      command: resolved.command,
      args: resolved.args,
      rootPath: projectRoot,
      origin: resolved.origin,
      pluginId: resolved.pluginId,
      pluginVersion: resolved.pluginVersion,
      pluginSource: resolved.pluginSource,
    });
    // Collect pushed diagnostics keyed by document, tracking publish count/time
    // so callers can wait for the project to load (first publish) and settle
    // (last publish) rather than racing the initial empty set tsserver emits.
    client.on("notify:textDocument/publishDiagnostics", (params) => {
      if (params && params.uri) {
        const key = normalizeUri(params.uri);
        this._diagnostics.set(key, params.diagnostics || []);
        const prev = this._diagMeta.get(key) || { count: 0 };
        this._diagMeta.set(key, { count: prev.count + 1, at: Date.now() });
      }
    });
    const entry = {
      client,
      serverId: resolved.id,
      root: projectRoot,
      // How many times THIS key has already been (re)started — crash history
      // survives entry replacement via _crashLog, so this reflects it.
      restarts: (this._crashLog.get(key) || []).length,
    };
    // On crash: record the crash timestamp (bounds the re-spawn loop via the
    // crash-loop guard in ensureFor) and drop this project's open docs so they
    // re-sync against the fresh server on the next ensureFor.
    client.on("exit", () => {
      const log = this._crashLog.get(key) || [];
      log.push(this._now());
      this._crashLog.set(key, log);
      // Drop this project's open docs AND their published-diagnostics
      // bookkeeping. Leaving stale _diagMeta/_diagnostics behind makes the
      // readiness waiters resolve on the PRE-CRASH publish — _waitForFirstPublish
      // sees count>0 and returns immediately; waitForDiagnostics sees an old
      // `at` and settles at once — so a query after a crash+restart returns
      // stale results and races the fresh server's initial empty set, the very
      // thing the publish-count machinery exists to prevent. (_openDocs keys are
      // the raw file URI; _diagMeta/_diagnostics use the normalized key.)
      for (const [uri, meta] of this._openDocs) {
        if (meta.root === projectRoot) {
          this._openDocs.delete(uri);
          const nuri = normalizeUri(uri);
          this._diagnostics.delete(nuri);
          this._diagMeta.delete(nuri);
        }
      }
    });
    await client.start();
    this._servers.set(key, entry);
    return entry;
  }

  _ensureOpen(client, uri, abs, languageId) {
    const existing = this._openDocs.get(uri);
    let text = "";
    try {
      text = _deps.readFileSync(abs, "utf8");
    } catch {
      text = "";
    }
    if (!existing) {
      client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
      this._openDocs.set(uri, {
        version: 1,
        languageId,
        root: client.rootPath,
      });
    } else {
      // File may have changed on disk since first open — push the latest text so
      // definitions/diagnostics reflect current state (edit-freshness).
      const version = existing.version + 1;
      client.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
      this._openDocs.set(uri, { ...existing, version });
    }
  }

  /** Notify the server that a document changed on disk (after an edit). */
  async didChangeFile(filePath, { root } = {}) {
    const abs = path.resolve(filePath);
    const uri = pathToFileUri(abs);
    if (!this._openDocs.has(uri)) {
      // Not open yet — opening it (via ensureFor) will read fresh text anyway.
      return this.ensureFor(abs, { root });
    }
    const ready = await this.ensureFor(abs, { root });
    return ready;
  }

  /** Latest diagnostics for a file (may be empty). Server pushes asynchronously. */
  getDiagnostics(filePath) {
    const uri = normalizeUri(pathToFileUri(path.resolve(filePath)));
    return this._diagnostics.get(uri) || [];
  }

  /**
   * Wait for diagnostics for `filePath` to publish AND settle, then return the
   * latest set. tsserver publishes an initial (often empty) set the moment a doc
   * opens, then republishes once the project is loaded — resolving on the first
   * publish would return stale/empty results. So we wait for at least one
   * publish, then a `settleMs` quiet window with no further publishes (bounded
   * by `timeoutMs`), and return whatever was published last.
   */
  async waitForDiagnostics(
    filePath,
    { timeoutMs = 3000, settleMs = 600 } = {},
  ) {
    const uri = normalizeUri(pathToFileUri(path.resolve(filePath)));
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const meta = this._diagMeta.get(uri);
        const elapsed = Date.now() - started;
        const settled =
          meta && meta.count > 0 && Date.now() - meta.at >= settleMs;
        if (settled || elapsed >= timeoutMs) {
          clearInterval(timer);
          resolve(this._diagnostics.get(uri) || []);
        }
      }, 50);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  /** Infer the project root for a file: nearest ancestor with package.json / .git / go.mod / Cargo.toml. */
  _inferRoot(abs) {
    let dir = path.dirname(abs);
    const markers = [
      "package.json",
      ".git",
      "go.mod",
      "Cargo.toml",
      "tsconfig.json",
      "pyproject.toml",
    ];
    for (let i = 0; i < 12; i++) {
      for (const m of markers) {
        if (_deps.existsSync(path.join(dir, m))) return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return this.projectRoot;
  }

  /** Shut down every server and clear state. Idempotent. */
  async disposeAll() {
    this._disposed = true;
    const clients = [...this._servers.values()].map((e) => e.client);
    this._servers.clear();
    this._openDocs.clear();
    this._diagnostics.clear();
    this._diagMeta.clear();
    await Promise.all(clients.map((c) => c.stop().catch(() => {})));
  }

  get activeServerCount() {
    return this._servers.size;
  }

  /** Snapshot of running servers: `[{ serverId, root, pid }]` (for bench / doctor). */
  listServers() {
    const out = [];
    for (const entry of this._servers.values()) {
      out.push({
        serverId: entry.serverId,
        root: entry.root,
        pid: entry.client.pid,
      });
    }
    return out;
  }
}

// ---- position helpers (the ONLY place that converts between coordinate spaces) ----

/** 1-based user position → 0-based LSP position. */
export function toLspPosition({ line, col }) {
  return {
    line: Math.max(0, (line || 1) - 1),
    character: Math.max(0, (col || 1) - 1),
  };
}

/** 0-based LSP position → 1-based user position. */
export function fromLspPosition(pos) {
  return { line: (pos?.line || 0) + 1, col: (pos?.character || 0) + 1 };
}
