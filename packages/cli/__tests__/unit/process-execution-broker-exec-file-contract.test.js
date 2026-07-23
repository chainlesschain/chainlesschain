import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

const ORIGINAL_NATIVE = executionBroker._native;
const ORIGINAL_SANDBOX = executionBroker._platformSandboxEnabled;
const ORIGINAL_CREDENTIAL_FILTERING =
  executionBroker._credentialFilteringEnabled;
const ORIGINAL_CREDENTIAL_AGENT = executionBroker._credentialAgentEnabled;

function createChild() {
  const child = new EventEmitter();
  child.pid = 1234;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

function closeChild(child, { code = 0, signal = null } = {}) {
  child.stdout.end();
  child.stderr.end();
  child.emit("exit", code, signal);
  child.emit("close", code, signal);
}

describe("ProcessExecutionBroker execFile contract", () => {
  let child;
  let spawn;

  beforeEach(() => {
    executionBroker.flushAuditLog();
    executionBroker._platformSandboxEnabled = false;
    executionBroker._credentialFilteringEnabled = false;
    executionBroker._credentialAgentEnabled = false;
    child = createChild();
    spawn = vi.fn(() => child);
    executionBroker._native = { spawn };
  });

  afterEach(() => {
    executionBroker._native = ORIGINAL_NATIVE;
    executionBroker._platformSandboxEnabled = ORIGINAL_SANDBOX;
    executionBroker._credentialFilteringEnabled = ORIGINAL_CREDENTIAL_FILTERING;
    executionBroker._credentialAgentEnabled = ORIGINAL_CREDENTIAL_AGENT;
    executionBroker.flushAuditLog();
  });

  it("returns the child and completes the callback with decoded output", async () => {
    const completed = new Promise((resolve) => {
      const returned = executionBroker.execFile(
        "tool",
        ["--version"],
        {
          encoding: "utf8",
          origin: "test:exec-file",
          policy: "allow",
          scope: "test",
          shell: false,
        },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }),
      );
      expect(returned).toBe(child);
    });

    child.stdout.write(Buffer.from("v1.2.3\n"));
    child.stderr.write("notice");
    closeChild(child);

    await expect(completed).resolves.toEqual({
      error: null,
      stdout: "v1.2.3\n",
      stderr: "notice",
    });
    expect(spawn).toHaveBeenCalledWith(
      "tool",
      ["--version"],
      expect.objectContaining({
        origin: "test:exec-file",
        policy: "allow",
        scope: "test",
        shell: false,
      }),
    );
  });

  it("supports the options-only overload and buffer output", async () => {
    const completed = new Promise((resolve) => {
      executionBroker.execFile(
        "tool",
        { encoding: "buffer", policy: "allow" },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }),
      );
    });

    child.stdout.write("ok");
    closeChild(child);

    const result = await completed;
    expect(result.error).toBeNull();
    expect(result.stdout).toEqual(Buffer.from("ok"));
    expect(result.stderr).toEqual(Buffer.alloc(0));
    expect(spawn).toHaveBeenCalledWith(
      "tool",
      [],
      expect.objectContaining({ encoding: "buffer", policy: "allow" }),
    );
  });

  it("returns stdout and stderr on a non-zero exit", async () => {
    const completed = new Promise((resolve) => {
      executionBroker.execFile(
        "tool",
        ["run"],
        { encoding: "utf8", policy: "allow" },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }),
      );
    });

    child.stdout.write("partial");
    child.stderr.write("failed");
    closeChild(child, { code: 7 });

    const result = await completed;
    expect(result.error).toMatchObject({ code: 7, status: 7, signal: null });
    expect(result.stdout).toBe("partial");
    expect(result.stderr).toBe("failed");
  });

  it("preserves spawn errors without an unhandled broker error event", async () => {
    const spawnError = Object.assign(new Error("not found"), {
      code: "ENOENT",
    });
    const completed = new Promise((resolve) => {
      executionBroker.execFile(
        "missing-tool",
        [],
        { encoding: "utf8", policy: "allow" },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }),
      );
    });

    child.emit("error", spawnError);

    const result = await completed;
    expect(result.error).toBe(spawnError);
    expect(result.error.code).toBe("ENOENT");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("kills the child and reports the stream when maxBuffer is exceeded", async () => {
    const completed = new Promise((resolve) => {
      executionBroker.execFile(
        "tool",
        [],
        { encoding: "utf8", maxBuffer: 3, policy: "allow" },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }),
      );
    });

    child.stdout.write("four");
    closeChild(child, { code: null, signal: "SIGTERM" });

    const result = await completed;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.error).toMatchObject({
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      stream: "stdout",
      signal: "SIGTERM",
    });
    expect(result.stdout).toBe("four");
  });
});
