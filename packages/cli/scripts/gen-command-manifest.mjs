#!/usr/bin/env node
/**
 * Generate src/command-manifest.json — a static map of top-level command name
 * (and aliases) -> { module, register, summary } used by the lazy CLI
 * dispatcher (src/lazy-dispatch.js) so a `cc <cmd>` invocation can import ONLY
 * that command's module instead of eagerly loading all ~154 command modules
 * (the ~2.7s cold-start cost; see memory cli_cold_start_bottleneck_hub_repl).
 *
 * Source of truth is src/index.js itself: we parse its `import { registerX }
 * from "./commands/x.js"` lines and its `registerX(program)` calls, then call
 * each register function against a throwaway Command to discover which
 * top-level command names + aliases it contributes. A drift-guard unit test
 * (lazy-dispatch.test.js) re-derives the eager program and fails CI if this
 * manifest ever falls out of sync, so a parse miss here surfaces as a red test
 * rather than a silently missing command.
 *
 * Run: node scripts/gen-command-manifest.mjs   (re-run when commands change)
 */
import { Command } from "commander";
import { readFileSync, writeFileSync } from "fs";

const SRC_INDEX = new URL("../src/index.js", import.meta.url);
const OUT = new URL("../src/command-manifest.json", import.meta.url);

const src = readFileSync(SRC_INDEX, "utf8");

// 1. registerFn -> module path, from `import { ... } from "./commands/.."`.
const fnToModule = {};
const importRe = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
let m;
while ((m = importRe.exec(src))) {
  const names = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const n of names) {
    if (/^register/.test(n)) fnToModule[n] = m[2];
  }
}

// 2. Called register functions, in source order: `registerX(program`.
const called = [];
const seen = new Set();
const callRe = /\b(register\w+)\s*\(\s*program\b/g;
while ((m = callRe.exec(src))) {
  if (!seen.has(m[1])) {
    seen.add(m[1]);
    called.push(m[1]);
  }
}

// 3. Introspect each register fn against a throwaway program.
const entries = [];
let skipped = 0;
for (const fn of called) {
  const mod = fnToModule[fn];
  if (!mod) {
    skipped++;
    continue;
  }
  let imported;
  try {
    imported = await import(new URL(mod, SRC_INDEX));
  } catch (e) {
    console.error(`  ! import failed for ${mod} (${fn}): ${e.message}`);
    skipped++;
    continue;
  }
  const regFn = imported[fn];
  if (typeof regFn !== "function") {
    skipped++;
    continue;
  }
  const probe = new Command();
  try {
    regFn(probe);
  } catch {
    // Some register fns may require extra args; the eager program supplies a
    // bare (program) call, so anything that throws here also throws there and
    // contributes nothing — safe to skip.
    skipped++;
    continue;
  }
  for (const cmd of probe.commands) {
    const aliases =
      typeof cmd.aliases === "function" ? cmd.aliases() : cmd._aliases || [];
    entries.push({
      name: cmd.name(),
      aliases,
      module: mod,
      register: fn,
      summary:
        (typeof cmd.description === "function" ? cmd.description() : "") || "",
    });
  }
}

entries.sort((a, b) => a.name.localeCompare(b.name));

const manifest = {
  _generated: "scripts/gen-command-manifest.mjs — do not edit by hand",
  commandCount: entries.length,
  commands: entries,
};

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.error(
  `Wrote ${entries.length} command entries to src/command-manifest.json ` +
    `(${called.length} register fns scanned, ${skipped} skipped).`,
);
