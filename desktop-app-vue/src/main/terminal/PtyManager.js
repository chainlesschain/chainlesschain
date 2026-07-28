/**
 * PtyManager — singleton, owns all in-process PTY sessions for the desktop
 * web-shell. Spawned by `web-shell-bootstrap.js` → consumed by
 * `terminal-handlers.js`.
 *
 * Design notes (see docs/design/Android_Remote_Terminal_Plan_A.md §4):
 *
 *   - node-pty is loaded LAZILY via `_deps.loadNodePty()` so the module
 *     can be required in unit tests / on machines without the native
 *     binding without crashing. Real spawn raises a clean error envelope
 *     ("pty_native_unavailable") that surfaces to the SPA.
 *   - Each session keeps its own RingBuffer (256 KiB default, in-memory
 *     only — see RingBuffer doc for rationale).
 *   - `EventEmitter` fans out `stdout` / `exit` events so handlers can
 *     translate them to WS envelopes without coupling to ws-cli-loader.
 *   - Idle kill: 24h default. Idle counter resets on stdin OR stdout.
 *   - Shell whitelist enforced at create-time (config) — unknown shell
 *     returns `shell_not_allowed`.
 *   - Dangerous-keyword stdin gating is NOT here; it's in
 *     terminal-handlers (which owns user-facing confirm UI). This class
 *     only owns the PTY mechanics.
 */

const EventEmitter = require("events");
const { randomUUID } = require("crypto");
const fs = require("node:fs");
const path = require("node:path");
const { RingBuffer } = require("./RingBuffer");
const {
  getDesktopProcessBroker,
  validateDesktopPtySandboxPolicy,
} = require("../process/desktop-process-broker");

const DEFAULT_CONFIG = Object.freeze({
  shellWhitelist: ["pwsh", "cmd", "bash", "wsl"],
  defaultShell: process.platform === "win32" ? "pwsh" : "bash",
  defaultCwd: null, // null → process.cwd()
  maxConcurrentSessions: 8,
  ringBufferBytes: 256 * 1024,
  idleKillMs: 24 * 60 * 60 * 1000,
});

// Map whitelisted shell name → resolved executable + args. node-pty needs a
// real path / command name to spawn. Login-shell flags ensure ~/.bashrc /
// ~/.profile load so user PATH (npm-global, cargo, brew etc.) is visible —
// otherwise `cc` / `claude` / other globally-installed CLIs are unreachable
// in the remote terminal (real-device E2E feedback, 2026-05-14).
function resolveShellCmd(shell, platform = process.platform) {
  if (platform === "win32") {
    if (shell === "cmd") {
      return { cmd: process.env.ComSpec || "cmd.exe", args: [] };
    }
    if (shell === "pwsh") {
      // pwsh auto-loads $PROFILE unless -NoProfile is passed; Windows PATH
      // already contains npm-global so cc/claude work out of the box.
      return { cmd: "pwsh.exe", args: [] };
    }
    if (shell === "wsl") {
      // wsl.exe with no args picks default distro + default user. To inherit
      // the user's PATH we force bash login shell explicitly.
      return { cmd: "wsl.exe", args: ["--", "bash", "-l"] };
    }
    if (shell === "bash") {
      // git-bash on Windows — -l = login shell, loads ~/.bash_profile.
      // PATH-resolved `bash.exe` often matches WSL's bash first (under
      // C:\Windows\System32\bash.exe), which logs into WSL as root user
      // and bypasses the dev's Windows PATH (node/npm-global → cc/claude
      // unreachable). Probe well-known git-bash install paths first.
      const fs = require("node:fs");
      const candidates = [
        process.env.GIT_BASH, // user override
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        process.env.LOCALAPPDATA
          ? `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`
          : null,
      ].filter(Boolean);
      for (const p of candidates) {
        try {
          if (fs.existsSync(p)) {
            return { cmd: p, args: ["-l"] };
          }
        } catch {
          /* keep probing */
        }
      }
      return { cmd: "bash.exe", args: ["-l"] }; // fallback to PATH
    }
  }
  // posix: pwsh/bash on PATH; -l on bash to load ~/.bashrc
  if (shell === "bash") {
    return { cmd: "bash", args: ["-l"] };
  }
  return { cmd: shell, args: [] };
}

function validatePinnedSandboxPolicy(policy) {
  try {
    validateDesktopPtySandboxPolicy(policy);
    return policy;
  } catch (cause) {
    const error = new TypeError("invalid_pty_sandbox_policy");
    error.code = "ERR_PTY_SANDBOX_POLICY_INVALID";
    error.sandboxReason = "invalid_sandbox_policy";
    error.sandboxFailClosed = true;
    error.cause = cause;
    throw error;
  }
}

function desktopBrokerUnavailable(policy) {
  const requiredBoundaries = [...(policy?.requiredBoundaries || [])];
  const error = new Error(
    `Desktop process broker is required for PTY sandbox boundaries: ${requiredBoundaries.join(", ")}`,
  );
  error.code = "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED";
  error.sandboxReason = "desktop_process_broker_unavailable";
  error.sandboxFailClosed = true;
  error.requiredBoundaries = requiredBoundaries;
  error.actualGuarantees = [];
  error.missingBoundaries = [...requiredBoundaries];
  error.sandboxBackend = null;
  return error;
}

function strongPtyBackendUnavailable(policy, cause = null) {
  const requiredBoundaries = [...(policy?.requiredBoundaries || [])];
  const error = new Error(
    `Desktop strong Linux PTY backend is unavailable for boundaries: ${requiredBoundaries.join(", ")}`,
  );
  error.code = "ERR_DESKTOP_PTY_STRONG_BACKEND_UNAVAILABLE";
  error.sandboxReason = "desktop_strong_pty_backend_unavailable";
  error.sandboxFailClosed = true;
  error.requiredBoundaries = requiredBoundaries;
  error.actualGuarantees = [];
  error.missingBoundaries = [...requiredBoundaries];
  error.sandboxBackend = null;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function ptyProjectBindingError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.projectBindingFailClosed = true;
  Object.assign(error, details);
  return error;
}

function canonicalDirectory(candidate, code, message) {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw ptyProjectBindingError(code, message);
  }
  try {
    const canonical = fs.realpathSync.native(path.resolve(candidate));
    if (!fs.statSync(canonical).isDirectory()) {
      throw new Error("not_a_directory");
    }
    return canonical;
  } catch (cause) {
    throw ptyProjectBindingError(code, message, { cause });
  }
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function normalizeProjectId(projectId) {
  return typeof projectId === "string" && projectId.trim() !== ""
    ? projectId.trim()
    : null;
}

function projectRootCandidate(project) {
  // `pc_root_path` is synchronized from remote clients and has no local
  // approval/provenance marker. It may help the compatibility resolver find
  // a DB row, but it must never become the executable root. Only the Desktop
  // project's local `root_path` is eligible here.
  return project.root_path ?? project.rootPath;
}

function hasUnattestedRemoteRootProvenance(project) {
  const sourcePeerId = project.source_peer_id ?? project.sourcePeerId;
  const pcRootPath = project.pc_root_path ?? project.pcRootPath;
  return (
    typeof sourcePeerId === "string" &&
    sourcePeerId.trim() !== "" &&
    typeof pcRootPath === "string" &&
    pcRootPath.trim() !== ""
  );
}

function isPromiseLike(value) {
  return Boolean(value && typeof value.then === "function");
}

class PtyManager extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {object} [opts.config] override default config
   * @param {object} [opts._deps] DI for unit tests
   * @param {() => any} [opts._deps.loadNodePty] returns node-pty-like module
   *   with `spawn(cmd, args, options)` → ptyProcess { pid, write, resize, kill,
   *   onData(cb), onExit(cb) }
   * @param {() => number} [opts._deps.now] clock for idle/test
   */
  constructor(opts = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
    const resolveSandboxPolicy =
      opts.resolveSandboxPolicy ?? opts._deps?.resolveSandboxPolicy ?? null;
    if (
      resolveSandboxPolicy !== null &&
      typeof resolveSandboxPolicy !== "function"
    ) {
      throw new TypeError("resolveSandboxPolicy must be a function or null");
    }
    const resolveProjectBinding =
      opts.resolveProjectBinding ?? opts._deps?.resolveProjectBinding ?? null;
    if (
      resolveProjectBinding !== null &&
      typeof resolveProjectBinding !== "function"
    ) {
      throw new TypeError("resolveProjectBinding must be a function or null");
    }
    this._requireProjectBinding = opts.requireProjectBinding === true;
    this._policyCwd = opts.policyCwd
      ? path.resolve(opts.policyCwd)
      : this._requireProjectBinding
        ? null
        : path.resolve(process.cwd());
    this._resolveSandboxPolicy = resolveSandboxPolicy;
    this._resolveProjectBinding = resolveProjectBinding;
    const issueLinuxWorkspaceSandboxExecutionContract =
      opts.issueLinuxWorkspaceSandboxExecutionContract ??
      opts._deps?.issueLinuxWorkspaceSandboxExecutionContract ??
      null;
    if (
      issueLinuxWorkspaceSandboxExecutionContract !== null &&
      typeof issueLinuxWorkspaceSandboxExecutionContract !== "function"
    ) {
      throw new TypeError(
        "issueLinuxWorkspaceSandboxExecutionContract must be a function or null",
      );
    }
    const spawnLinuxStrongPty =
      opts.spawnLinuxStrongPty ?? opts._deps?.spawnLinuxStrongPty ?? null;
    if (
      spawnLinuxStrongPty !== null &&
      typeof spawnLinuxStrongPty !== "function"
    ) {
      throw new TypeError("spawnLinuxStrongPty must be a function or null");
    }
    this._deps = {
      loadNodePty: opts._deps?.loadNodePty || (() => require("node-pty")),
      spawnPty: opts._deps?.spawnPty || null,
      issueLinuxWorkspaceSandboxExecutionContract,
      spawnLinuxStrongPty,
      getProcessBroker:
        opts._deps?.getProcessBroker || (() => getDesktopProcessBroker()),
      platform: opts._deps?.platform || (() => process.platform),
      now: opts._deps?.now || (() => Date.now()),
    };
    /** @type {Map<string, PtySession>} */
    this._sessions = new Map();
    this._idleTimer = null;
    this._stopped = false;
  }

  _resolveCreateBinding(req) {
    const requestedProjectId = normalizeProjectId(req.projectId);
    if (
      req.cwd !== undefined &&
      req.cwd !== null &&
      typeof req.cwd !== "string"
    ) {
      throw ptyProjectBindingError(
        "ERR_PTY_EXECUTION_CWD_INVALID",
        "terminal_execution_cwd_invalid",
      );
    }
    if (!this._requireProjectBinding && !requestedProjectId) {
      const cwd = req.cwd || this.config.defaultCwd || process.cwd();
      return {
        projectId: null,
        workspaceCwd: this._policyCwd,
        executionCwd: cwd,
      };
    }

    if (!this._resolveProjectBinding) {
      throw ptyProjectBindingError(
        "ERR_PTY_PROJECT_AUTHORITY_UNAVAILABLE",
        "terminal_project_selector_unavailable",
      );
    }
    const project = this._resolveProjectBinding({
      projectId: requestedProjectId,
      legacyCwd: req.cwd,
    });
    if (isPromiseLike(project)) {
      throw ptyProjectBindingError(
        "ERR_PTY_PROJECT_AUTHORITY_ASYNC",
        "terminal_project_selector_must_be_synchronous",
      );
    }
    if (!project || typeof project !== "object") {
      throw ptyProjectBindingError(
        "ERR_PTY_DB_PROJECT_BINDING_REQUIRED",
        "database_project_binding_required",
      );
    }
    const projectId = normalizeProjectId(project.id);
    if (!projectId) {
      throw ptyProjectBindingError(
        "ERR_PTY_PROJECT_BINDING_INVALID",
        "terminal_project_record_missing_id",
      );
    }
    if (requestedProjectId && projectId !== requestedProjectId) {
      throw ptyProjectBindingError(
        "ERR_PTY_PROJECT_BINDING_INVALID",
        "terminal_project_record_id_mismatch",
      );
    }
    if (
      project.deleted !== undefined &&
      project.deleted !== null &&
      Number(project.deleted) !== 0
    ) {
      throw ptyProjectBindingError(
        "ERR_PTY_PROJECT_BINDING_INVALID",
        "terminal_project_is_deleted",
      );
    }
    // Existing schema has no "locally approved root" provenance bit.
    // Remote-sourced rows with pc_root_path therefore cannot prove that
    // root_path was chosen locally (legacy sync may copy pc_root_path into
    // root_path). Fail closed until such a marker/migration exists.
    if (hasUnattestedRemoteRootProvenance(project)) {
      throw ptyProjectBindingError(
        "ERR_PTY_PROJECT_ROOT_PROVENANCE_UNATTESTED",
        "terminal_project_root_provenance_unattested",
        { projectId },
      );
    }

    const workspaceCwd = canonicalDirectory(
      projectRootCandidate(project),
      "ERR_PTY_PROJECT_ROOT_INVALID",
      "terminal_project_root_invalid",
    );
    // Without projectId, `cwd` is accepted only as the legacy Android lookup
    // selector. It is not reused as an execution-directory claim.
    const requestedCwd =
      requestedProjectId && req.cwd
        ? path.isAbsolute(req.cwd)
          ? req.cwd
          : path.resolve(workspaceCwd, req.cwd)
        : workspaceCwd;
    const executionCwd = canonicalDirectory(
      requestedCwd,
      "ERR_PTY_EXECUTION_CWD_INVALID",
      "terminal_execution_cwd_invalid",
    );
    if (!isWithinRoot(workspaceCwd, executionCwd)) {
      throw ptyProjectBindingError(
        "ERR_PTY_EXECUTION_CWD_OUTSIDE_PROJECT",
        "terminal_execution_cwd_outside_database_project",
        { projectId },
      );
    }

    return {
      projectId,
      workspaceCwd,
      executionCwd,
    };
  }

  _resolvePolicy(workspaceCwd, executionCwd) {
    if (!this._resolveSandboxPolicy) {
      return null;
    }
    return validatePinnedSandboxPolicy(
      this._resolveSandboxPolicy({
        workspaceCwd,
        executionCwd,
      }),
    );
  }

  _normalizeProjectScope(projectId) {
    const requestedProjectId = normalizeProjectId(projectId);
    if (this._requireProjectBinding && !requestedProjectId) {
      throw ptyProjectBindingError(
        "ERR_PTY_PROJECT_SCOPE_REQUIRED",
        "terminal_project_scope_required",
      );
    }
    return requestedProjectId;
  }

  _assertProjectScope(session, projectId) {
    const requestedProjectId = this._normalizeProjectScope(projectId);
    if (
      requestedProjectId &&
      (!session.projectId || session.projectId !== requestedProjectId)
    ) {
      // Do not reveal whether a guessed cross-project session id exists.
      throw ptyProjectBindingError(
        "ERR_PTY_SESSION_PROJECT_MISMATCH",
        "terminal_session_not_found_in_project",
      );
    }
  }

  /**
   * @param {object} req
   * @param {string} [req.shell]
   * @param {string} [req.projectId]
   * @param {string} [req.cwd]
   * @param {Record<string,string>} [req.env]
   * @param {number} [req.cols]
   * @param {number} [req.rows]
   * @returns {{ sessionId: string, pid: number, shell: string, projectId: string|null, cwd: string, createdAt: number }}
   */
  create(req = {}) {
    if (this._stopped) {
      throw new Error("pty_manager_stopped");
    }
    // Count only LIVE sessions against the cap. A just-exited session lingers
    // in _sessions for ~60s before the reaper removes it (see onExit), so
    // counting `_sessions.size` would spuriously reject new sessions right
    // after a client closes shells.
    let aliveCount = 0;
    for (const s of this._sessions.values()) {
      if (s.alive) {
        aliveCount++;
      }
    }
    if (aliveCount >= this.config.maxConcurrentSessions) {
      throw new Error("max_concurrent_sessions_exceeded");
    }
    const shell = req.shell || this.config.defaultShell;
    if (!this.config.shellWhitelist.includes(shell)) {
      throw new Error("shell_not_allowed");
    }

    // projectId / legacy cwd select a main-process database record. Its local
    // canonical root fixes the initial execution/policy root. This does not
    // trust any renderer/WS cwd as workspace authority. When the strong Linux
    // backend is active, the canonical root is mounted into an otherwise
    // empty filesystem namespace, so later interactive `cd` cannot reveal a
    // different host workspace.
    const binding = this._resolveCreateBinding(req);
    const cwd = binding.executionCwd;
    const sandboxPolicy = this._resolvePolicy(binding.workspaceCwd, cwd);
    const platform = this._deps.platform();

    const cols = Number.isFinite(req.cols) ? req.cols : 80;
    const rows = Number.isFinite(req.rows) ? req.rows : 24;
    const { cmd, args } = resolveShellCmd(shell, platform);

    // req.env arrives from a remote WS frame; only merge a plain object, else a
    // string/array would spread into garbage numeric env keys.
    const extraEnv =
      req.env && typeof req.env === "object" && !Array.isArray(req.env)
        ? req.env
        : {};
    const nativeSpawnOptions = {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: { ...process.env, ...extraEnv },
    };
    const brokerSpawnOptions = {
      ...nativeSpawnOptions,
      origin: "terminal:pty",
      policy: "allow",
      scope: "terminal",
      shell: false,
      ...(sandboxPolicy ? { sandboxPolicy } : {}),
    };
    let effectiveBrokerSpawnOptions = brokerSpawnOptions;
    let spawnPty;
    if (sandboxPolicy && platform === "linux") {
      const issueContract =
        this._deps.issueLinuxWorkspaceSandboxExecutionContract;
      spawnPty = this._deps.spawnLinuxStrongPty;
      if (!issueContract || !spawnPty) {
        throw strongPtyBackendUnavailable(sandboxPolicy);
      }
      let contract;
      try {
        contract = issueContract(
          cmd,
          args,
          brokerSpawnOptions,
          binding.workspaceCwd,
          { pty: true },
        );
      } catch (cause) {
        if (cause?.code === "ERR_DESKTOP_PTY_STRONG_BACKEND_UNAVAILABLE") {
          throw strongPtyBackendUnavailable(sandboxPolicy, cause);
        }
        if (cause?.sandboxFailClosed) {
          throw cause;
        }
        throw strongPtyBackendUnavailable(sandboxPolicy, cause);
      }
      if (!contract || typeof contract !== "object") {
        throw strongPtyBackendUnavailable(sandboxPolicy);
      }
      effectiveBrokerSpawnOptions = {
        ...brokerSpawnOptions,
        sandboxExecutionContract: contract,
      };
    } else {
      const desktopBroker = this._deps.getProcessBroker();
      const brokerSpawnPty =
        typeof desktopBroker?.spawnPty === "function"
          ? desktopBroker.spawnPty.bind(desktopBroker)
          : null;
      if (sandboxPolicy && !brokerSpawnPty) {
        throw desktopBrokerUnavailable(sandboxPolicy);
      }
      // A test-only/custom spawn seam may preserve legacy no-policy behavior,
      // but can never stand in for the Desktop broker when boundaries are
      // required. Strict non-Linux policy always reaches the auditable
      // fail-closed Desktop broker path.
      spawnPty = brokerSpawnPty || this._deps.spawnPty;
    }

    let pty;
    try {
      pty = this._deps.loadNodePty();
    } catch {
      const err = new Error("pty_native_unavailable");
      err.cause = "node-pty failed to load (native binding missing)";
      throw err;
    }

    const proc = spawnPty
      ? spawnPty(pty, cmd, args, effectiveBrokerSpawnOptions)
      : pty.spawn(cmd, args, nativeSpawnOptions);

    const sessionId = randomUUID();
    const session = new PtySession({
      id: sessionId,
      shell,
      cwd,
      projectId: binding.projectId,
      cols,
      rows,
      proc,
      createdAt: this._deps.now(),
      ringBuffer: new RingBuffer({ maxBytes: this.config.ringBufferBytes }),
    });
    this._sessions.set(sessionId, session);

    proc.onData((data) => {
      const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
      const seq = session.ringBuffer.push(buf);
      session.lastActivityAt = this._deps.now();
      this.emit("stdout", {
        sessionId,
        projectId: session.projectId,
        data: buf,
        seq,
      });
    });

    proc.onExit(({ exitCode, signal }) => {
      session.alive = false;
      session.exitCode = exitCode ?? null;
      session.signal = signal ?? null;
      this.emit("exit", {
        sessionId,
        projectId: session.projectId,
        exitCode: session.exitCode,
        signal: session.signal,
      });
      // Retain session for 60s so reconnecting clients can pull the tail
      // via `terminal.history` before the manager evicts it.
      setTimeout(() => {
        if (this._sessions.get(sessionId) === session) {
          this._sessions.delete(sessionId);
        }
      }, 60 * 1000).unref?.();
    });

    this._ensureIdleSweeper();

    return {
      sessionId,
      pid: proc.pid,
      shell,
      projectId: session.projectId,
      cwd: session.cwd,
      createdAt: session.createdAt,
    };
  }

  /**
   * @param {string} sessionId
   * @param {Buffer | string} data
   * @param {string|null} [projectId]
   */
  write(sessionId, data, projectId = null) {
    this._normalizeProjectScope(projectId);
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    this._assertProjectScope(session, projectId);
    if (!session.alive) {
      throw new Error("session_not_alive");
    }
    const str = Buffer.isBuffer(data) ? data.toString("utf-8") : data;
    session.proc.write(str);
    session.lastActivityAt = this._deps.now();
  }

  /**
   * @param {string} sessionId
   * @param {number} cols
   * @param {number} rows
   * @param {string|null} [projectId]
   */
  resize(sessionId, cols, rows, projectId = null) {
    this._normalizeProjectScope(projectId);
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    this._assertProjectScope(session, projectId);
    if (!session.alive) {
      throw new Error("session_not_alive");
    }
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      throw new Error("invalid_dimensions");
    }
    session.proc.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }

  /**
   * @param {string} sessionId
   * @param {string|null} [projectId]
   */
  close(sessionId, projectId = null) {
    this._normalizeProjectScope(projectId);
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    this._assertProjectScope(session, projectId);
    if (session.alive) {
      try {
        session.proc.kill();
      } catch {
        // Ignore — onExit handler will mark it dead.
      }
    }
  }

  /**
   * @param {string|null} [projectId]
   * @returns {Array<{ id: string, shell: string, projectId: string|null, cwd: string, createdAt: number, alive: boolean, lastSeq: number }>}
   */
  list(projectId = null) {
    const requestedProjectId = this._normalizeProjectScope(projectId);
    const out = [];
    for (const s of this._sessions.values()) {
      if (requestedProjectId && s.projectId !== requestedProjectId) {
        continue;
      }
      out.push({
        id: s.id,
        shell: s.shell,
        projectId: s.projectId,
        cwd: s.cwd,
        createdAt: s.createdAt,
        alive: s.alive,
        lastSeq: s.ringBuffer.lastSeq,
      });
    }
    return out;
  }

  /**
   * @param {string} sessionId
   * @param {number} [fromSeq]
   * @param {string|null} [projectId]
   */
  history(sessionId, fromSeq = 0, projectId = null) {
    this._normalizeProjectScope(projectId);
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    this._assertProjectScope(session, projectId);
    return session.ringBuffer.since(fromSeq);
  }

  _ensureIdleSweeper() {
    if (this._idleTimer) {
      return;
    }
    // Sweep hourly; cheap loop, only acts on truly idle sessions.
    this._idleTimer = setInterval(() => this._sweepIdle(), 60 * 60 * 1000);
    this._idleTimer.unref?.();
  }

  _sweepIdle() {
    const now = this._deps.now();
    for (const session of this._sessions.values()) {
      if (!session.alive) {
        continue;
      }
      if (now - session.lastActivityAt > this.config.idleKillMs) {
        try {
          session.proc.kill();
        } catch {
          /* onExit will clean up */
        }
      }
    }
  }

  /**
   * Kill all sessions and stop accepting new ones. Called on app shutdown.
   */
  shutdown() {
    this._stopped = true;
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
    for (const session of this._sessions.values()) {
      if (session.alive) {
        try {
          session.proc.kill();
        } catch {
          /* best effort */
        }
      }
    }
  }

  /**
   * Test-only: number of sessions currently tracked (alive + lingering).
   */
  get _sessionCount() {
    return this._sessions.size;
  }

  get requiresProjectScope() {
    return this._requireProjectBinding;
  }
}

class PtySession {
  constructor({
    id,
    shell,
    cwd,
    projectId,
    cols,
    rows,
    proc,
    createdAt,
    ringBuffer,
  }) {
    this.id = id;
    this.shell = shell;
    this.cwd = cwd;
    this.projectId = projectId;
    this.cols = cols;
    this.rows = rows;
    this.proc = proc;
    this.createdAt = createdAt;
    this.ringBuffer = ringBuffer;
    this.alive = true;
    this.exitCode = null;
    this.signal = null;
    this.lastActivityAt = createdAt;
  }
}

module.exports = { PtyManager, DEFAULT_CONFIG };
