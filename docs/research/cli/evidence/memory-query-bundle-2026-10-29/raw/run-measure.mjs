import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");
const [label, script, ...options] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label || "")) throw new Error("A report label is required");
const files = [
  ...["segmented-memory-port.js", "durable-memory-port.js", "memory-query-index.js", "memory-service.js", "memory-query-control.js", "memory-shard-snapshots.js", "memory-query-bundle.js"].map(name => `packages/cli/src/lib/context-memory-kernel/${name}`),
  "packages/cli/src/lib/with-file-lock.js",
  ...["canonical.js", "contracts.js", "memory-reducer.js"].map(name => `packages/context-memory-kernel/lib/${name}`),
  ...["persistent-capacity-benchmark.mjs", "memory-query-index-benchmark.mjs", "memory-query-responsiveness-benchmark.mjs", "memory-mixed-concurrency-benchmark.mjs"].map(name => `packages/cli/scripts/${name}`),
];
const sources = () => Object.fromEntries(files.map(file => [file, createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
const before = sources();
const startedAt = new Date().toISOString();
const args = [script, ...options];
const run = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
fs.writeFileSync(path.join(directory, `${label}.log`), (run.stdout || "") + "\n--- stderr ---\n" + (run.stderr || ""));
const after = sources();
const sourcesStable = JSON.stringify(before) === JSON.stringify(after);
const receipt = { args, startedAt, endedAt: new Date().toISOString(), exitCode: run.status, signal: run.signal, error: run.error?.message || null, sourceBefore: before, sourceAfter: after, sourcesStable };
fs.writeFileSync(path.join(directory, `${label}-process.json`), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ label, exitCode: receipt.exitCode, sourcesStable, startedAt, endedAt: receipt.endedAt }));
process.exitCode = sourcesStable ? run.status ?? 1 : 1;
