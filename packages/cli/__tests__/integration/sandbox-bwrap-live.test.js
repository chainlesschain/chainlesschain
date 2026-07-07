/**
 * LIVE bubblewrap kernel-level sandbox verification (plan Phase 1 leftover —
 * "内核级出口硬隔离" was env-blocked on Windows; Linux CI runs it for real).
 *
 * Exercises executeSandboxedShell with engine=bubblewrap against a REAL bwrap:
 *  - network: kernel netns isolation (--unshare-all without --share-net) —
 *    a sandboxed curl cannot reach a live host-loopback HTTP server even
 *    though NO proxy env is involved (this is exactly the "tools that ignore
 *    proxy env vars" bypass class the egress proxy alone cannot close);
 *    with network:true (--share-net) the same request succeeds.
 *  - filesystem: / is read-only (writes outside the workspace fail), the
 *    workspace stays writable, and policy.denyRead masks a directory.
 *
 * Gated by CC_SANDBOX_LIVE=1 + Linux. In CI the workflow installs bubblewrap
 * first; if bwrap is missing while the gate is on, tests FAIL (failedToStart
 * assertions) rather than skip — a broken install can't fake green.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {
  executeSandboxedShell,
  normalizeSandboxPolicy,
} from "../../src/lib/agent-sandbox.js";

const LIVE =
  process.env.CC_SANDBOX_LIVE === "1" && process.platform === "linux";

describe.runIf(LIVE)("live bubblewrap sandbox (Linux kernel isolation)", () => {
  let work;
  let server;
  let port;

  beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bwrap-live-"));
    // A host-loopback HTTP server: reachable ONLY when the sandbox shares the
    // host network namespace. No external network dependency → not flaky.
    server = http.createServer((req, res) => res.end("host-alive"));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  function sandbox({ network = false, policy = {} } = {}) {
    return {
      engine: "bubblewrap",
      image: "unused-for-bwrap",
      cwd: work,
      network,
      policy: normalizeSandboxPolicy(policy, work),
    };
  }

  /** Assertion context: a bwrap failure surfaces on stderr, not stdout. */
  const ctx = (res) =>
    `exit=${res.exitCode} failedToStart=${res.failedToStart} stderr=${JSON.stringify(
      (res.stderr || "").slice(0, 500),
    )}`;

  const curl = (p) =>
    `curl -s --max-time 3 http://127.0.0.1:${p}/ || echo NET-BLOCKED`;

  it("network:false — kernel netns blocks even proxy-ignoring tools", () => {
    const res = executeSandboxedShell(curl(port), sandbox({ network: false }), {
      timeout: 20_000,
    });
    expect(res.failedToStart, ctx(res)).toBeUndefined();
    expect(res.stdout, ctx(res)).toContain("NET-BLOCKED");
    expect(res.stdout, ctx(res)).not.toContain("host-alive");
  });

  it("network:true — --share-net reaches the same host service", () => {
    const res = executeSandboxedShell(curl(port), sandbox({ network: true }), {
      timeout: 20_000,
    });
    expect(res.failedToStart, ctx(res)).toBeUndefined();
    expect(res.stdout, ctx(res)).toContain("host-alive");
  });

  it("filesystem — / is read-only, the workspace is writable", () => {
    const res = executeSandboxedShell(
      "echo inside > ./allowed.txt && cat ./allowed.txt && " +
        "(echo escape > /usr/cc-escape.txt 2>/dev/null && echo WROTE-ROOT || echo ROOT-RO)",
      sandbox(),
      { timeout: 20_000 },
    );
    expect(res.failedToStart, ctx(res)).toBeUndefined();
    expect(res.stdout, ctx(res)).toContain("inside");
    expect(res.stdout, ctx(res)).toContain("ROOT-RO");
    expect(res.stdout).not.toContain("WROTE-ROOT");
    // The write landed in the REAL workspace (bind mount, not a copy).
    expect(fs.readFileSync(path.join(work, "allowed.txt"), "utf8")).toContain(
      "inside",
    );
    expect(fs.existsSync("/usr/cc-escape.txt")).toBe(false);
  });

  it("policy.denyRead masks a directory with an empty tmpfs", () => {
    const secretDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-bwrap-secret-"),
    );
    fs.writeFileSync(path.join(secretDir, "secret.txt"), "TOP_SECRET", "utf8");
    try {
      const res = executeSandboxedShell(
        `cat ${secretDir}/secret.txt 2>/dev/null || echo DENIED`,
        sandbox({ policy: { filesystem: { denyRead: [secretDir] } } }),
        { timeout: 20_000 },
      );
      expect(res.failedToStart, ctx(res)).toBeUndefined();
      expect(res.stdout, ctx(res)).toContain("DENIED");
      expect(res.stdout).not.toContain("TOP_SECRET");
      // Control: WITHOUT the deny policy the same read succeeds (the mask is
      // what blocked it, not a broken fixture).
      const open = executeSandboxedShell(
        `cat ${secretDir}/secret.txt`,
        sandbox(),
        { timeout: 20_000 },
      );
      expect(open.stdout, ctx(open)).toContain("TOP_SECRET");
    } finally {
      fs.rmSync(secretDir, { recursive: true, force: true });
    }
  });
});

describe.runIf(!LIVE)("live bubblewrap sandbox (gated off)", () => {
  it("is skipped without CC_SANDBOX_LIVE=1 on Linux (needs real bwrap)", () => {
    expect(LIVE).toBe(false);
  });
});
