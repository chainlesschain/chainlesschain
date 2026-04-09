/**
 * SessionStateManager — persistent workflow state for Coding Agent sessions.
 *
 * Layout (per project):
 *   <projectRoot>/.chainlesschain/sessions/<sessionId>/
 *     ├── intent.md     ($deep-interview output)
 *     ├── plan.md       ($ralplan output, frontmatter: approved: true|false)
 *     ├── tasks.json    structured task graph (scopePaths + dependsOn)
 *     ├── progress.log  ($ralph / $team append-only execution log)
 *     ├── verify.json   verification evidence (checks + status)
 *     ├── summary.md    final completion summary (gated on verify.json)
 *     ├── artifacts/    test reports / diffs / screenshots
 *     └── mode.json     { stage, updatedAt, retries, maxRetries }
 *
 * Inspired by oh-my-codex's `.omx/` session state layer, adapted to the
 * ChainlessChain Coding Agent runtime. Files are plain text / markdown so
 * users can inspect and hand-edit them.
 *
 * See docs/design/modules/81_轻量多Agent编排系统.md for the 5-stage
 * canonical workflow (intake → plan → execute → verify → complete | fix-loop | failed).
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../utils/logger.js");

const STAGES = Object.freeze({
  INTAKE: "intake",
  INTENT: "intent",
  PLAN: "plan",
  EXECUTE: "execute",
  VERIFY: "verify",
  FIX_LOOP: "fix-loop",
  COMPLETE: "complete",
  FAILED: "failed",
  // Backward compatibility: "done" is kept as an alias used by the Phase 2
  // $team handler. New code should prefer COMPLETE (gated) or FAILED.
  DONE: "done",
});

const DEFAULT_MAX_RETRIES = 3;

const _deps = { fs };

function nowIso() {
  return new Date().toISOString();
}

function safeSessionId(id) {
  if (!id || typeof id !== "string") {
    throw new Error("SessionStateManager: sessionId is required");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(
      `SessionStateManager: sessionId must match [A-Za-z0-9._-]+, got "${id}"`,
    );
  }
  return id;
}

class SessionStateManager {
  constructor(options = {}) {
    if (!options.projectRoot) {
      throw new Error("SessionStateManager: projectRoot is required");
    }
    this.projectRoot = options.projectRoot;
    this.rootDir = path.join(this.projectRoot, ".chainlesschain", "sessions");
  }

  sessionDir(sessionId) {
    return path.join(this.rootDir, safeSessionId(sessionId));
  }

  ensureSession(sessionId) {
    const dir = this.sessionDir(sessionId);
    _deps.fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ── intent ────────────────────────────────────────────────────────
  writeIntent(sessionId, { goal, clarifications = [], nonGoals = [] }) {
    const dir = this.ensureSession(sessionId);
    const body = [
      "# Intent",
      "",
      `**Session:** ${sessionId}`,
      `**Created:** ${nowIso()}`,
      "",
      "## Goal",
      "",
      goal || "_(not provided)_",
      "",
      "## Clarifications",
      "",
      clarifications.length
        ? clarifications.map((c) => `- ${c}`).join("\n")
        : "_(none yet)_",
      "",
      "## Non-Goals",
      "",
      nonGoals.length
        ? nonGoals.map((n) => `- ${n}`).join("\n")
        : "_(none yet)_",
      "",
    ].join("\n");
    const file = path.join(dir, "intent.md");
    _deps.fs.writeFileSync(file, body, "utf-8");
    this._setStage(sessionId, STAGES.INTENT);
    return file;
  }

  readIntent(sessionId) {
    const file = path.join(this.sessionDir(sessionId), "intent.md");
    if (!_deps.fs.existsSync(file)) {
      return null;
    }
    return _deps.fs.readFileSync(file, "utf-8");
  }

  // ── plan ──────────────────────────────────────────────────────────
  writePlan(
    sessionId,
    { title, steps = [], tradeoffs = [], approved = false },
  ) {
    if (!this.readIntent(sessionId)) {
      throw new Error(
        `SessionStateManager: cannot write plan before intent exists for session "${sessionId}" — run $deep-interview first`,
      );
    }
    const dir = this.ensureSession(sessionId);
    const body = [
      "---",
      `session: ${sessionId}`,
      `approved: ${approved ? "true" : "false"}`,
      `updated: ${nowIso()}`,
      "---",
      "",
      `# Plan: ${title || "(untitled)"}`,
      "",
      "## Steps",
      "",
      steps.length
        ? steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
        : "_(none)_",
      "",
      "## Tradeoffs",
      "",
      tradeoffs.length ? tradeoffs.map((t) => `- ${t}`).join("\n") : "_(none)_",
      "",
    ].join("\n");
    const file = path.join(dir, "plan.md");
    _deps.fs.writeFileSync(file, body, "utf-8");
    this._setStage(sessionId, STAGES.PLAN);
    return file;
  }

  readPlan(sessionId) {
    const file = path.join(this.sessionDir(sessionId), "plan.md");
    if (!_deps.fs.existsSync(file)) {
      return null;
    }
    const raw = _deps.fs.readFileSync(file, "utf-8");
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
    const meta = {};
    if (fm) {
      for (const line of fm[1].split("\n")) {
        const m = line.match(/^(\w+):\s*(.+)$/);
        if (m) {
          meta[m[1]] = m[2].trim();
        }
      }
    }
    return {
      raw,
      approved: meta.approved === "true",
      updated: meta.updated || null,
    };
  }

  approvePlan(sessionId) {
    const plan = this.readPlan(sessionId);
    if (!plan) {
      throw new Error(
        `SessionStateManager: no plan.md for session "${sessionId}" — run $ralplan first`,
      );
    }
    const updated = plan.raw
      .replace(/^approved:\s*\w+/m, "approved: true")
      .replace(/^updated:\s*.+$/m, `updated: ${nowIso()}`);
    const file = path.join(this.sessionDir(sessionId), "plan.md");
    _deps.fs.writeFileSync(file, updated, "utf-8");
    return file;
  }

  // ── progress ──────────────────────────────────────────────────────
  appendProgress(sessionId, entry) {
    const plan = this.readPlan(sessionId);
    if (!plan) {
      throw new Error(
        `SessionStateManager: cannot append progress before plan exists for session "${sessionId}"`,
      );
    }
    if (!plan.approved) {
      throw new Error(
        `SessionStateManager: plan for session "${sessionId}" is not approved — run $ralplan and approve before executing`,
      );
    }
    const dir = this.ensureSession(sessionId);
    const file = path.join(dir, "progress.log");
    const line = `[${nowIso()}] ${entry}\n`;
    _deps.fs.appendFileSync(file, line, "utf-8");
    this._setStage(sessionId, STAGES.EXECUTE);
    return file;
  }

  readProgress(sessionId) {
    const file = path.join(this.sessionDir(sessionId), "progress.log");
    if (!_deps.fs.existsSync(file)) {
      return "";
    }
    return _deps.fs.readFileSync(file, "utf-8");
  }

  // ── mode / stage tracking ─────────────────────────────────────────
  /**
   * Merge-write mode.json. Preserves fields like `retries` across stage
   * transitions so fix-loop counters survive re-entry.
   */
  _updateMode(sessionId, patch) {
    try {
      const file = path.join(this.sessionDir(sessionId), "mode.json");
      let current = {};
      if (_deps.fs.existsSync(file)) {
        try {
          current = JSON.parse(_deps.fs.readFileSync(file, "utf-8")) || {};
        } catch (_parseErr) {
          /* corrupted — overwrite */
        }
      }
      const next = { ...current, ...patch, updatedAt: nowIso() };
      _deps.fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf-8");
      return next;
    } catch (err) {
      logger.warn(`[session-state] failed to update mode.json: ${err.message}`);
      return null;
    }
  }

  _setStage(sessionId, stage) {
    return this._updateMode(sessionId, { stage });
  }

  getStage(sessionId) {
    try {
      const file = path.join(this.sessionDir(sessionId), "mode.json");
      if (!_deps.fs.existsSync(file)) {
        return null;
      }
      return JSON.parse(_deps.fs.readFileSync(file, "utf-8"));
    } catch (err) {
      logger.warn(`[session-state] failed to read mode.json: ${err.message}`);
      return null;
    }
  }

  markDone(sessionId) {
    this._setStage(sessionId, STAGES.DONE);
  }

  /**
   * Persist the non-binding intake classifier hint on mode.json so
   * downstream stages (and the UI) can read it without re-running the
   * classifier. Stored as a sibling field, not as a gate.
   */
  setRoutingHint(sessionId, hint) {
    if (!hint || typeof hint !== "object") {
      return null;
    }
    this.ensureSession(sessionId);
    return this._updateMode(sessionId, { routingHint: hint });
  }

  // ── intake (stage-0 classifier marker) ────────────────────────────
  markIntake(sessionId) {
    this.ensureSession(sessionId);
    this._setStage(sessionId, STAGES.INTAKE);
  }

  // ── tasks.json ────────────────────────────────────────────────────
  /**
   * Write the structured task graph. Not gated: a planner may write tasks
   * as part of $ralplan before approval. Callers are responsible for
   * producing a schema-valid object (see ADR §6.2).
   */
  writeTasks(sessionId, { version = 1, stage, tasks = [] } = {}) {
    if (!Array.isArray(tasks)) {
      throw new Error("writeTasks: tasks must be an array");
    }
    const dir = this.ensureSession(sessionId);
    const payload = {
      sessionId,
      version,
      stage: stage || this.getStage(sessionId)?.stage || STAGES.PLAN,
      tasks,
      updatedAt: nowIso(),
    };
    const file = path.join(dir, "tasks.json");
    _deps.fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
    return file;
  }

  readTasks(sessionId) {
    const file = path.join(this.sessionDir(sessionId), "tasks.json");
    if (!_deps.fs.existsSync(file)) {
      return null;
    }
    try {
      return JSON.parse(_deps.fs.readFileSync(file, "utf-8"));
    } catch (err) {
      logger.warn(`[session-state] tasks.json parse failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Patch a single task's status (pending → running → completed | failed).
   * Returns the updated tasks.json payload, or null if task not found.
   */
  updateTaskStatus(sessionId, taskId, status, extra = {}) {
    const payload = this.readTasks(sessionId);
    if (!payload) {
      throw new Error(
        `updateTaskStatus: no tasks.json for session "${sessionId}"`,
      );
    }
    const task = payload.tasks.find((t) => t.id === taskId);
    if (!task) {
      return null;
    }
    task.status = status;
    Object.assign(task, extra);
    this.writeTasks(sessionId, payload);
    return payload;
  }

  // ── verify.json ───────────────────────────────────────────────────
  /**
   * Write verification evidence. Also bumps the session stage to VERIFY
   * (or FAILED if the check set reports status="failed" and nextAction is
   * not fix-loop). This is the structural form of "done = evidence", not
   * "done = self-declared".
   */
  writeVerify(sessionId, { status, checks = [], nextAction = null } = {}) {
    if (!status || !["passed", "failed", "partial"].includes(status)) {
      throw new Error(
        `writeVerify: status must be one of passed|failed|partial, got "${status}"`,
      );
    }
    const dir = this.ensureSession(sessionId);
    const payload = {
      sessionId,
      status,
      checks,
      nextAction,
      updatedAt: nowIso(),
    };
    const file = path.join(dir, "verify.json");
    _deps.fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
    // Stage transition: verify is entered unconditionally; the caller
    // decides whether to markComplete / enterFixLoop based on status.
    this._setStage(sessionId, STAGES.VERIFY);
    return file;
  }

  readVerify(sessionId) {
    const file = path.join(this.sessionDir(sessionId), "verify.json");
    if (!_deps.fs.existsSync(file)) {
      return null;
    }
    try {
      return JSON.parse(_deps.fs.readFileSync(file, "utf-8"));
    } catch (err) {
      logger.warn(`[session-state] verify.json parse failed: ${err.message}`);
      return null;
    }
  }

  // ── summary.md (gated completion) ─────────────────────────────────
  /**
   * Gate V1: writing a summary requires passing verify.json.
   * Gate V3: agents cannot self-declare completion — only a passing
   *          verify record authorizes the terminal COMPLETE stage.
   */
  writeSummary(sessionId, content) {
    const verify = this.readVerify(sessionId);
    if (!verify) {
      throw new Error(
        `writeSummary: cannot complete session "${sessionId}" without verify.json — run verify stage first`,
      );
    }
    if (verify.status !== "passed") {
      throw new Error(
        `writeSummary: verify.status is "${verify.status}", only "passed" can enter complete — use enterFixLoop or markFailed`,
      );
    }
    const dir = this.ensureSession(sessionId);
    const body =
      typeof content === "string"
        ? content
        : [
            `# Summary: ${sessionId}`,
            "",
            `**Completed:** ${nowIso()}`,
            "",
            "_(no details provided)_",
            "",
          ].join("\n");
    const file = path.join(dir, "summary.md");
    _deps.fs.writeFileSync(file, body, "utf-8");
    this._setStage(sessionId, STAGES.COMPLETE);
    return file;
  }

  readSummary(sessionId) {
    const file = path.join(this.sessionDir(sessionId), "summary.md");
    if (!_deps.fs.existsSync(file)) {
      return null;
    }
    return _deps.fs.readFileSync(file, "utf-8");
  }

  markComplete(sessionId, summary) {
    return this.writeSummary(sessionId, summary);
  }

  markFailed(sessionId, reason = null) {
    this.ensureSession(sessionId);
    this._updateMode(sessionId, {
      stage: STAGES.FAILED,
      failureReason: reason,
    });
  }

  // ── fix-loop (gated retry counter) ────────────────────────────────
  /**
   * Enter fix-loop. Gate V4: caps retries at maxRetries (default 3);
   * over the cap, transitions the session to FAILED instead.
   *
   * Returns { stage, retries, maxRetries }.
   */
  enterFixLoop(sessionId, { maxRetries = DEFAULT_MAX_RETRIES } = {}) {
    this.ensureSession(sessionId);
    const mode = this.getStage(sessionId) || {};
    const retries = (mode.retries || 0) + 1;
    if (retries > maxRetries) {
      this._updateMode(sessionId, {
        stage: STAGES.FAILED,
        retries,
        maxRetries,
        failureReason: `fix-loop exceeded maxRetries=${maxRetries}`,
      });
      return { stage: STAGES.FAILED, retries, maxRetries };
    }
    this._updateMode(sessionId, {
      stage: STAGES.FIX_LOOP,
      retries,
      maxRetries,
    });
    return { stage: STAGES.FIX_LOOP, retries, maxRetries };
  }

  getRetries(sessionId) {
    const mode = this.getStage(sessionId);
    return mode?.retries || 0;
  }

  // ── artifacts/ directory ──────────────────────────────────────────
  /**
   * Return the artifacts/ directory for this session, creating it lazily.
   * Verify runners, test reporters, and diff extractors drop files here.
   */
  artifactsDir(sessionId) {
    const dir = path.join(this.sessionDir(sessionId), "artifacts");
    _deps.fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  listArtifacts(sessionId) {
    const dir = path.join(this.sessionDir(sessionId), "artifacts");
    if (!_deps.fs.existsSync(dir)) {
      return [];
    }
    return _deps.fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  }

  // ── member sessions ($team fan-out) ───────────────────────────────
  /**
   * Derive a member session id from a parent id + role + index.
   * Format: "<parentId>.m<idx>-<role>"  (passes safeSessionId regex).
   */
  memberSessionId(parentId, memberIdx, role) {
    safeSessionId(parentId);
    if (typeof memberIdx !== "number" || memberIdx < 0) {
      throw new Error("memberSessionId: memberIdx must be >= 0");
    }
    const safeRole = String(role || "executor").replace(/[^A-Za-z0-9]/g, "");
    return `${parentId}.m${memberIdx}-${safeRole}`;
  }

  /**
   * Create a member session that copies the parent's approved plan.
   * Each member owns its own directory so concurrent writes cannot collide.
   * The parent session is NOT modified.
   */
  createMemberSession(parentId, memberIdx, { role, steps = [] } = {}) {
    const parentPlan = this.readPlan(parentId);
    if (!parentPlan) {
      throw new Error(
        `createMemberSession: parent "${parentId}" has no plan.md`,
      );
    }
    if (!parentPlan.approved) {
      throw new Error(
        `createMemberSession: parent "${parentId}" plan is not approved`,
      );
    }

    const memberId = this.memberSessionId(parentId, memberIdx, role);
    const dir = this.ensureSession(memberId);

    // Write a dedicated intent so G1 (intent→plan) passes for the member.
    const parentIntent = this.readIntent(parentId) || "";
    _deps.fs.writeFileSync(
      path.join(dir, "intent.md"),
      `# Intent (member of ${parentId})\n\n` +
        `**Member:** ${memberId}\n` +
        `**Role:** ${role || "executor"}\n` +
        `**Created:** ${nowIso()}\n\n` +
        `## Parent Goal\n\n${parentIntent || "_(inherited)_"}\n`,
      "utf-8",
    );

    // Write the member plan: inherit parent's title, override steps with the
    // slice assigned to this member, mark approved so appendProgress passes.
    const title = `${role || "executor"} slice of ${parentId}`;
    const body = [
      "---",
      `session: ${memberId}`,
      `parent: ${parentId}`,
      "approved: true",
      `updated: ${nowIso()}`,
      "---",
      "",
      `# Plan: ${title}`,
      "",
      "## Steps",
      "",
      ...steps.map((s, i) => `${i + 1}. ${s}`),
      "",
    ].join("\n");
    _deps.fs.writeFileSync(path.join(dir, "plan.md"), body, "utf-8");
    this._setStage(memberId, STAGES.EXECUTE);
    return { memberId, dir };
  }

  /**
   * List all member sessions belonging to a parent. Returns sorted member ids.
   */
  listMemberSessions(parentId) {
    safeSessionId(parentId);
    if (!_deps.fs.existsSync(this.rootDir)) {
      return [];
    }
    const prefix = `${parentId}.m`;
    return _deps.fs
      .readdirSync(this.rootDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
      .map((e) => e.name)
      .sort();
  }

  /**
   * Convenience: read progress from every member of a parent session.
   * Returns [{ memberId, progress }, ...] (skips empty).
   */
  readMemberProgress(parentId) {
    return this.listMemberSessions(parentId).map((memberId) => ({
      memberId,
      progress: this.readProgress(memberId),
    }));
  }

  // ── listing ───────────────────────────────────────────────────────
  listSessions() {
    if (!_deps.fs.existsSync(this.rootDir)) {
      return [];
    }
    return _deps.fs
      .readdirSync(this.rootDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }
}

module.exports = { SessionStateManager, STAGES, _deps };
