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

// ─────────────────────────────────────────────────────────────────────
// Structured-task scheduler helpers (Phase B — ADR §8.3).
//
// These are pure functions exported for direct unit testing. They do not
// touch the filesystem or spawn processes. See docs/design/modules/
// 81_轻量多Agent编排系统.md for the design rationale.
// ─────────────────────────────────────────────────────────────────────

/**
 * True if two filesystem scope paths claim overlapping subtrees. Overlap
 * means one is an ancestor of the other (including identity). Paths are
 * normalized to forward slashes with trailing separator stripped.
 */
function scopePathsOverlap(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const na = a.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  const nb = b.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

/**
 * True if two structured assignments share any overlapping scope path.
 * Assignments without a scopePaths array (legacy shape) are treated as
 * "no claim" so they do not force serialization — opting out by omission.
 */
function hasScopeConflict(a, b) {
  const sa = Array.isArray(a?.scopePaths) ? a.scopePaths : [];
  const sb = Array.isArray(b?.scopePaths) ? b.scopePaths : [];
  if (sa.length === 0 || sb.length === 0) {
    return false;
  }
  for (const x of sa) {
    for (const y of sb) {
      if (scopePathsOverlap(x, y)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Topological waves of a structured task set. Each wave is an array of
 * assignments whose dependencies are all satisfied by prior waves. Waves
 * run as sequential barriers.
 *
 * Input assignments must carry `taskId`. `dependsOn` entries pointing at
 * tasks that are not in the input set are ignored (treated as satisfied).
 *
 * Throws on cycles.
 */
function topoWaves(assignments) {
  const byId = new Map();
  for (const a of assignments) {
    if (!a || !a.taskId) {
      continue;
    }
    byId.set(a.taskId, a);
  }
  if (byId.size === 0) {
    return [];
  }
  const remainingDeps = new Map();
  for (const [id, a] of byId) {
    const deps = (a.dependsOn || []).filter((d) => byId.has(d));
    remainingDeps.set(id, new Set(deps));
  }
  const waves = [];
  const placed = new Set();
  while (placed.size < byId.size) {
    const wave = [];
    for (const [id, deps] of remainingDeps) {
      if (placed.has(id)) {
        continue;
      }
      if (deps.size === 0) {
        wave.push(byId.get(id));
      }
    }
    if (wave.length === 0) {
      const pending = [...remainingDeps.keys()].filter((id) => !placed.has(id));
      throw new Error(
        `topoWaves: dependency cycle detected among tasks [${pending.join(", ")}]`,
      );
    }
    waves.push(wave);
    for (const node of wave) {
      placed.add(node.taskId);
    }
    for (const [id, deps] of remainingDeps) {
      if (placed.has(id)) {
        continue;
      }
      for (const placedId of placed) {
        deps.delete(placedId);
      }
    }
  }
  return waves;
}

/**
 * Group assignments within a single wave into scope-conflict serialization
 * groups. Assignments in the same group share at least one overlapping
 * scope path (directly or transitively) and must run sequentially.
 * Different groups have no scope conflicts and run in parallel.
 *
 * Implementation: union-find over pairwise hasScopeConflict edges.
 */
function scopeGroups(wave) {
  if (!Array.isArray(wave) || wave.length === 0) {
    return [];
  }
  const parent = new Map();
  const find = (x) => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      parent.set(cur, parent.get(parent.get(cur)));
      cur = parent.get(cur);
    }
    return cur;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  };
  for (const t of wave) {
    parent.set(t.taskId, t.taskId);
  }
  for (let i = 0; i < wave.length; i++) {
    for (let j = i + 1; j < wave.length; j++) {
      if (hasScopeConflict(wave[i], wave[j])) {
        union(wave[i].taskId, wave[j].taskId);
      }
    }
  }
  const groups = new Map();
  for (const t of wave) {
    const root = find(t.taskId);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root).push(t);
  }
  return [...groups.values()];
}

function isStructuredAssignments(assignments) {
  return (
    Array.isArray(assignments) &&
    assignments.some(
      (a) =>
        a &&
        (a.taskId || Array.isArray(a.dependsOn) || Array.isArray(a.scopePaths)),
    )
  );
}

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

    // Phase B: auto-select the structured scheduler when assignments carry
    // taskId / dependsOn / scopePaths. Legacy plan-bucket callers keep the
    // original parallel-all path unchanged.
    if (isStructuredAssignments(assignments)) {
      return await this._dispatchStructured({
        projectRoot,
        sessionId,
        assignments,
      });
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

  /**
   * Structured dispatch: topological waves + intra-wave scope-group
   * serialization. Failed dependencies block downstream tasks with a
   * synthetic "blocked by failed dependency" result (they are not
   * dispatched to a real child). Results are returned in the same order
   * as the input `assignments`.
   */
  async _dispatchStructured({ projectRoot, sessionId, assignments }) {
    const waves = topoWaves(assignments);
    const resultsById = new Map();

    for (const wave of waves) {
      const groups = scopeGroups(wave);
      await Promise.all(
        groups.map(async (group) => {
          // Each conflict group runs its tasks sequentially. Groups run
          // in parallel. We do not enforce maxSize on the wave width —
          // the planner is expected to size the task set; enforcing it
          // here would silently drop work.
          for (const assignment of group) {
            const unmetDeps = (assignment.dependsOn || []).filter((id) => {
              const r = resultsById.get(id);
              return r && !r.success;
            });
            if (unmetDeps.length > 0) {
              resultsById.set(assignment.taskId, {
                taskId: assignment.taskId,
                memberIdx: assignment.memberIdx,
                success: false,
                error: `blocked by failed dependency: ${unmetDeps.join(", ")}`,
                progressEvents: [],
                blocked: true,
              });
              continue;
            }
            const result = await this._runSingle({
              projectRoot,
              sessionId,
              assignment,
            });
            resultsById.set(assignment.taskId, {
              taskId: assignment.taskId,
              ...result,
            });
          }
        }),
      );
    }

    return assignments.map(
      (a) =>
        resultsById.get(a.taskId) || {
          taskId: a.taskId,
          memberIdx: a.memberIdx,
          success: false,
          error: "not scheduled",
          progressEvents: [],
        },
    );
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

module.exports = {
  SubRuntimePool,
  _deps,
  wrapChild,
  HARD_CAP,
  DEFAULT_MAX,
  // Phase B scheduler helpers — exported for unit tests and external reuse.
  scopePathsOverlap,
  hasScopeConflict,
  topoWaves,
  scopeGroups,
  isStructuredAssignments,
};
