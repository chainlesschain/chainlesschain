/**
 * Unit tests for formatDriverLoadError — the pure error-translation helper
 * sitting in front of `require("better-sqlite3-multiple-ciphers")`.
 *
 * Why this matters: bs3mc upstream only ships prebuilds for Node LTS ABIs
 * (108/115/127). Running cc / PDH on Node 23/24/25 throws a cryptic
 * "NODE_MODULE_VERSION X / requires NODE_MODULE_VERSION Y" stack that
 * buries the real fix (use Node 22 LTS). This helper translates that into
 * actionable Chinese guidance. See memory `node_23_native_dep_trap.md`.
 */

"use strict";

import { describe, it, expect } from "vitest";

const {
  _internal: { formatDriverLoadError },
} = require("../lib/vault");

describe("formatDriverLoadError", () => {
  it("detects ABI mismatch and emits actionable Chinese guidance", () => {
    const original = new Error(
      "The module '\\\\?\\C:\\code\\chainlesschain\\node_modules\\better-sqlite3-multiple-ciphers\\build\\Release\\better_sqlite3.node'\n" +
        "was compiled against a different Node.js version using\n" +
        "NODE_MODULE_VERSION 140. This version of Node.js requires\n" +
        "NODE_MODULE_VERSION 127. Please try re-compiling or re-installing\n" +
        "the module (for instance, using `npm rebuild` or `npm install`).",
    );
    const wrapped = formatDriverLoadError(original, "v24.0.1");
    expect(wrapped.code).toBe("BS3MC_ABI_MISMATCH");
    expect(wrapped.cause).toBe(original);
    expect(wrapped.message).toMatch(/Node v24\.0\.1 has ABI 127/);
    expect(wrapped.message).toMatch(/bs3mc prebuild is ABI 140/);
    expect(wrapped.message).toMatch(/切 Node 22 LTS/);
    expect(wrapped.message).toMatch(/nvm install 22\.12\.0/);
    expect(wrapped.message).toMatch(/npm rebuild better-sqlite3-multiple-ciphers/);
  });

  it("falls back to generic message when error is not ABI-related", () => {
    const original = new Error("ENOENT: no such file or directory");
    const wrapped = formatDriverLoadError(original, "v22.12.0");
    expect(wrapped.code).toBeUndefined();
    expect(wrapped.cause).toBe(original);
    expect(wrapped.message).toMatch(/Failed to load better-sqlite3-multiple-ciphers/);
    expect(wrapped.message).toMatch(/ENOENT: no such file or directory/);
  });

  it("handles non-Error throw values (string / null)", () => {
    const wrapped1 = formatDriverLoadError("plain string", "v22.12.0");
    expect(wrapped1.message).toMatch(/Original error: plain string/);

    const wrapped2 = formatDriverLoadError(null, "v22.12.0");
    expect(wrapped2.message).toMatch(/Original error: null/);
  });

  it("uses process.versions.node when nodeVer omitted", () => {
    const original = new Error(
      "NODE_MODULE_VERSION 200. requires NODE_MODULE_VERSION 127.",
    );
    const wrapped = formatDriverLoadError(original);
    expect(wrapped.code).toBe("BS3MC_ABI_MISMATCH");
    expect(wrapped.message).toContain(process.versions.node);
  });

  it("preserves ABI numbers from the original error message in the rewritten body", () => {
    const original = new Error(
      "NODE_MODULE_VERSION 137. requires NODE_MODULE_VERSION 131.",
    );
    const wrapped = formatDriverLoadError(original, "v23.7.0");
    expect(wrapped.message).toContain("ABI 131");
    expect(wrapped.message).toContain("ABI 137");
    expect(wrapped.message).toContain("v23.7.0");
  });
});
