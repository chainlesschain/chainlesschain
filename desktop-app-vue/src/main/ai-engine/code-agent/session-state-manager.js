/**
 * SessionStateManager — persistent workflow state for Coding Agent sessions.
 *
 * Layout (per project):
 *   <projectRoot>/.chainlesschain/sessions/<sessionId>/
 *     ├── intent.md     ($deep-interview output)
 *     ├── plan.md       ($ralplan output, frontmatter: approved: true|false)
 *     ├── progress.log  ($ralph / $team append-only execution log)
 *     └── mode.json     { stage: "intent"|"plan"|"execute"|"done", updatedAt }
 *
 * Inspired by oh-my-codex's `.omx/` session state layer, adapted to the
 * ChainlessChain Coding Agent runtime. Files are plain text / markdown so
 * users can inspect and hand-edit them.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../utils/logger.js");

const STAGES = Object.freeze({
  INTENT: "intent",
  PLAN: "plan",
  EXECUTE: "execute",
  DONE: "done",
});

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
  _setStage(sessionId, stage) {
    try {
      const file = path.join(this.sessionDir(sessionId), "mode.json");
      _deps.fs.writeFileSync(
        file,
        JSON.stringify({ stage, updatedAt: nowIso() }, null, 2),
        "utf-8",
      );
    } catch (err) {
      logger.warn(`[session-state] failed to update mode.json: ${err.message}`);
    }
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
