import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.cwd();
const [label, mode, ...selectors] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label || "") || !["vitest", "node", "npm"].includes(mode)) throw new Error("Invalid runner arguments");
const directory = path.join(root, ".work/structured-memory-20261029");
const files = [...new Set([
  ...["runtime.js", "canonical.js", "memory-reducer.js", "compaction.js"].map(name => `packages/context-memory-kernel/lib/${name}`),
  ...["provider-context.js", "segmented-memory-port.js", "durable-memory-port.js", "memory-query-bundle.js", "memory-query-control.js", "message-adapter.js", "live-compaction.js", "jsonl-session-context-port.js"].map(name => `packages/cli/src/lib/context-memory-kernel/${name}`),
  "packages/cli/src/lib/abort-utils.js", "packages/cli/src/lib/secure-file-identity.js",
  ...["agent-core.js", "headless-runner.js", "headless-stream.js"].map(name => `packages/cli/src/runtime/${name}`),
  "packages/cli/src/harness/prompt-compressor.js", "packages/cli/src/harness/provider-backed-compaction.js", "packages/cli/src/harness/jsonl-session-store.js",
  ...selectors.map(file => mode === "vitest" ? `packages/cli/${file}` : file).filter(file => fs.existsSync(file) && fs.statSync(file).isFile()),
])];
const sources = () => Object.fromEntries(files.map(file => [file, createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
const sourceBefore = sources();
const cwd = mode === "vitest" ? path.join(root, "packages/cli") : root;
const args = mode === "vitest" ? [path.join(root, "node_modules/vitest/vitest.mjs"), "run", ...selectors, "--reporter=json", `--outputFile=${path.join(directory, label + ".json")}`] : mode === "npm" ? ["C:/nvm4w/nodejs/node_modules/npm/bin/npm-cli.js", ...selectors] : ["--test", ...selectors];
const startedAt = new Date().toISOString();
const run = spawnSync(process.execPath, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
fs.writeFileSync(path.join(directory, label + ".log"), (run.stdout || "") + "\n--- stderr ---\n" + (run.stderr || ""));
const sourceAfter = sources();
const sourcesStable = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
const receipt = { args, cwd, startedAt, endedAt: new Date().toISOString(), exitCode: run.status, signal: run.signal, error: run.error?.message || null, sourceBefore, sourceAfter, sourcesStable };
fs.writeFileSync(path.join(directory, label + "-process.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ label, exitCode: run.status, sourcesStable }));
process.exitCode = sourcesStable ? run.status ?? 1 : 1;
