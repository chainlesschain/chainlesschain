import "../helpers/test-model-egress.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { SessionHostLeaseAuthority } from "../../src/lib/session-host-lease.js";
import { withFileLock } from "../../src/lib/with-file-lock.js";

const temporary = fs.realpathSync.native(os.tmpdir());
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== temporary ||
      !path.basename(root).startsWith("cc-stream-host-lease-")
    )
      throw new Error("unsafe stream host lease cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function runCase(
  phase,
  cause,
  { ephemeral = false, ignoreAbort = false, completedTool = false } = {},
) {
  const root = fs.mkdtempSync(path.join(temporary, "cc-stream-host-lease-"));
  roots.push(root);
  const input = new PassThrough();
  const events = [];
  const caller = new AbortController();
  const privateMessage = "private lease storage details must not escape";
  let heartbeat;
  let failLock = false;
  let lease;
  let released = false;
  const authority = new SessionHostLeaseAuthority({
    stateRoot: root,
    setIntervalFn(callback) {
      heartbeat = callback;
      return { unref() {} };
    },
    clearIntervalFn() {},
    lock(...args) {
      if (failLock)
        throw Object.assign(new Error(privateMessage), {
          code: "STATE_LOCK_UNAVAILABLE",
          cause: Object.assign(new Error(privateMessage), { code: "EBUSY" }),
        });
      return withFileLock(...args);
    },
  });
  const interrupt = () => {
    if (cause === "storage") {
      failLock = true;
      heartbeat();
    } else if (cause === "revoke") {
      authority.revoke("stream-lease-review", {
        requestId: "controlled-revocation",
        reasonCode: "operator",
      });
    } else {
      // A caller-owned signal can carry the same code without representing
      // loss of the actual held lease. It remains ordinary cancellation.
      caller.abort(
        Object.assign(new Error(privateMessage), {
          code: "CC_SESSION_HOST_LEASE_UNAVAILABLE",
        }),
      );
    }
  };
  const deps = {
    input,
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeErr() {},
    writeOut(value) {
      for (const line of value.trim().split("\n")) {
        if (!line) continue;
        const event = JSON.parse(line);
        events.push(event);
        if (
          phase === "idle" &&
          event.type === "result" &&
          event.is_error === false
        )
          setImmediate(interrupt);
      }
    },
    acquireSessionHostLease(id, options) {
      lease = authority.acquire(id, options);
      return {
        ...lease,
        release() {
          released = true;
          return lease.release();
        },
      };
    },
    agentLoop: async function* (messages, options) {
      if (completedTool) {
        messages.push(
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "completed-call",
                type: "function",
                function: { name: "read_file", arguments: "{}" },
              },
            ],
          },
          { role: "tool", tool_call_id: "completed-call", content: "done" },
        );
      }
      if (phase === "active") {
        setImmediate(interrupt);
        await new Promise((resolve) =>
          options.signal.addEventListener("abort", resolve, { once: true }),
        );
        if (!ignoreAbort) throw options.signal.reason;
      }
      yield { type: "response-complete", content: "completed answer" };
      yield { type: "run-ended", reason: "complete" };
    },
    sessionExists: () => false,
    startSession() {},
    appendUserMessage() {},
    appendAssistantMessage() {},
    appendEvent: () => true,
    appendAuthorityEvent: () => true,
    readEvents: () => [],
    readVerifiedEvents: () => [],
    rebuildMessages: () => [],
    loadSideEffectLedger: () => null,
  };
  input.write(`${JSON.stringify({ type: "user", text: "hello" })}\n`);
  const outcome = await runAgentHeadlessStream(
    {
      sessionId: "stream-lease-review",
      expandFileRefs: false,
      useRegisteredMcp: false,
      ephemeral,
      signal: caller.signal,
    },
    deps,
  );
  expect(JSON.stringify(events)).not.toContain(privateMessage);
  expect(events.at(-1)).toMatchObject({ type: "system", subtype: "end" });
  return { outcome, events, lease, released };
}

describe("stream host lease loss", () => {
  it.each([
    ["idle", "storage", "CC_SESSION_HOST_LEASE_UNAVAILABLE"],
    ["active", "storage", "CC_SESSION_HOST_LEASE_UNAVAILABLE"],
    ["idle", "revoke", "CC_SESSION_HOST_LEASE_FENCED"],
    ["active", "revoke", "CC_SESSION_HOST_LEASE_FENCED"],
  ])(
    "reports %s %s loss once and exits unsuccessfully",
    async (phase, cause, code) => {
      const { outcome, events, lease, released } = await runCase(phase, cause);
      expect(outcome).toMatchObject({ exitCode: 1, turns: 1 });
      expect(lease.signal.aborted).toBe(true);
      expect(lease.signal.reason.code).toBe(code);
      expect(released).toBe(true);
      const failures = events.filter(
        (event) => event.type === "result" && event.is_error,
      );
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        subtype: "error",
        code,
        error:
          "Session host authority was lost; refresh the session before continuing",
        session_id: "stream-lease-review",
      });
      expect(
        events.filter((event) => event.type === "result" && !event.is_error),
      ).toHaveLength(phase === "idle" ? 1 : 0);
    },
  );

  it.each(["idle", "active"])(
    "preserves %s caller cancellation with a live lease",
    async (phase) => {
      const { outcome, events, lease, released } = await runCase(
        phase,
        "caller",
      );
      expect(outcome).toMatchObject({ exitCode: 0, turns: 1 });
      expect(lease.signal.aborted).toBe(false);
      expect(released).toBe(true);
      expect(
        events.some((event) => event.type === "result" && event.is_error),
      ).toBe(false);
    },
  );

  it("does not infer lease loss from an anonymous caller signal", async () => {
    const { outcome, events, lease } = await runCase("active", "caller", {
      ephemeral: true,
    });
    expect(outcome).toMatchObject({ exitCode: 0, turns: 1 });
    expect(lease).toBeUndefined();
    expect(
      events.some((event) => event.type === "result" && event.is_error),
    ).toBe(false);
  });

  it("does not report success when the provider completes after host authority is lost", async () => {
    const { outcome, events } = await runCase("active", "storage", {
      ignoreAbort: true,
    });
    expect(outcome).toMatchObject({ exitCode: 1, turns: 1 });
    const results = events.filter((event) => event.type === "result");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      is_error: true,
      code: "CC_SESSION_HOST_LEASE_UNAVAILABLE",
    });
  });

  it("does not duplicate the terminal result when fenced tool settlement already fails", async () => {
    const { outcome, events } = await runCase("active", "storage", {
      completedTool: true,
    });
    expect(outcome).toMatchObject({ exitCode: 1, turns: 1 });
    const results = events.filter((event) => event.type === "result");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      is_error: true,
      code: "CC_SESSION_HOST_LEASE_UNAVAILABLE",
    });
  });
});
