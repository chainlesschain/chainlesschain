/**
 * Dual-format build: tsc → dist/esm (NodeNext ESM + d.ts), then a second
 * pass → dist/cjs (CommonJS) with a {"type":"commonjs"} stub so require()
 * consumers (the VS Code extension) work without a bundler.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
// npm workspaces may hoist TypeScript to the repository root, while an
// independently installed SDK keeps it local. Resolve the real compiler module
// through Node instead of assuming either node_modules/.bin layout.
const tsc = require.resolve("typescript/lib/tsc.js");

function run(args) {
  execFileSync(process.execPath, [tsc, ...args], {
    cwd: root,
    stdio: "inherit",
  });
}

run(["-p", "tsconfig.json"]);
run([
  "-p",
  "tsconfig.json",
  "--module",
  "CommonJS",
  "--moduleResolution",
  "Node10",
  "--outDir",
  "dist/cjs",
  "--declaration",
  "false",
  "--verbatimModuleSyntax",
  "false",
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
