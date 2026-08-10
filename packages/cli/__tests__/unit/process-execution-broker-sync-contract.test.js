import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { traceContext } from "../../src/lib/execution-trace/trace-context.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

const require = createRequire(import.meta.url);

const ORIGINAL_NATIVE = executionBroker._native;
const ORIGINAL_SANDBOX = executionBroker._platformSandboxEnabled;
const ORIGINAL_CREDENTIAL_FILTERING =
  executionBroker._credentialFilteringEnabled;
const ORIGINAL_CREDENTIAL_AGENT = executionBroker._credentialAgentEnabled;

describe("ProcessExecutionBroker execFileSync contract", () => {
  let spawnSync;

  beforeEach(() => {
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
    executionBroker.flushAuditLog();
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
