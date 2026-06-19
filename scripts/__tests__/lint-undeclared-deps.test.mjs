/**
 * Tests for scripts/lint-undeclared-deps.mjs.
 *
 * Exercises the pure detection core (detectExternalImports / basePackage /
 * neutralize) against the exact false-positive classes that motivated the
 * hardening: comment-embedded imports, template-literal codegen, `${...}`
 * leftovers, host-provided ambients (electron/vscode), node builtins, and
 * relative paths — plus the real positives (require / static+dynamic import /
 * export-from / side-effect import, scoped-subpath → base).
 *
 * Importing the module must NOT trigger a repo scan or process.exit (the CLI
 * body is guarded by isDirectRun) — if that regressed, this file wouldn't load.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectExternalImports,
  basePackage,
  neutralize,
} from "../lint-undeclared-deps.mjs";

// --- basePackage ----------------------------------------------------------
test("basePackage: unscoped + subpath", () => {
  assert.equal(basePackage("lodash"), "lodash");
  assert.equal(basePackage("lodash/fp"), "lodash");
});

test("basePackage: scoped + deep subpath", () => {
  assert.equal(basePackage("@scope/name"), "@scope/name");
  assert.equal(basePackage("@noble/curves/ed25519.js"), "@noble/curves");
  assert.equal(basePackage("@a/b/c/d"), "@a/b");
});

// --- real positives -------------------------------------------------------
test("detects require()", () => {
  assert.deepEqual(detectExternalImports('const x = require("lodash");'), [
    "lodash",
  ]);
});

test("detects static default/named import", () => {
  assert.deepEqual(detectExternalImports('import y from "js-yaml";'), [
    "js-yaml",
  ]);
  assert.deepEqual(detectExternalImports('import { Router } from "express";'), [
    "express",
  ]);
});

test("detects side-effect import", () => {
  assert.deepEqual(detectExternalImports('import "dotenv/config";'), ["dotenv"]);
});

test("detects dynamic import()", () => {
  assert.deepEqual(
    detectExternalImports('const p = await import("playwright");'),
    ["playwright"],
  );
});

test("detects export ... from", () => {
  assert.deepEqual(detectExternalImports('export { thing } from "rxjs";'), [
    "rxjs",
  ]);
  assert.deepEqual(detectExternalImports('export * from "zod";'), ["zod"]);
});

test("scoped-subpath import resolves to base package", () => {
  assert.deepEqual(
    detectExternalImports('import { ed25519 } from "@noble/curves/ed25519.js";'),
    ["@noble/curves"],
  );
});

test("dedup + sorted across many imports", () => {
  const src = [
    'import a from "zod";',
    'const b = require("axios");',
    'import c from "axios";', // dup
    'import d from "@noble/hashes/sha256";',
  ].join("\n");
  assert.deepEqual(detectExternalImports(src), [
    "@noble/hashes",
    "axios",
    "zod",
  ]);
});

// --- ignored: relative / builtin / ambient --------------------------------
test("ignores relative specifiers", () => {
  assert.deepEqual(
    detectExternalImports('require("./foo"); import x from "../bar/baz.js";'),
    [],
  );
});

test("ignores node builtins (bare + node: prefix)", () => {
  assert.deepEqual(
    detectExternalImports(
      'const fs = require("fs"); import path from "node:path";',
    ),
    [],
  );
});

test("ignores host-provided ambients (electron/vscode)", () => {
  assert.deepEqual(
    detectExternalImports(
      'const e = require("electron"); import * as vscode from "vscode";',
    ),
    [],
  );
});

// --- ignored: false-positive classes the hardening targets ----------------
test("ignores import-shaped text in line comments", () => {
  assert.deepEqual(
    detectExternalImports('// require("@noble/curves") — was undeclared'),
    [],
  );
});

test("ignores import-shaped text in block/JSDoc comments", () => {
  const src = "/**\n * import express from \"express\"\n */\nconst y = 1;";
  assert.deepEqual(detectExternalImports(src), []);
});

test("ignores imports embedded in template literals (codegen)", () => {
  const src =
    "const generated = `import express from \"express\";\\n" +
    'require("@modelcontextprotocol/sdk");`;';
  assert.deepEqual(detectExternalImports(src), []);
});

test("ignores ${...} template-interpolation leftovers", () => {
  const src = "const code = `require('${indexPath}'); require('${utf8}')`;";
  assert.deepEqual(detectExternalImports(src), []);
});

test("does not match member-access .require()", () => {
  assert.deepEqual(detectExternalImports('module.require("lodash");'), []);
});

test("does not strip URLs in strings (no over-eager comment removal)", () => {
  // The `//` in https:// must not eat the rest of the line and hide a later import.
  const src = 'const u = "https://x.test"; const z = require("got");';
  assert.deepEqual(detectExternalImports(src), ["got"]);
});

// --- neutralize spot-checks ----------------------------------------------
test("neutralize blanks template-literal contents but keeps backticks", () => {
  assert.equal(neutralize("`abc`"), "``");
});

test("neutralize strips block comments", () => {
  assert.equal(neutralize("a/* b */c"), "ac");
});
