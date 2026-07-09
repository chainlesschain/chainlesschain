/**
 * Dual-format build: tsc → dist/esm (NodeNext ESM + d.ts), then a second
 * pass → dist/cjs (CommonJS) with a {"type":"commonjs"} stub so require()
 * consumers (the VS Code extension) work without a bundler.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsc = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");

function run(args) {
  execFileSync(tsc, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
}

run(["-p", "tsconfig.json"]);
run([
  "-p", "tsconfig.json",
  "--module", "CommonJS",
  "--moduleResolution", "Node10",
  "--outDir", "dist/cjs",
  "--declaration", "false",
  "--verbatimModuleSyntax", "false",
]);

mkdirSync(join(root, "dist", "cjs"), { recursive: true });
writeFileSync(
  join(root, "dist", "cjs", "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
  "utf8",
);
writeFileSync(
  join(root, "dist", "esm", "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n",
  "utf8",
);
console.log("build OK → dist/esm + dist/cjs");
