"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";

const {
  SidecarSupervisor,
  SidecarTimeoutError,
  SidecarMethodError,
  SidecarNotRunningError,
} = require("../lib/sidecar");

const SIDECAR_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "personal-data-hub-bridge",
);

/**
 * Spawn the forensics-bridge sidecar from this repo's sibling package.
 * Tests are skipped if Python is unavailable on PATH (CI matrix coverage
 * is the source of truth; local dev without Python should not be blocked).
 */
function makeSupervisor() {
  return new SidecarSupervisor({
    command: process.env.FORENSICS_BRIDGE_PYTHON || "python",
    args: ["-u", "-m", "forensics_bridge.ipc_server"],
    cwd: SIDECAR_ROOT,
    healthCheckIntervalMs: 0, // disable for tests — manual control only
    env: { PYTHONPATH: SIDECAR_ROOT },
  });
}

let pythonAvailable = true;
try {
  // Cheap synchronous probe — spawn fails if python is not on PATH.
  const { spawnSync } = require("node:child_process");
  const probe = spawnSync(
    process.env.FORENSICS_BRIDGE_PYTHON || "python",
    ["--version"],
    { stdio: "ignore" },
  );
  if (probe.status !== 0) pythonAvailable = false;
} catch (_err) {
  pythonAvailable = false;
}

// In the FTS5 sandbox runner the relative ../../personal-data-hub-bridge
// resolves outside the temp tree and the directory does not exist; without
// this gate, spawn() returns ENOENT and the test fails for environment
// reasons rather than code reasons. Keep both gates so the file is safe
// to run in either layout.
const sidecarRootAvailable = fs.existsSync(SIDECAR_ROOT);

const itPy = pythonAvailable && sidecarRootAvailable ? it : it.skip;

describe("SidecarSupervisor (forensics-bridge integration)", () => {
  let supervisor;

  beforeEach(() => {
    supervisor = makeSupervisor();
  });

  afterEach(async () => {
    if (supervisor) await supervisor.stop({ graceMs: 1500 });
  });

  itPy("starts the sidecar and round-trips sidecar.ping", async () => {
    await supervisor.start({ readyTimeoutMs: 8_000 });
    expect(supervisor.isRunning()).toBe(true);

    const ping = await supervisor.invoke("sidecar.ping", {}, { timeoutMs: 3_000 });
    expect(ping.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(ping.pythonVersion).toMatch(/^3\./);
  });

  itPy("sidecar.capabilities exposes registered methods", async () => {
    await supervisor.start({ readyTimeoutMs: 8_000 });

    const caps = await supervisor.invoke("sidecar.capabilities");
    expect(caps.methods).toContain("sidecar.ping");
    expect(caps.methods).toContain("sidecar.capabilities");
    // Namespace registry grows as parsers/extractors land; Phase 4.5.2 brings
    // the system parser online.
    expect(caps.parsers).toContain("system");
    expect(caps.extractors).toContain("android");
  });

  itPy("METHOD_NOT_FOUND surfaces as a typed SidecarMethodError", async () => {
    await supervisor.start({ readyTimeoutMs: 8_000 });

    await expect(
      supervisor.invoke("definitely.not.a.real.method"),
    ).rejects.toMatchObject({
      name: "SidecarMethodError",
      code: "METHOD_NOT_FOUND",
      retryable: false,
    });
  });

  itPy("invoke rejects with SidecarNotRunningError when sidecar is stopped", async () => {
    await supervisor.start({ readyTimeoutMs: 8_000 });
    await supervisor.stop({ graceMs: 1500 });
    expect(supervisor.isRunning()).toBe(false);

    await expect(supervisor.invoke("sidecar.ping")).rejects.toMatchObject({
      name: "SidecarNotRunningError",
      code: "SIDECAR_NOT_RUNNING",
    });
  });

  itPy("two sequential invokes share one sidecar process", async () => {
    await supervisor.start({ readyTimeoutMs: 8_000 });
    const first = await supervisor.invoke("sidecar.ping");
    const second = await supervisor.invoke("sidecar.capabilities");
    expect(first.version).toBeDefined();
    expect(second.methods).toContain("sidecar.ping");
  });

  itPy("error class hierarchy is exported", () => {
    expect(typeof SidecarSupervisor).toBe("function");
    expect(typeof SidecarTimeoutError).toBe("function");
    expect(typeof SidecarMethodError).toBe("function");
    expect(typeof SidecarNotRunningError).toBe("function");
  });
});
