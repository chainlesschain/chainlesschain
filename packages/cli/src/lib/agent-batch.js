/**
 * agent-batch — dynamic worktree batch core (gap-analysis 第四阶段 #4).
 *
 * Takes a large task already decomposed into independent UNITS and runs each in
 * its OWN git worktree, in parallel (bounded concurrency), then aggregates the
 * outcome: per-unit agent status, test result, diff stat, and — on integration
 * — a merge-conflict preview against base. This is the `/batch` shape from
 * Claude Code, built on the same worktree isolation `cc team --worktree` uses.
 *
 * Pure over injected deps (worktree lifecycle, agent/test spawns, git) so the
 * whole fan-out + aggregation is unit-testable without a real repo or LLM.
 *
 * A `unit` is `{ key, prompt, test? }`. Concurrency is a simple worker pool.
 * Integration is SEQUENTIAL (like TeamWorktreeCoordinator.integrate) so a later
 * branch that conflicts with an already-merged one is reported, not clobbered.
 */

/** Run `items` through `worker` with at most `limit` in flight; preserves order. */
async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.max(1, Math.min(limit, items.length)))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    });
  await Promise.all(runners);
  return results;
}

function normalizeUnits(units) {
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error("batch requires a non-empty `units` array");
  }
  const seen = new Set();
  return units.map((u, i) => {
    const key = String(u.key || `unit-${i + 1}`);
    if (seen.has(key)) throw new Error(`duplicate unit key "${key}"`);
    seen.add(key);
    if (!u.prompt || typeof u.prompt !== "string") {
      throw new Error(`unit "${key}" has no prompt`);
    }
    return { key, prompt: u.prompt, test: u.test || null };
  });
}

/**
 * @param {object} opts
 * @param {Array<{key,prompt,test?}>} opts.units
 * @param {number} [opts.concurrency=4]
 * @param {string} [opts.test]         default test command for units without one
 * @param {boolean} [opts.merge]       merge clean branches back to base
 * @param {(msg:object)=>void} [opts.onEvent]  progress callback
 * @param {object} deps  injected effectful ops (see command wiring)
 * @returns {Promise<{units:Array, summary:object}>}
 */
export async function runBatch(opts, deps) {
  const units = normalizeUnits(opts.units);
  const concurrency = Math.max(1, Number(opts.concurrency) || 4);
  const onEvent = opts.onEvent || (() => {});
  const {
    createWorktree,
    removeWorktree,
    runAgent,
    runTest,
    diffStat,
    commit,
    previewMerge,
    mergeBranch,
    branchFor = (key) => `batch/${key}`,
  } = deps;

  onEvent({ type: "batch:start", units: units.length, concurrency });

  const results = await mapPool(units, concurrency, async (unit) => {
    const branch = branchFor(unit.key);
    const record = {
      key: unit.key,
      branch,
      status: "pending",
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      testCommand: unit.test || opts.test || null,
      testPassed: null,
      committed: false,
      error: null,
    };
    let worktreePath = null;
    try {
      worktreePath = createWorktree(unit.key, branch);
      onEvent({ type: "unit:start", key: unit.key, branch });
      await runAgent(unit.prompt, worktreePath);

      const stat = diffStat(worktreePath);
      record.filesChanged = stat.filesChanged;
      record.insertions = stat.insertions;
      record.deletions = stat.deletions;

      const testCmd = unit.test || opts.test || null;
      if (testCmd) {
        try {
          await runTest(testCmd, worktreePath);
          record.testPassed = true;
        } catch (err) {
          record.testPassed = false;
          record.testError = err.message;
        }
      }

      if (stat.filesChanged > 0) {
        record.committed = commit(worktreePath, `batch: ${unit.key}`);
      }
      // A unit whose tests FAILED is reported failed even though its worktree
      // committed — integration below skips non-passing units so a red unit
      // never merges into base.
      record.status =
        record.testPassed === false
          ? "test-failed"
          : record.filesChanged === 0
            ? "no-changes"
            : "done";
    } catch (err) {
      record.status = "error";
      record.error = err.message;
    }
    onEvent({
      type: "unit:done",
      key: unit.key,
      status: record.status,
      testPassed: record.testPassed,
      filesChanged: record.filesChanged,
    });
    return { record, worktreePath };
  });

  // Sequential integration: only units that DID change, committed, and did not
  // fail tests are eligible. Preview each; merge clean ones when --merge.
  for (const { record } of results) {
    if (!record.committed || record.status === "test-failed") {
      record.integration = { eligible: false, reason: record.status };
      continue;
    }
    let preview;
    try {
      preview = previewMerge(record.branch);
    } catch (err) {
      record.integration = {
        eligible: true,
        clean: false,
        merged: false,
        conflicts: [],
        error: err.message,
      };
      continue;
    }
    const clean = preview?.success === true;
    const conflicts = preview?.conflicts || [];
    let merged = false;
    if (clean && opts.merge) {
      let mergeResult;
      try {
        mergeResult = mergeBranch(record.branch, `Merge batch ${record.key}`);
      } catch (err) {
        mergeResult = { success: false, message: err.message };
      }
      merged = mergeResult?.success === true;
      if (!merged && (!conflicts || conflicts.length === 0)) {
        record.integration = {
          eligible: true,
          clean,
          merged,
          conflicts: mergeResult?.conflicts || [],
          error: mergeResult?.message || null,
        };
        continue;
      }
    }
    record.integration = { eligible: true, clean, merged, conflicts };
    onEvent({
      type: "unit:integrated",
      key: record.key,
      clean,
      merged,
      conflicts: conflicts.length,
    });
  }

  // Best-effort teardown of every worktree we created (branches persist for the
  // user to inspect/merge later unless already merged).
  if (typeof removeWorktree === "function") {
    for (const { record, worktreePath } of results) {
      if (!worktreePath) continue;
      try {
        removeWorktree(worktreePath, {
          deleteBranch: record.integration?.merged === true,
        });
      } catch {
        // best-effort — a leftover worktree is recoverable via `git worktree`
      }
    }
  }

  const records = results.map((r) => r.record);
  const summary = summarize(records);
  onEvent({ type: "batch:done", ...summary });
  return { units: records, summary };
}

function summarize(records) {
  const summary = {
    total: records.length,
    done: 0,
    testFailed: 0,
    noChanges: 0,
    errored: 0,
    merged: 0,
    conflicted: 0,
  };
  for (const r of records) {
    if (r.status === "done") summary.done += 1;
    else if (r.status === "test-failed") summary.testFailed += 1;
    else if (r.status === "no-changes") summary.noChanges += 1;
    else if (r.status === "error") summary.errored += 1;
    if (r.integration?.merged) summary.merged += 1;
    if (r.integration?.conflicts?.length) summary.conflicted += 1;
  }
  return summary;
}

export const _internal = { mapPool, normalizeUnits, summarize };
