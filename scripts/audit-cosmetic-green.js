#!/usr/bin/env node
/**
 * audit-cosmetic-green.js — trap #30 static-scan gate
 *
 * Detects "cosmetic-green" workflows: a job whose green ✓ checkmark does NOT
 * mean the substantive check passed, because a step's real failure is masked
 * by `continue-on-error: true` and then *branched on* via a downstream
 * `if: steps.<id>.outcome ...` — with nothing surfacing the real result to a
 * human reading the run conclusion.
 *
 * Why it matters (trap #30, docs/internal/hidden-risk-traps.md):
 *   - `continue-on-error: true` splits a step into `conclusion: success`
 *     (masked) vs `outcome: failure` (real). The job stays green even when the
 *     meaningful work failed. The real result lives in *which conditional
 *     branch ran*, not in the run's conclusion.
 *   - 2026-06-10: manually re-running `upstream-watch.yml` to "confirm green"
 *     showed a ✓, but the install step's real outcome was failure (Node 23
 *     prebuild regressed) — the "Log expected-fail" branch is what actually
 *     ran. A reader trusting the ✓ would have reported a false all-clear.
 *   - Memory: node_23_native_dep_trap.md, feedback_continue_on_error_silent_regression.md
 *
 * What this flags (the harmful shape, precision over recall):
 *   A step with `continue-on-error: true` AND an `id:`, whose `.outcome` (or
 *   `.conclusion`) is referenced by some `if:` later in the file, AND the file
 *   has NO compensating surface that re-exposes the real result, namely any of:
 *     - `if: failure()` step
 *     - writes to `$GITHUB_STEP_SUMMARY`
 *     - `core.setFailed(...)` / `::error` workflow command
 *     - `createComment` / `updateComment` (advisory PR-comment gates — the
 *       result IS surfaced to humans, e.g. ci-mask-audit / bs3mc-dual-load)
 *     - an explicit `exit 1` in a gating step
 *
 * Intentional probes (designed to always exit 0, e.g. upstream-watch) opt out
 * with a file-level marker comment:  `# cosmetic-green-ok: <reason>`
 * That acknowledges the design and points readers to trap #30 for how to read
 * the run; it suppresses findings for that file.
 *
 * Distinct from trap #8's gate (scripts/audit-ci-masks.sh / ci-mask-audit.yml),
 * which greps the PR diff for the *presence* of any `continue-on-error` / `||
 * true` / `xcpretty` / hardcoded ✅. This gate does light structural analysis
 * (id → outcome-branch → compensating-surface) to flag the specific
 * cosmetic-green shape, whole-file (the pattern spans many lines).
 *
 * Heuristic / limits: line-based parse of the highly-regular workflow YAML
 * (no js-yaml dep, matching the other audit-*.js). Does not model shell
 * control flow, so a watcher that "always exits 0" WITHOUT a
 * continue-on-error+outcome-branch is out of scope. False positives are
 * suppressed by the surface checks + opt-out marker; advisory only.
 *
 * Usage:
 *   node scripts/audit-cosmetic-green.js
 *   node scripts/audit-cosmetic-green.js --json
 */

const fs = require("fs");
const path = require("path");

const WORKFLOW_DIR = path.join(".github", "workflows");
const OPT_OUT_MARKER = "cosmetic-green-ok";

// Reporting surfaces — a human sees the real result regardless of where they
// sit. Checked over the whole file (these tokens only appear in dedicated
// reporting steps, never in the masked step itself).
const REPORT_SURFACE = /GITHUB_STEP_SUMMARY|core\.setFailed\s*\(|createComment\b|updateComment\b/;

// Re-fail / explicit-error surfaces — only count when they live OUTSIDE a
// continue-on-error step (a bare `exit 1` inside the masked step is swallowed,
// so it does NOT surface anything; a later gating step that does `exit 1` /
// `::error` / `if: failure()` genuinely re-reds the build).
const FAIL_SURFACE = /\bexit\s+1\b|::error\b|failure\(\)/;

function listWorkflowFiles() {
  if (!fs.existsSync(WORKFLOW_DIR)) return [];
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => /\.(ya?ml)$/.test(f))
    .map((f) => path.join(WORKFLOW_DIR, f))
    .sort();
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/**
 * Parse the steps of every job in a workflow file (line-based).
 * Returns ALL steps as { id, continueOnError, line } (0-based startLine in
 * `line`), in file order — callers derive each step's line range from the
 * next step's start.
 */
function parseSteps(lines) {
  const steps = [];
  let inSteps = false;
  let stepsIndent = -1;
  let stepItemIndent = -1;
  let cur = null;

  const flush = () => {
    if (cur) steps.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // strip trailing comments only for key detection (keep simple: ignore full-line comments)
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = indentOf(raw);

    if (/^steps:\s*(#.*)?$/.test(trimmed)) {
      flush();
      inSteps = true;
      stepsIndent = indent;
      stepItemIndent = -1;
      continue;
    }

    if (inSteps) {
      // A key at or below steps' indent that is NOT a list item closes the steps block.
      if (indent <= stepsIndent && !trimmed.startsWith("- ") && /^[\w-]+:/.test(trimmed)) {
        flush();
        inSteps = false;
        stepsIndent = -1;
        stepItemIndent = -1;
        // fall through: this line might be `steps:` of another job? handled next loop
        continue;
      }

      const isListItem = /^-\s+/.test(trimmed);
      if (isListItem) {
        if (stepItemIndent === -1) stepItemIndent = indent; // lock on first item
        if (indent === stepItemIndent) {
          // new step boundary
          flush();
          cur = { id: null, continueOnError: false, line: i + 1 };
          captureKey(cur, trimmed.replace(/^-\s+/, ""));
          continue;
        }
        // deeper list item = nested array (e.g. within with:) → treat as content
      }
      if (cur && indent > stepItemIndent) {
        captureKey(cur, trimmed);
      }
    }
  }
  flush();
  return steps;
}

function captureKey(step, text) {
  let m = text.match(/^id:\s*['"]?([A-Za-z0-9_-]+)['"]?\s*(#.*)?$/);
  if (m) step.id = m[1];
  if (/^continue-on-error:\s*true\b/.test(text)) step.continueOnError = true;
}

function collectOutcomeRefs(content) {
  const refs = new Set();
  const re = /steps\.([A-Za-z0-9_-]+)\.(outcome|conclusion)\b/g;
  let m;
  while ((m = re.exec(content)) !== null) refs.add(m[1]);
  return refs;
}

function auditFile(file) {
  const content = fs.readFileSync(file, "utf-8");
  if (content.includes(OPT_OUT_MARKER)) return []; // intentional probe, acknowledged

  const lines = content.split(/\r?\n/);
  const steps = parseSteps(lines); // 1-based startLine in `.line`, file order
  const outcomeRefs = collectOutcomeRefs(content);

  // Lines (1-based) covered by continue-on-error steps — surfaces inside these
  // are masked, so they don't count. A COE step runs from its startLine until
  // the next step's startLine (last step → end of file).
  const coveredByCoe = new Set();
  for (let s = 0; s < steps.length; s++) {
    if (!steps[s].continueOnError) continue;
    const start = steps[s].line;
    const end = s + 1 < steps.length ? steps[s + 1].line - 1 : lines.length;
    for (let ln = start; ln <= end; ln++) coveredByCoe.add(ln);
  }
  const nonMasked = lines.filter((_, i) => !coveredByCoe.has(i + 1)).join("\n");

  // Surfaced = a human sees the real result: reporting tokens anywhere, OR a
  // re-fail/error surface that lives OUTSIDE any continue-on-error step.
  const surfaced = REPORT_SURFACE.test(content) || FAIL_SURFACE.test(nonMasked);

  const findings = [];
  for (const step of steps) {
    if (!step.continueOnError || !step.id) continue;
    if (!outcomeRefs.has(step.id)) continue; // not branched on → not the #30 shape
    if (surfaced) continue; // real result is re-exposed → benign advisory gate

    findings.push({
      file: file.replace(/\\/g, "/"),
      line: step.line,
      severity: "warn",
      message:
        `step id '${step.id}' is continue-on-error and its .outcome is branched on by a later if:, ` +
        `but nothing surfaces the real result — the job stays green even when this step fails ` +
        `(cosmetic-green / trap #30). Surface it (job summary, if: failure(), exit 1, PR comment) ` +
        `or, if the workflow is an intentional always-exit-0 probe, add a file-level ` +
        `'# ${OPT_OUT_MARKER}: <reason>' marker.`,
    });
  }
  return findings;
}

function main() {
  const json = process.argv.includes("--json");
  const files = listWorkflowFiles();
  const findings = [];
  for (const f of files) {
    try {
      findings.push(...auditFile(f));
    } catch (e) {
      // parse failure on a file should not crash the whole audit
      if (!json) console.error(`[skip] ${f}: ${e.message}`);
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify({ findings, scanned: files.length }, null, 2) + "\n");
    process.exit(findings.length > 0 ? 1 : 0);
  }

  console.log(`audit-cosmetic-green: scanned ${files.length} workflow file(s)`);
  if (findings.length === 0) {
    console.log("✓ no cosmetic-green masking detected");
    process.exit(0);
  }
  console.log(`\n⚠️  ${findings.length} potential cosmetic-green workflow(s):\n`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line} [${f.severity}]`);
    console.log(`    ${f.message}\n`);
  }
  console.log("Trap #30 in docs/internal/hidden-risk-traps.md.");
  process.exit(1);
}

main();
