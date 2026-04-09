/**
 * SubRuntimePool — real multi-process fan-out for `$team`.
 *
 * Spawns N headless Electron-main child processes (same binary, but with
 * ELECTRON_RUN_AS_NODE=1 so Electron behaves as a node runtime). Each child
 * runs `src/main/sub-runtime/index.js` and communicates over a JSON-lines
 * stdin/stdout protocol.
 *
 * Design constraints:
 *   - Pool size is bounded (default max = 4, hard cap 6 — matches $team).
 *   - Each dispatched assignment goes to its own child so we get true OS
 *     isolation (a crash in one member cannot corrupt the others).
 *   - Children write to *member* session dirs only (see SessionStateManager
 *     member APIs). They never touch the parent session files — the parent
 *     aggregates their progress through stdout events.
 *   - All side-effect entry points are routed through `_deps` so Vitest can
 *     override them without the `vi.mock("child_process")` trap that plagues
 *     CJS modules inlined into the forks pool.
 */

const path = require("path");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

const DEFAULT_MAX = 4;
const HARD_CAP = 6;
const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_RUN_TIMEOUT_MS = 60_000;

const subRuntimeEntry = path.resolve(
  __dirname,
  "..",
  "..",
  "sub-runtime",
  "index.js",
);

// Test injection seam. DO NOT call `spawn` directly anywhere below.
const _deps = {
  spawn,
  entryFile: subRuntimeEntry,
  now: () => Date.now(),
};

function waitForReady(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onLine = (msg) => {
      // child.on("line") already emits a parsed object.
      if (msg && msg.type === "ready") {
        settled = true;
        clearTimeout(timer);
        child.removeListener("line", onLine);
        resolve();
      }
    };
    child.on("line", onLine);
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.removeListener("line", onLine);
      reject(new Error(`sub-runtime ready timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer.unref) {
      timer.unref();
    }
  });
}

/**
 * Wraps a raw child_process.ChildProcess with a JSON-lines event emitter.
 * Emits `line` (parsed event object) and `exit`.
 */
function wrapChild(rawChild) {
  const emitter = new EventEmitter();
  let buffer = "";
  rawChild.stdout?.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      try {
        const msg = JSON.parse(line);
        emitter.emit("line", msg);
      } catch (err) {
        emitter.emit("parse-error", { line, error: err.message });
      }
    }
  });
  rawChild.stderr?.on("data", (chunk) => {
    logger.warn(
      `[sub-runtime-pool] child stderr: ${chunk.toString("utf8").trim()}`,
    );
  });
  rawChild.on("exit", (code, signal) => {
    emitter.emit("exit", { code, signal });
  });
  emitter.raw = rawChild;
  emitter.send = (obj) => {
    if (rawChild.stdin && !rawChild.stdin.destroyed) {
      rawChild.stdin.write(JSON.stringify(obj) + "\n");
    }
  };
  emitter.kill = (signal = "SIGTERM") => {
    try {
      rawChild.kill(signal);
    } catch {
      /* ignore */
    }
  };
  return emitter;
}

class SubRuntimePool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxSize = Math.min(
      Math.max(1, options.maxSize || DEFAULT_MAX),
      HARD_CAP,
    );
    this.readyTimeoutMs = options.readyTimeoutMs || DEFAULT_READY_TIMEOUT_MS;
    this.runTimeoutMs = options.runTimeoutMs || DEFAULT_RUN_TIMEOUT_MS;
    this.children = []; // wrapped children currently alive
    this._shuttingDown = false;
  }

  /**
   * Spawn exactly one new headless Electron-main child and wait for its
   * "ready" event.
   */
  async _spawnOne() {
    const raw = _deps.spawn(process.execPath, [_deps.entryFile], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        FORCE_COLOR: "0",
      },
    });
    const child = wrapChild(raw);
    await waitForReady(child, this.readyTimeoutMs);
    this.children.push(child);
    this.emit("child-spawned", { pid: raw.pid });
    return child;
  }

  /**
   * Run a batch of assignments, one per freshly-spawned sub-runtime.
   * Returns [{ memberId, success, progressEvents, error? }, ...] in the
   * same order as `assignments`.
   *
   * `assignments` is the list from $team handler:
   *   [{ memberIdx, role, steps: [...] }, ...]
   */
  async dispatch({ projectRoot, sessionId, assignments }) {
    if (!projectRoot || !sessionId || !Array.isArray(assignments)) {
      throw new Error(
        "SubRuntimePool.dispatch: projectRoot, sessionId, assignments required",
      );
    }
    if (assignments.length === 0) {
      return [];
    }
    if (assignments.length > this.maxSize) {
      throw new Error(
        `SubRuntimePool: assignment count ${assignments.length} exceeds maxSize ${this.maxSize}`,
      );
    }

    const results = await Promise.all(
      assignments.map((assignment) =>
        this._runSingle({ projectRoot, sessionId, assignment }),
      ),
    );
    return results;
  }

  async _runSingle({ projectRoot, sessionId, assignment }) {
    let child;
    try {
      child = await this._spawnOne();
    } catch (err) {
      return {
        memberIdx: assignment.memberIdx,
        success: false,
        error: `spawn failed: ${err.message}`,
        progressEvents: [],
      };
    }

    const progressEvents = [];
    const result = await new Promise((resolve) => {
      let settled = false;
      const finish = (obj) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        child.removeAllListeners("line");
        child.removeAllListeners("exit");
        resolve(obj);
      };
      const timer = setTimeout(() => {
        finish({
          memberIdx: assignment.memberIdx,
          success: false,
          error: `run timeout after ${this.runTimeoutMs}ms`,
          progressEvents,
        });
      }, this.runTimeoutMs);
      if (timer.unref) {
        timer.unref();
      }

      child.on("line", (msg) => {
        if (msg.type === "progress") {
          progressEvents.push(msg);
          this.emit("progress", { assignment, msg });
        } else if (msg.type === "done") {
          finish({
            memberIdx: assignment.memberIdx,
            memberId: msg.memberId,
            success: true,
            progressEvents,
          });
        } else if (msg.type === "error") {
          finish({
            memberIdx: assignment.memberIdx,
            memberId: msg.memberId,
            success: false,
            error: msg.error,
            progressEvents,
          });
        }
      });
      child.on("exit", ({ code, signal }) => {
        finish({
          memberIdx: assignment.memberIdx,
          success: false,
          error: `child exited before done (code=${code}, signal=${signal})`,
          progressEvents,
        });
      });

      child.send({
        cmd: "run",
        projectRoot,
        sessionId,
        assignment,
      });
    });

    // Always ask the child to exit after a single assignment — one-shot
    // sub-runtimes keep the pool cold-starting but make failure isolation
    // trivial (no state carries over between dispatches).
    try {
      child.send({ cmd: "shutdown" });
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (!child.raw.killed) {
        child.kill("SIGTERM");
      }
    }, 500).unref?.();
    this.children = this.children.filter((c) => c !== child);

    return result;
  }

  async shutdown() {
    if (this._shuttingDown) {
      return;
    }
    this._shuttingDown = true;
    for (const child of this.children) {
      try {
        child.send({ cmd: "shutdown" });
      } catch {
        /* ignore */
      }
    }
    // Best-effort hard kill after a grace period.
    setTimeout(() => {
      for (const child of this.children) {
        if (!child.raw.killed) {
          child.kill("SIGKILL");
        }
      }
    }, 1000).unref?.();
    this.children = [];
  }
}

module.exports = { SubRuntimePool, _deps, wrapChild, HARD_CAP, DEFAULT_MAX };
