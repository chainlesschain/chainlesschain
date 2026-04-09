/**
 * CLI-side read-only reader for Coding Agent workflow state.
 *
 * Mirrors the file layout written by
 * `desktop-app-vue/src/main/ai-engine/code-agent/session-state-manager.js`
 * but is intentionally read-only — mutation happens in the desktop main
 * process or via the workflow skills. The CLI's job is to let users
 * inspect what the agent has persisted.
 *
 * Layout:
 *   <projectRoot>/.chainlesschain/sessions/<sessionId>/
 *     ├── intent.md
 *     ├── plan.md     (YAML frontmatter: approved, updated, session)
 *     ├── progress.log
 *     └── mode.json
 */

import fs from "fs";
import path from "path";

function safeId(id) {
  if (!id || typeof id !== "string" || !/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`Invalid sessionId: "${id}"`);
  }
  return id;
}

function sessionsRoot(projectRoot) {
  return path.join(projectRoot, ".chainlesschain", "sessions");
}

export function listWorkflowSessions(projectRoot) {
  const root = sessionsRoot(projectRoot);
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(root, e.name);
      const mode = readMode(dir);
      return {
        sessionId: e.name,
        stage: mode?.stage || null,
        updatedAt: mode?.updatedAt || null,
        hasIntent: fs.existsSync(path.join(dir, "intent.md")),
        hasPlan: fs.existsSync(path.join(dir, "plan.md")),
        approved: readPlanApproved(dir),
      };
    })
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function readMode(dir) {
  const file = path.join(dir, "mode.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function readPlanApproved(dir) {
  const file = path.join(dir, "plan.md");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return false;
  return /approved:\s*true/.test(fm[1]);
}

export function readWorkflowSession(projectRoot, sessionId) {
  safeId(sessionId);
  const dir = path.join(sessionsRoot(projectRoot), sessionId);
  if (!fs.existsSync(dir)) {
    return null;
  }
  const intentFile = path.join(dir, "intent.md");
  const planFile = path.join(dir, "plan.md");
  const logFile = path.join(dir, "progress.log");
  return {
    sessionId,
    dir,
    mode: readMode(dir),
    intent: fs.existsSync(intentFile)
      ? fs.readFileSync(intentFile, "utf-8")
      : null,
    plan: fs.existsSync(planFile) ? fs.readFileSync(planFile, "utf-8") : null,
    planApproved: readPlanApproved(dir),
    progress: fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "",
  };
}
