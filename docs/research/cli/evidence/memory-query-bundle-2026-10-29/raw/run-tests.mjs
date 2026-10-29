import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");
const [label, ...selectors] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label || "")) throw new Error("A report label is required");
const files = [
  "packages/cli/src/lib/context-memory-kernel/memory-query-bundle.js",
  "packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js",
  "packages/context-memory-kernel/lib/canonical.js",
  ...selectors.map((file) => `packages/cli/${file}`),
];
const sources = () => Object.fromEntries(files.map((file) => [file, createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
const sourceBefore = sources();
const args = [path.join(root, "node_modules/vitest/vitest.mjs"), "run", ...selectors, "--reporter=json", `--outputFile=${path.join(directory, `${label}.json`)}`];
const run = spawnSync(process.execPath, args, { cwd: path.join(root, "packages/cli"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
fs.writeFileSync(path.join(directory, `${label}.log`), (run.stdout || "") + "\n--- stderr ---\n" + (run.stderr || ""));
const sourceAfter = sources();
const sourcesStable = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
const receipt = { args, exitCode: run.status, signal: run.signal, error: run.error?.message || null, observedAt: new Date().toISOString(), sourceBefore, sourceAfter, sourcesStable };
fs.writeFileSync(path.join(directory, `${label}-process.json`), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt));
process.exitCode = sourcesStable ? run.status ?? 1 : 1;
