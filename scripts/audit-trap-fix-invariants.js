#!/usr/bin/env node
/**
 * audit-trap-fix-invariants.js — guard known-good trap fixes
 *
 * Some traps' fixes are concentrated in a single file. When the fix
 * lives in code, a "future refactor accidentally removes it" regression
 * is just as bad as the original trap. This script flags files that
 * silently drop the required-pattern set.
 *
 * Currently covered (file → required-pattern set):
 *
 *   #22  android-app/.../MediaPipeLlmEngine.kt
 *        — must keep the prompt-length pre-check before native predict.
 *        MediaPipe tasks-genai throws IllegalStateException then
 *        immediately calls NewByteArray without clearing the pending
 *        exception → JNI abort → SIGABRT the whole process. Cannot
 *        catch from Kotlin. The only safe path is to refuse the prompt
 *        up-front.
 *
 *   #26  desktop-app-vue/src/main/index.js
 *        — must keep the legacy-GPU crash recovery flow (marker file +
 *        disableHardwareAcceleration if previous launch crashed).
 *        Without this, machines with old Intel/AMD GPU drivers
 *        (≤2018) hit a Chromium 130+ fail-fast at GPU init that
 *        looks like "installer crashes" from the user's POV.
 *
 *   #24  android-app/.../LocalFilesystemBootstrapper.kt
 *        — must keep the companion-object Mutex + .tmp+rename atomicity
 *        pattern. A per-instance Mutex on a @Singleton-injected
 *        Bootstrapper would race when multiple Hub*ViewModels fire
 *        bootstrap() concurrently (real-device 14ms-apart traces).
 *        The fix promotes the Mutex to companion-level (process-wide
 *        singleton) and writes new files via tmp + renameTo (atomic
 *        on POSIX rename(2)). Losing either pattern reverts the race.
 *
 * Failure mode: the file exists, opens fine, but is missing one or
 * more required patterns. We don't try to verify the patterns are
 * arranged correctly — that's what code review is for. We just
 * confirm the building blocks are still present.
 *
 * Usage:
 *   node scripts/audit-trap-fix-invariants.js
 *   node scripts/audit-trap-fix-invariants.js --json
 *
 * Exit: 0 clean, 1 missing patterns.
 *
 * See: docs/internal/hidden-risk-traps.md §22, §24, §26
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const CHECKS = [
  {
    trap: "#22",
    title: "MediaPipe SIGABRT prompt-length pre-check",
    file: "android-app/app/src/main/java/com/chainlesschain/android/pdh/llm/MediaPipeLlmEngine.kt",
    patterns: [
      {
        re: /\bestimateTokens\b/,
        why: "must call estimateTokens(prompt) to compute the prompt size",
      },
      {
        re: /\b(?:ctxBudget|maxTokens)\b/,
        why: "must reference maxTokens / ctxBudget as the context window cap",
      },
      {
        re: /\bsafetyMargin\b|-\s*\d+\s*\)/,
        why: "must subtract a safety margin from ctxBudget before the comparison",
      },
      {
        re: /throw\s+LlmInferenceException/,
        why: "must refuse the prompt by throwing LlmInferenceException (Kotlin can't catch the JNI abort)",
      },
    ],
    fixHint: "see line 172-192 — the `Fix C — prompt-length guard BEFORE native predict` block",
  },
  {
    trap: "#26",
    title: "Legacy-GPU Chromium fail-fast recovery flow",
    file: "desktop-app-vue/src/main/index.js",
    patterns: [
      {
        re: /\b_gpuRecoveryMarker\b/,
        why: "must hold the marker path on the app instance for later cleanup at ready-to-show",
      },
      {
        re: /\.launching\b|gpu-disabled\b|\.gpu-disabled\b/,
        why: "must use the marker file flow (.launching written pre-init, .gpu-disabled persisted on crash detection)",
      },
      {
        re: /disableHardwareAcceleration\s*\(/,
        why: "must call app.disableHardwareAcceleration() when previous-crash detected / env / persisted-flag set",
      },
      {
        re: /crashRecovered|previous-crash|previous-launch-crash/,
        why: "must distinguish the crash-recovery branch from env / persisted flag reasons (for logging + UX)",
      },
    ],
    fixHint: "see the 'Legacy-GPU crash recovery (v5.0.3.95+)' block — lines 170-225 ish",
  },
  {
    trap: "#24",
    title: "Bootstrap companion-Mutex + tmp+rename atomicity",
    file: "android-app/feature-local-terminal/src/main/java/com/chainlesschain/android/feature/localterminal/LocalFilesystemBootstrapper.kt",
    patterns: [
      {
        re: /companion\s+object\b/,
        why: "Mutex must live in companion object (process-singleton); per-instance Mutex on @Singleton races (real-device traces showed 14ms-apart concurrent enters)",
      },
      {
        re: /\bMutex\s*\(\s*\)/,
        why: "must instantiate Mutex() — the lock primitive",
      },
      {
        re: /\.withLock\s*\{/,
        why: "must use withLock to actually serialize the bootstrap critical section",
      },
      {
        re: /\.tmp\b|"[^"]*\.tmp"/,
        why: "must write new files via a .tmp filename first (half-step of the atomic-rename pattern)",
      },
      {
        re: /\.renameTo\s*\(|Files\.move|atomicMove/,
        why: "must rename the .tmp to the final name atomically — POSIX rename(2) guarantees readers never see a half-written file",
      },
    ],
    fixHint: "see line 124 (withLock at top of bootstrapLocked) + 448 (chainlesschain.tmp) + 477 (renameTo) + 771-781 (companion object holding processBootstrapMutex)",
  },
];

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");

const findings = [];
const allChecks = [];

for (const check of CHECKS) {
  const fullPath = path.join(ROOT, check.file);
  let src = null;
  if (!fs.existsSync(fullPath)) {
    findings.push({
      trap: check.trap,
      severity: "HIGH",
      file: check.file,
      message: "guard file missing — was it moved or deleted?",
    });
    allChecks.push({ trap: check.trap, file: check.file, exists: false, missing: [] });
    continue;
  }
  try {
    src = fs.readFileSync(fullPath, "utf-8");
  } catch (err) {
    findings.push({
      trap: check.trap,
      severity: "HIGH",
      file: check.file,
      message: `could not read: ${err.message}`,
    });
    continue;
  }
  const missing = check.patterns.filter((p) => !p.re.test(src));
  allChecks.push({
    trap: check.trap,
    file: check.file,
    exists: true,
    missing,
  });
  for (const p of missing) {
    findings.push({
      trap: check.trap,
      title: check.title,
      severity: "HIGH",
      file: check.file,
      pattern: p.re.toString(),
      why: p.why,
      fixHint: check.fixHint,
    });
  }
}

if (jsonMode) {
  process.stdout.write(
    JSON.stringify(
      { findings, checks: allChecks, scanned: CHECKS.length },
      null,
      2,
    ) + "\n",
  );
  process.exit(findings.length > 0 ? 1 : 0);
}

if (findings.length === 0) {
  console.log(
    `✅ audit-trap-fix-invariants: ${CHECKS.length} guard files OK`,
  );
  for (const c of allChecks) {
    console.log(`   ${c.trap}  ${c.file}  — all ${CHECKS.find((x) => x.trap === c.trap).patterns.length} required patterns present`);
  }
  process.exit(0);
}

console.log(
  `❌ audit-trap-fix-invariants: ${findings.length} missing pattern(s) across ${new Set(findings.map((f) => f.trap)).size} trap(s)`,
);
console.log("");
for (const f of findings) {
  console.log(`  ${f.trap}  ${f.file}`);
  if (f.message) {
    console.log(`    ${f.message}`);
  } else {
    console.log(`    missing: ${f.pattern}`);
    console.log(`    why: ${f.why}`);
    console.log(`    fix: ${f.fixHint}`);
  }
  console.log("");
}
console.log(`   See docs/internal/hidden-risk-traps.md for the affected traps.`);
process.exit(1);
