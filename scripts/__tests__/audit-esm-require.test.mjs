/**
 * Unit tests for scripts/audit-esm-require.mjs (trap #33 gate).
 *
 * Runs with `node --test`. Verifies the AST/scope-precise detection: it flags
 * bare CJS globals (require/module/exports/__dirname/__filename) that are
 * undefined in an ESM module, while ignoring (a) require() inside template
 * strings (generated CJS files), (b) names bound by a createRequire shim, and
 * (c) legitimate local bindings (params, consts) that happen to share a name.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { auditCode } from "../audit-esm-require.mjs";

test("flags a bare require() call", () => {
  const f = auditCode(
    `export function a(){ const fs = require("fs"); return fs; }`,
  );
  assert.equal(f.length, 1);
  assert.match(f[0].snippet, /require\("fs"\)/);
});

test("flags module.exports and exports", () => {
  const f = auditCode(`module.exports = {};\nexports.x = 1;`);
  assert.equal(f.length, 2);
});

test("flags __dirname / __filename", () => {
  const f = auditCode(
    `export const d = __dirname;\nexport const ff = __filename;`,
  );
  assert.equal(f.length, 2);
});

test("does NOT flag require() inside a template string", () => {
  const f = auditCode(
    'export const gen = () => `module.exports = require("child_process"); const d = __dirname;`;',
  );
  assert.equal(f.length, 0);
});

test("does NOT flag a createRequire shim binding", () => {
  const code = `
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    export function load(){ return require("./x.cjs"); }
  `;
  assert.equal(auditCode(code).length, 0);
});

test("does NOT flag a local variable/param named like a CJS global", () => {
  const code = `export function f(module){ return module.id; }`;
  assert.equal(auditCode(code).length, 0);
});

test("is scope-precise: shim in one fn, bare require in another → flags only the bare one", () => {
  const code = `
    import { createRequire } from "node:module";
    export function shimmed(){ const require = createRequire(import.meta.url); return require("a"); }
    export function bare(){ return require("b"); }
  `;
  const f = auditCode(code);
  assert.equal(f.length, 1);
  assert.match(f[0].snippet, /require\("b"\)/);
});

test("clean ESM returns no findings", () => {
  const code = `import { readFileSync } from "node:fs";\nexport const x = readFileSync;`;
  assert.equal(auditCode(code).length, 0);
});
