import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { traceContext } from "../../src/lib/execution-trace/trace-context.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

const require = createRequire(import.meta.url);

const ORIGINAL_NATIVE = executionBroker._native;
const ORIGINAL_SANDBOX = executionBroker._platformSandboxEnabled;
const ORIGINAL_CREDENTIAL_FILTERING =
  executionBroker._credentialFilteringEnabled;
const ORIGINAL_CREDENTIAL_AGENT = executionBroker._credentialAgentEnabled;
const ORIGINAL_LOG_PATH = executionBroker._logPath;

describe("ProcessExecutionBroker execFileSync contract", () => {
  let spawnSync;
  let auditRoot;

  beforeEach(() => {
    auditRoot = mkdtempSync(path.join(os.tmpdir(), "cc-process-audit-"));
    executionBroker._logPath = path.join(auditRoot, "process-audit.log");
    executionBroker.flushAuditLog();
    executionBroker._platformSandboxEnabled = false;
    executionBroker._credentialFilteringEnabled = false;
    executionBroker._credentialAgentEnabled = false;
    spawnSync = vi.fn();
    executionBroker._native = { spawnSync };
  });

  afterEach(() => {
    executionBroker._native = ORIGINAL_NATIVE;
    executionBroker._platformSandboxEnabled = ORIGINAL_SANDBOX;
    executionBroker._credentialFilteringEnabled = ORIGINAL_CREDENTIAL_FILTERING;
    executionBroker._credentialAgentEnabled = ORIGINAL_CREDENTIAL_AGENT;
    executionBroker._logPath = ORIGINAL_LOG_PATH;
    executionBroker.flushAuditLog();
    rmSync(auditRoot, { recursive: true, force: true });
  });

  it("returns stdout and records sync provenance on success", () => {
    spawnSync.mockReturnValue({
      status: 0,
      signal: null,
      stdout: "v1.2.3\n",
      stderr: "",
    });

    const stdout = executionBroker.execFileSync("tool", ["--version"], {
      encoding: "utf8",
      origin: "test:exec-file-sync",
      policy: "allow",
      scope: "test",
      shell: false,
    });

    expect(stdout).toBe("v1.2.3\n");
    expect(spawnSync).toHaveBeenCalledWith(
      "tool",
      ["--version"],
      expect.objectContaining({ encoding: "utf8", shell: false }),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      origin: "test:exec-file-sync",
      scope: "test",
      permissionDecision: "allow",
      sync: true,
      exitCode: 0,
    });
  });

  it("persists admission before a required-audit process can start", () => {
    spawnSync.mockReturnValue({
      status: 0,
      signal: null,
      stdout: "ok\n",
      stderr: "",
    });

    executionBroker.execFileSync("tool", ["secret-argument"], {
      encoding: "utf8",
      origin: "test:required-audit",
      policy: "allow",
      scope: "test",
      shell: false,
      requirePersistentAudit: true,
      auditRedactCommand: true,
      auditRedactArgIndexes: [0],
      auditContext: {
        actor: "agent",
        sessionId: "session-123",
        authorization: {
          decision: "allow",
          via: "policy",
          riskLevel: "medium",
          policy: "autopilot",
        },
        policyDigest: "policy-digest-123",
      },
    });

    const records = readFileSync(executionBroker._logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      origin: "test:required-audit",
      auditPhase: "admission",
      persistentAuditRequired: true,
      actor: "agent",
      sessionId: "session-123",
      authorization: {
        decision: "allow",
        via: "policy",
        riskLevel: "medium",
        policy: "autopilot",
      },
      approvalPolicyDigest: "policy-digest-123",
      command: expect.stringMatching(/^\[REDACTED sha256:/),
      args: ["***REDACTED***"],
    });
    expect(records.at(-1)).toMatchObject({
      origin: "test:required-audit",
      persistentAuditRequired: true,
      exitCode: 0,
      actor: "agent",
      sessionId: "session-123",
      approvalPolicyDigest: "policy-digest-123",
    });
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it("fails closed before spawn when required audit persistence is unavailable", () => {
    executionBroker._logPath = path.join(
      auditRoot,
      "missing-parent",
      "process-audit.log",
    );
    expect(() =>
      executionBroker.execFileSync("tool", [], {
        origin: "test:required-audit",
        policy: "allow",
        requirePersistentAudit: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PROCESS_AUDIT_UNAVAILABLE",
        auditFailClosed: true,
      }),
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("terminates a PTY when required audit becomes unavailable after spawn", () => {
    const kill = vi.fn();
    const ptyModule = {
      spawn: vi.fn(() => {
        executionBroker._logPath = path.join(
          auditRoot,
          "missing-after-spawn",
          "process-audit.log",
        );
        return { pid: 1234, kill };
      }),
    };

    expect(() =>
      executionBroker.spawnPty(ptyModule, "tool", [], {
        origin: "test:required-pty-audit",
        policy: "allow",
        requirePersistentAudit: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_PROCESS_AUDIT_UNAVAILABLE",
        processTerminationRequested: true,
      }),
    );
    expect(ptyModule.spawn).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledOnce();
  });

  it("shares one trace singleton across CJS and ESM consumers", () => {
    const cjsTraceContext = require("../../src/lib/execution-trace/trace-context.cjs");

    expect(cjsTraceContext.traceContext).toBe(traceContext);
  });

  it("propagates the shared active trace to sync children and audit", async () => {
    spawnSync.mockReturnValue({
      status: 0,
      signal: null,
      stdout: "ok\n",
      stderr: "",
    });
    const span = traceContext.startRootSpan("broker-sync-contract");
    const traceparent = traceContext.formatTraceparent(
      span.traceId,
      span.spanId,
    );

    try {
      await traceContext.runInContext(span, async () => {
        executionBroker.execFileSync("tool", ["trace"], {
          encoding: "utf8",
          origin: "test:trace-context",
          policy: "allow",
          scope: "test",
          shell: false,
        });
      });
    } finally {
      traceContext.endSpan(span);
    }

    expect(spawnSync).toHaveBeenCalledWith(
      "tool",
      ["trace"],
      expect.objectContaining({
        env: expect.objectContaining({ TRACEPARENT: traceparent }),
      }),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      origin: "test:trace-context",
      traceId: span.traceId,
    });
  });

  it("supports the native options-only overload", () => {
    spawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("ok") });

    expect(
      executionBroker.execFileSync("tool", {
        policy: "allow",
        origin: "test:exec-file-sync",
      }),
    ).toEqual(Buffer.from("ok"));
    expect(spawnSync).toHaveBeenCalledWith(
      "tool",
      [],
      expect.objectContaining({ origin: "test:exec-file-sync" }),
    );
  });

  it("throws a native-shaped error for a non-zero exit", () => {
    spawnSync.mockReturnValue({
      status: 7,
      signal: null,
      stdout: "partial",
      stderr: "failed",
    });

    expect(() =>
      executionBroker.execFileSync("tool", ["run"], {
        policy: "allow",
        origin: "test:exec-file-sync",
      }),
    ).toThrowError(
      expect.objectContaining({
        status: 7,
        signal: null,
        stdout: "partial",
        stderr: "failed",
      }),
    );
  });

  it("rethrows spawn errors without hiding their code", () => {
    const spawnError = Object.assign(new Error("not found"), {
      code: "ENOENT",
    });
    spawnSync.mockReturnValue({
      status: null,
      signal: null,
      error: spawnError,
    });

    expect(() =>
      executionBroker.execFileSync("missing-tool", [], {
        policy: "allow",
        origin: "test:exec-file-sync",
      }),
    ).toThrow(spawnError);
  });
});
