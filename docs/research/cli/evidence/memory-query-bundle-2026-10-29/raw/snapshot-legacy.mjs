import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const sourceCommit = "e7a6f2585d62949794596767869423b0eb670104";
const sourcePath = "packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js";
const bytes = execFileSync("git", ["show", `${sourceCommit}:${sourcePath}`], { maxBuffer: 4 * 1024 * 1024 });
const target = "packages/cli/__tests__/fixtures/segmented-memory-port-e7.mjs.txt";
fs.writeFileSync(target, bytes);
const dependencies = ["durable-memory-port.js", "memory-query-index.js", "memory-query-control.js", "memory-shard-snapshots.js"].map((name) => {
  const path = `packages/cli/src/lib/context-memory-kernel/${name}`;
  const expected = execFileSync("git", ["rev-parse", `${sourceCommit}:${path}`], { encoding: "utf8" }).trim();
  const current = execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
  if (expected !== current) throw new Error(`Legacy dependency changed: ${path}`);
  return { path, gitBlob: expected };
});
fs.writeFileSync("packages/cli/__tests__/fixtures/segmented-memory-port-e7.provenance.json", JSON.stringify({ sourceCommit, sourcePath, gitBlob: execFileSync("git", ["rev-parse", `${sourceCommit}:${sourcePath}`], { encoding: "utf8" }).trim(), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), dependencies, method: "Exact Git blob; test loader changes only import resolution to the same dependency files." }, null, 2) + "\n");
console.log(JSON.stringify({ target, bytes: bytes.length, dependencies: dependencies.length }));
