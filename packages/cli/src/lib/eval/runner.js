/**
 * Reliability eval harness (Phase 7) — measure the agent's real task-success
 * rate, not command coverage.
 *
 * An eval task is a self-checking coding problem:
 *   { id, description, prompt, setup(dir), check(dir) → {pass, detail}, timeoutMs? }
 *
 * runEvalSuite gives each task a fresh temp workspace, runs `setup` to lay down
 * the starting files, hands `prompt` to the agent (via an injected `runAgent` so
 * the harness is testable without a live LLM), then runs `check` to decide
 * pass/fail deterministically. The score is the fraction of tasks whose check
 * passed — a verifiable success-rate metric, per the plan's north star.
 *
 * The real `cc eval` command wires `runAgent` to a headless `cc agent -p` run;
 * unit tests inject a fake runAgent to exercise scoring/report logic offline.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

export const _deps = {
  mkdtempSync: fs.mkdtempSync,
  rmSync: fs.rmSync,
  now: () => Date.now(),
};

/**
 * Content-hash every file under `dir` → Map<relPath (forward-slash), sha1>. Used
 * to measure edit locality: snapshot after setup (the baseline the agent starts
 * from) vs after the agent runs, so we can see EXACTLY which files it touched.
 */
function snapshotWorkspace(dir) {
  const out = new Map();
  const walk = (cur) => {
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const rel = path.relative(dir, full).split(path.sep).join("/");
        let hash;
        try {
          hash = crypto
            .createHash("sha1")
            .update(fs.readFileSync(full))
            .digest("hex");
        } catch {
          hash = "?"; // unreadable → treat as its own value (still "changed" if it flips)
        }
        out.set(rel, hash);
      }
    }
  };
  walk(dir);
  return out;
}

/** Relative paths that were created, modified, or deleted between two snapshots. */
function diffSnapshots(before, after) {
  const changed = new Set();
  for (const [p, h] of after) {
    if (!before.has(p) || before.get(p) !== h) changed.add(p); // created / modified
  }
  for (const p of before.keys()) {
    if (!after.has(p)) changed.add(p); // deleted
  }
  return [...changed].sort();
}

/**
 * Run a suite of eval tasks and score them.
 *
 * @param {Array<object>} tasks
 * @param {object} opts
 *   runAgent  async ({prompt, cwd, timeoutMs}) => { ok?, output?, error? }
 *   cwdBase   optional base dir for the per-task temp workspaces
 *   keepWorkspaces  don't delete temp dirs (debugging)
 *   onResult  optional (result) => void  progress callback
 * @returns {Promise<{results, passed, failed, total, passRate, ms}>}
 */
export async function runEvalSuite(tasks, opts = {}) {
  if (!Array.isArray(tasks)) throw new Error("tasks must be an array");
  if (typeof opts.runAgent !== "function") {
    throw new Error("opts.runAgent is required");
  }
  const runAgent = opts.runAgent;
  const base = opts.cwdBase || os.tmpdir();
  const results = [];
  const suiteStart = _deps.now();

  const recorder = opts.recorder || null;
  for (const task of tasks) {
    const started = _deps.now();
    let dir = null;
    const rec = {
      id: task?.id || "(unnamed)",
      description: task?.description || "",
      pass: false,
      ms: 0,
      detail: "",
      error: null,
    };
    // One telemetry span per task (duration + pass/fail + failure category),
    // feeding the OTel-shaped recorder when the caller supplies one.
    const span = recorder
      ? recorder.startSpan("eval.task", { "task.id": rec.id })
      : null;
    try {
      if (!task || typeof task.id !== "string") {
        throw new Error("task.id is required");
      }
      if (typeof task.prompt !== "string" || !task.prompt) {
        throw new Error(`task "${rec.id}": prompt is required`);
      }
      if (typeof task.check !== "function") {
        throw new Error(`task "${rec.id}": check() is required`);
      }
      dir = _deps.mkdtempSync(path.join(base, `cc-eval-${task.id}-`));
      if (typeof task.setup === "function") {
        await task.setup(dir);
      }
      // Baseline AFTER setup, BEFORE the agent — so the diff is exactly the
      // agent's edits (not the task's starting files).
      const before = snapshotWorkspace(dir);
      let agentResult;
      try {
        agentResult = await runAgent({
          prompt: task.prompt,
          cwd: dir,
          timeoutMs: task.timeoutMs,
        });
      } catch (agentErr) {
        // An agent crash is a task failure, not a harness failure — record it
        // and still run check() (the workspace may be partially done).
        rec.error = `agent error: ${agentErr.message}`;
      }
      rec.agentOk = agentResult ? agentResult.ok !== false : false;
      // Edit locality — snapshot NOW, before check() (some checks write to the
      // workspace themselves). `unrelatedChanges` = files touched outside the
      // task's declared legitimate surface; null when the task doesn't declare
      // `expectedFiles` (→ excluded from the suite's 无关改动率).
      const changed = diffSnapshots(before, snapshotWorkspace(dir));
      rec.changedFiles = changed;
      if (Array.isArray(task.expectedFiles)) {
        const expected = new Set(
          task.expectedFiles.map((p) => String(p).split(path.sep).join("/")),
        );
        rec.unrelatedChanges = changed.filter((p) => !expected.has(p));
      } else {
        rec.unrelatedChanges = null; // not measured
      }
      const verdict = await task.check(dir, agentResult);
      rec.pass = verdict?.pass === true;
      rec.detail = verdict?.detail || "";
    } catch (err) {
      // A harness-level error (bad task def / setup threw) — mark failed.
      rec.error = rec.error || err.message;
      rec.pass = false;
    } finally {
      rec.ms = _deps.now() - started;
      if (span) {
        span.setAttribute("pass", rec.pass);
        if (!rec.pass) {
          // Classify the failure: an agent crash vs a wrong-answer (check
          // failed) — the plan's "失败分类".
          const category = rec.error
            ? rec.error.startsWith("agent error")
              ? "agent_error"
              : "harness_error"
            : "check_failed";
          span.recordException(
            new Error(rec.error || rec.detail || "task failed"),
            category,
          );
        }
        span.end();
      }
      if (dir && !opts.keepWorkspaces) {
        try {
          _deps.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
    }
    results.push(rec);
    if (typeof opts.onResult === "function") {
      try {
        opts.onResult(rec);
      } catch {
        /* progress callback is best-effort */
      }
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  // 无关改动率: over tasks that declared expectedFiles, the fraction that
  // touched at least one file outside their legitimate surface. An agent that
  // solves a task but also scribbles on unrelated files scores lower quality.
  const measured = results.filter((r) => Array.isArray(r.unrelatedChanges));
  const tasksWithUnrelatedChanges = measured.filter(
    (r) => r.unrelatedChanges.length > 0,
  ).length;
  return {
    results,
    passed,
    failed: total - passed,
    total,
    passRate: total > 0 ? passed / total : 0,
    tasksWithUnrelatedChanges,
    unrelatedChangeRate: measured.length
      ? tasksWithUnrelatedChanges / measured.length
      : 0,
    ms: _deps.now() - suiteStart,
    ...(recorder ? { telemetry: recorder.summary() } : {}),
  };
}

/** Render a suite summary as a compact text report. */
export function formatEvalReport(summary) {
  const lines = [];
  const pct = (summary.passRate * 100).toFixed(1);
  lines.push(
    `Eval: ${summary.passed}/${summary.total} passed (${pct}%) in ${summary.ms}ms`,
  );
  if (typeof summary.unrelatedChangeRate === "number") {
    const upct = (summary.unrelatedChangeRate * 100).toFixed(1);
    lines.push(
      `Unrelated-change rate: ${upct}% (${summary.tasksWithUnrelatedChanges} task(s) edited files outside their expected surface)`,
    );
  }
  for (const r of summary.results) {
    const mark = r.pass ? "✔" : "✗";
    const detail = r.error ? ` — ${r.error}` : r.detail ? ` — ${r.detail}` : "";
    const stray =
      Array.isArray(r.unrelatedChanges) && r.unrelatedChanges.length
        ? ` [+${r.unrelatedChanges.length} unrelated: ${r.unrelatedChanges.join(", ")}]`
        : "";
    lines.push(`  ${mark} ${r.id} (${r.ms}ms)${detail}${stray}`);
  }
  return lines.join("\n");
}
