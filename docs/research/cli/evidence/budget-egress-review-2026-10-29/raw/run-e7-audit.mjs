import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const clone = path.join(root, "e7-clone");
const expected = "e7a6f2585d62949794596767869423b0eb670104";
const git = (...args) => execFileSync("git", args, { cwd: clone, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== expected) throw new Error("Unexpected source commit");
const commonDirectory = git("rev-parse", "--path-format=absolute", "--git-common-dir");
if (path.resolve(commonDirectory) !== path.join(clone, ".git")) throw new Error("Clone does not own its git registry");
const files = [
  "packages/cli/scripts/implementation-plan-budget-egress.mjs",
  "packages/cli/scripts/lib/budget-egress-inventory.mjs",
  "packages/cli/scripts/budget-egress-reviewed-sources.json",
  "packages/cli/src/lib/formal-budget-transport.js",
];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash("sha256").update(fs.readFileSync(path.join(clone,file))).digest("hex")]));
const before = hashes();
const report = path.join(root, "e7-audit.json");
const args = ["packages/cli/scripts/implementation-plan-budget-egress.mjs", "--check", "--include-scripts", "--output", report];
const run = spawnSync(process.execPath, args, { cwd: clone, encoding: "utf8", maxBuffer: 16*1024*1024 });
fs.writeFileSync(path.join(root,"e7-audit.stdout.log"), run.stdout || "", { flag: "wx" });
fs.writeFileSync(path.join(root,"e7-audit.stderr.log"), run.stderr || "", { flag: "wx" });
const after = hashes();
const receipt = { schema: "local-budget-egress-reproduction/v1", node: process.version, args, cwd: clone, sourceCommit: expected, commonDirectory, exitCode: run.status, signal: run.signal, error: run.error?.message ?? null, before, after, sourcesStable: JSON.stringify(before) === JSON.stringify(after), statusAfter: git("status", "--short"), capturedAt: new Date().toISOString() };
fs.writeFileSync(path.join(root,"e7-audit-process.json"), JSON.stringify(receipt,null,2)+"\n", {flag:"wx"});
console.log(JSON.stringify(receipt));
process.exitCode = run.status ?? 1;
