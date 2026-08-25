/**
 * Interactive approvals (--interactive-approvals; chat-panel Approve/Deny) —
 * confirm-tier decisions become an approval_request / {"type":"approval"}
 * round-trip on the duplex pipes instead of headless fail-closed:
 *   - the blocked tool resolves with the user's verdict (approve / deny)
 *   - timeout (CC_APPROVAL_TIMEOUT_MS) and stdin-close fail closed
 *   - the ApprovalGate confirmer is swapped only when the flag is on
 * The pump handles approval verdicts immediately, mid-turn, like interrupts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import {
  runAgentHeadlessStream,
  parseInputEvent,
} from "../../src/runtime/headless-stream.js";
import { approvalBindingDigest } from "../../src/lib/agent-authority.js";
import {
  APPROVAL_GRANTS_EVENT,
  approvalPermissionForContext,
} from "../../src/lib/approval-grant-ledger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function verifiedResume(sessionId) {
  return {
    snapshot: {
      schema: "chainlesschain.session-host-snapshot/v1",
      schemaVersion: 1,
      sessionId,
      verified: true,
      revision: `sha256:${"b".repeat(64)}`,
    },
    messages: [],
    recovery: {
      sessionId,
      records: [],
      unsettled: [],
      incidents: [],
      adjudications: [],
      replayDenied: [],
      verified: true,
      headHash: "a".repeat(64),
      recoveryDigest: `sha256:${"c".repeat(64)}`,
      remediation: null,
    },
  };
}

describe("parseInputEvent — approval verdicts", () => {
  it("parses approve/deny and rejects malformed ones", () => {
    expect(
      parseInputEvent('{"type":"approval","id":"appr-1","approve":true}'),
    ).toEqual({
      approval: {
        id: "appr-1",
        approve: true,
        decision: { kind: "acceptOnce" },
        structured: false,
        invalidReason: null,
        binding: null,
      },
    });
    expect(
      parseInputEvent('{"type":"approval","id":"appr-2","approve":"yes"}'),
    ).toEqual({
      approval: {
        id: "appr-2",
        approve: false,
        decision: { kind: "decline", reason: "Legacy boolean denial" },
        structured: false,
        invalidReason: null,
        binding: null,
      },
    }); // strict boolean
    expect(parseInputEvent('{"type":"approval"}')).toBe(null); // no id
  });

  it("carries an optional approval binding when present", () => {
    expect(
      parseInputEvent(
        '{"type":"approval","id":"appr-1","approve":true,"binding":"ab_deadbeef"}',
      ),
    ).toEqual({
      approval: {
        id: "appr-1",
        approve: true,
        decision: { kind: "acceptOnce" },
        structured: false,
        invalidReason: null,
        binding: "ab_deadbeef",
      },
    });
    // a non-string binding is ignored (stays null)
    expect(
      parseInputEvent(
        '{"type":"approval","id":"appr-1","approve":true,"binding":5}',
      ),
    ).toEqual({
      approval: {
        id: "appr-1",
        approve: true,
        decision: { kind: "acceptOnce" },
        structured: false,
        invalidReason: null,
        binding: null,
      },
    });
  });

  it("validates structured decisions and fails closed on drift", () => {
    expect(
      parseInputEvent(
        '{"type":"approval","id":"appr-1","decision":{"kind":"acceptForTurn","permissions":[{"capability":"tool:run_shell","scope":"npm test"}]},"approve":true,"binding":"ab_bound"}',
      ),
    ).toEqual({
      approval: {
        id: "appr-1",
        approve: true,
        decision: {
          kind: "acceptForTurn",
          permissions: [{ capability: "tool:run_shell", scope: "npm test" }],
        },
        structured: true,
        invalidReason: null,
        binding: "ab_bound",
      },
    });
    expect(
      parseInputEvent(
        '{"type":"approval","id":"appr-2","decision":{"kind":"acceptOnce","extra":true},"approve":true}',
      ).approval,
    ).toMatchObject({
      approve: false,
      decision: { kind: "decline" },
      structured: true,
      invalidReason: "invalid-decision",
    });
    expect(
      parseInputEvent(
        '{"type":"approval","id":"appr-3","decision":{"kind":"acceptOnce"},"approve":false}',
      ).approval,
    ).toMatchObject({
      approve: false,
      decision: { kind: "decline" },
      structured: true,
      invalidReason: "decision-boolean-mismatch",
    });
  });
});

describe("interactive approvals round-trip", () => {
  beforeEach(() => {
    process.env.CC_APPROVAL_TIMEOUT_MS = "30000";
  });
  afterEach(() => {
    delete process.env.CC_APPROVAL_TIMEOUT_MS;
  });

  // The fake loop simulates a tool hitting a confirm: it calls the injected
  // permissionConfirm (what executeTool does for settings/hook ask) and
  // reports the verdict in its reply.
  const confirmingLoop = async function* (messages, opts) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (/RISKY/.test(lastUser.content)) {
      const ok = await opts.permissionConfirm({
        tool: "run_shell",
        command: "npm run test:unit",
        riskLevel: "medium",
        reason: "settings rule asks",
      });
      yield {
        type: "response-complete",
        content: ok ? "executed" : "skipped (denied)",
      };
    } else {
      yield { type: "response-complete", content: "plain reply" };
    }
    yield { type: "run-ended", reason: "complete" };
  };

  function harness({
    inputGen,
    agentLoop = confirmingLoop,
    options = {},
    deps: depsOverrides = {},
  }) {
    const lines = [];
    const deps = {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (s) => lines.push(s),
      writeErr: () => {},
      agentLoop,
      input: inputGen(),
      ...depsOverrides,
    };
    return {
      run: () =>
        runAgentHeadlessStream(
          { expandFileRefs: false, interactiveApprovals: true, ...options },
          deps,
        ),
      events: () =>
        lines
          .join("")
          .trimEnd()
          .split("\n")
          .map((l) => JSON.parse(l)),
    };
  }

  it("approve: the blocked tool gets true; request + resolution are emitted", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80); // let the turn reach the confirm
        yield JSON.stringify({
          type: "approval",
          id: "appr-1",
          approve: true,
        }) + "\n";
      },
    });
    await h.run();
    const req = h.events().find((e) => e.type === "approval_request");
    expect(req).toMatchObject({
      id: "appr-1",
      tool: "run_shell",
      command: "npm run test:unit",
      risk: "medium",
    });
    expect(
      h.events().find((e) => e.type === "approval_resolved"),
    ).toMatchObject({ id: "appr-1", approved: true, via: "user-approve" });
    expect(h.events().find((e) => e.type === "result").result).toBe("executed");
  });

  it("caller abort settles a pending approval and retires live stdin", async () => {
    const input = new PassThrough();
    const controller = new AbortController();
    const events = [];
    input.write(
      JSON.stringify({ type: "user", text: "do the RISKY thing" }) + "\n",
    );

    const outcome = await runAgentHeadlessStream(
      {
        expandFileRefs: false,
        interactiveApprovals: true,
        settingsHooks: {},
        signal: controller.signal,
      },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut(line) {
          const event = JSON.parse(line);
          events.push(event);
          if (event.type === "approval_request") {
            queueMicrotask(() => controller.abort());
          }
        },
        writeErr: () => {},
        agentLoop: confirmingLoop,
        input,
      },
    );

    expect(outcome).toEqual({ exitCode: 0, turns: 1 });
    expect(input.destroyed).toBe(true);
    expect(
      events.find((event) => event.type === "approval_resolved"),
    ).toMatchObject({
      approved: false,
      via: "session-closed",
    });
  }, 15_000);

  it("deny: the tool gets false", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "approval",
          id: "appr-1",
          approve: false,
        }) + "\n";
      },
    });
    await h.run();
    expect(
      h.events().find((e) => e.type === "approval_resolved"),
    ).toMatchObject({ approved: false, via: "user-deny" });
    expect(h.events().find((e) => e.type === "result").result).toBe(
      "skipped (denied)",
    );
  });

  it("a structured decision must echo the advertised binding", async () => {
    // The binding is a pure function of the confirm context, so a faithful UI
    // can reproduce exactly what the request advertised.
    const expectedBinding = approvalBindingDigest({
      toolCallId: "appr-1",
      args: { command: "npm run test:unit" },
      policyDigest: "medium", // ctx.rule ?? riskLevel — confirmingLoop sends riskLevel
    });
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "approval",
          id: "appr-1",
          decision: { kind: "acceptOnce" },
          approve: true,
          binding: expectedBinding,
        }) + "\n";
      },
    });
    await h.run();
    const req = h.events().find((e) => e.type === "approval_request");
    expect(req.binding).toBe(expectedBinding);
    expect(req.binding).toMatch(/^ab_[0-9a-f]{32}$/);
    expect(
      h.events().find((e) => e.type === "approval_resolved"),
    ).toMatchObject({
      id: "appr-1",
      approved: true,
      decision: { kind: "acceptOnce" },
      via: "user-approve",
    });
    expect(h.events().find((e) => e.type === "result").result).toBe("executed");
  });

  it("rejects a structured approval that omits the binding", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "approval",
          id: "appr-1",
          decision: { kind: "acceptOnce" },
          approve: true,
        }) + "\n";
      },
    });
    await h.run();
    expect(
      h.events().find((e) => e.type === "approval_resolved"),
    ).toMatchObject({
      approved: false,
      decision: { kind: "decline" },
      via: "binding-missing",
    });
    expect(h.events().find((e) => e.type === "result").result).toBe(
      "skipped (denied)",
    );
  });

  it("reuses an exact acceptForTurn grant without opening a second card", async () => {
    const context = {
      tool: "run_shell",
      command: "npm run test:unit",
      riskLevel: "medium",
      reason: "settings rule asks",
    };
    const expectedBinding = approvalBindingDigest({
      toolCallId: "appr-1",
      args: { command: context.command },
      policyDigest: context.riskLevel,
    });
    const requiredPermission = approvalPermissionForContext(context, {
      cwd: process.cwd(),
    });
    const doubleConfirmingLoop = async function* (_messages, opts) {
      const first = await opts.permissionConfirm(context);
      const second = await opts.permissionConfirm(context);
      yield {
        type: "response-complete",
        content: first && second ? "both executed" : "denied",
      };
      yield { type: "run-ended", reason: "complete" };
    };
    const h = harness({
      agentLoop: doubleConfirmingLoop,
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "approval",
          id: "appr-1",
          decision: {
            kind: "acceptForTurn",
            permissions: [requiredPermission],
          },
          approve: true,
          binding: expectedBinding,
        }) + "\n";
      },
    });
    await h.run();
    expect(
      h.events().filter((event) => event.type === "approval_request"),
    ).toHaveLength(1);
    expect(
      h.events().find((event) => event.type === "approval_request"),
    ).toMatchObject({ requested_permissions: [requiredPermission] });
    expect(
      h.events().find((event) => event.type === "approval_resolved"),
    ).toMatchObject({
      approved: true,
      decision: {
        kind: "acceptForTurn",
        permissions: [requiredPermission],
      },
    });
    expect(h.events().find((event) => event.type === "result").result).toBe(
      "both executed",
    );
  });

  it("downgrades a session grant to acceptOnce when authority persistence fails", async () => {
    const context = {
      tool: "run_shell",
      command: "npm run test:unit",
      riskLevel: "medium",
      reason: "settings rule asks",
    };
    const expectedBinding = approvalBindingDigest({
      toolCallId: "appr-1",
      args: { command: context.command },
      policyDigest: context.riskLevel,
    });
    const requiredPermission = approvalPermissionForContext(context, {
      cwd: process.cwd(),
    });
    const appended = [];
    const h = harness({
      options: { sessionId: "durable-approval-session" },
      deps: {
        sessionExists: () => false,
        startSession: () => {},
        readEvents: () => [],
        readVerifiedEvents: () => [],
        appendUserMessage: () => {},
        appendAssistantMessage: () => {},
        appendEvent: () => true,
        appendAuthorityEvent: (_sessionId, type, data) => {
          appended.push({ type, data });
          return type !== APPROVAL_GRANTS_EVENT;
        },
        loadSideEffectLedger: () => null,
      },
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "approval",
          id: "appr-1",
          decision: {
            kind: "acceptForSession",
            permissions: [requiredPermission],
          },
          approve: true,
          binding: expectedBinding,
        }) + "\n";
      },
    });
    await h.run();
    expect(appended.some((event) => event.type === APPROVAL_GRANTS_EVENT)).toBe(
      true,
    );
    expect(
      h.events().find((event) => event.type === "approval_resolved"),
    ).toMatchObject({
      approved: true,
      decision: { kind: "acceptOnce" },
      via: "session-grant-persistence-failed",
    });
    expect(h.events().find((event) => event.type === "result").result).toBe(
      "executed",
    );
  });

  it("restores a persisted exact session grant before the resumed turn", async () => {
    const sessionId = "durable-approval-resume";
    const context = {
      tool: "run_shell",
      command: "npm run test:unit",
      riskLevel: "medium",
      reason: "settings rule asks",
    };
    const expectedBinding = approvalBindingDigest({
      toolCallId: "appr-1",
      args: { command: context.command },
      policyDigest: context.riskLevel,
    });
    const requiredPermission = approvalPermissionForContext(context, {
      cwd: process.cwd(),
    });
    let persistedGrant = null;
    const baseStore = {
      startSession: () => {},
      readEvents: () => [],
      readVerifiedEvents: () => [],
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendEvent: () => true,
      appendAuthorityEvent: (_id, type, data) => {
        if (type === APPROVAL_GRANTS_EVENT) persistedGrant = data;
        return true;
      },
      findLatestEvent: (_id, type) =>
        type === APPROVAL_GRANTS_EVENT && persistedGrant
          ? { type, data: persistedGrant }
          : null,
      loadSideEffectLedger: () => null,
    };
    const first = harness({
      options: { sessionId },
      deps: { ...baseStore, sessionExists: () => false },
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "approval",
          id: "appr-1",
          decision: {
            kind: "acceptForSession",
            permissions: [requiredPermission],
          },
          approve: true,
          binding: expectedBinding,
        }) + "\n";
      },
    });
    await first.run();
    expect(persistedGrant).not.toBeNull();

    const resumedLoop = async function* (_messages, opts) {
      const allowed = await opts.permissionConfirm(context);
      yield {
        type: "response-complete",
        content: allowed ? "restored grant" : "denied",
      };
      yield { type: "run-ended", reason: "complete" };
    };
    const resumed = harness({
      options: { sessionId },
      agentLoop: resumedLoop,
      deps: {
        ...baseStore,
        sessionExists: () => true,
        readSessionHostResumeState: () => verifiedResume(sessionId),
      },
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "continue" }) + "\n";
      },
    });
    await resumed.run();
    expect(
      resumed.events().filter((event) => event.type === "approval_request"),
    ).toHaveLength(0);
    expect(
      resumed.events().find((event) => event.type === "result").result,
    ).toBe("restored grant");
  });

  it("discards a corrupt persisted grant ledger and asks again", async () => {
    const context = {
      tool: "run_shell",
      command: "npm run test:unit",
      riskLevel: "medium",
      reason: "settings rule asks",
    };
    const expectedBinding = approvalBindingDigest({
      toolCallId: "appr-1",
      args: { command: context.command },
      policyDigest: context.riskLevel,
    });
    const h = harness({
      options: { sessionId: "corrupt-approval-grants" },
      deps: {
        sessionExists: () => false,
        startSession: () => {},
        readEvents: () => [],
        readVerifiedEvents: () => [],
        appendUserMessage: () => {},
        appendAssistantMessage: () => {},
        appendEvent: () => true,
        appendAuthorityEvent: () => true,
        findLatestEvent: (_id, type) =>
          type === APPROVAL_GRANTS_EVENT
            ? { type, data: { schema: "corrupt" } }
            : null,
        loadSideEffectLedger: () => null,
      },
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "approval",
          id: "appr-1",
          decision: { kind: "acceptOnce" },
          approve: true,
          binding: expectedBinding,
        }) + "\n";
      },
    });
    await h.run();
    expect(h.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "recovery_degraded",
          component: "approval_grants",
        }),
        expect.objectContaining({ type: "approval_request", id: "appr-1" }),
      ]),
    );
    expect(h.events().find((event) => event.type === "result").result).toBe(
      "executed",
    );
  });

  it("a mismatched binding is rejected (deny, fail closed) — replay/param-substitution", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80);
        // A stale / mis-routed verdict for this id carrying a binding computed
        // from DIFFERENT args must NOT green-light the blocked tool.
        yield JSON.stringify({
          type: "approval",
          id: "appr-1",
          approve: true,
          binding: "ab_00000000000000000000000000000000",
        }) + "\n";
      },
    });
    await h.run();
    expect(
      h.events().find((e) => e.type === "approval_resolved"),
    ).toMatchObject({ approved: false, via: "binding-mismatch" });
    expect(h.events().find((e) => e.type === "result").result).toBe(
      "skipped (denied)",
    );
  });

  it("timeout fails closed", async () => {
    process.env.CC_APPROVAL_TIMEOUT_MS = "60";
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(400); // keep stdin open well past the approval timeout
      },
    });
    await h.run();
    expect(
      h.events().find((e) => e.type === "approval_resolved"),
    ).toMatchObject({ approved: false, via: "timeout" });
    expect(h.events().find((e) => e.type === "result").result).toBe(
      "skipped (denied)",
    );
  });

  it("stdin close while pending fails closed (no hang)", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "do the RISKY thing" }) +
          "\n";
        await sleep(80);
        // generator ends → stdin closes with the approval still pending
      },
    });
    const outcome = await h.run();
    expect(
      h.events().find((e) => e.type === "approval_resolved"),
    ).toMatchObject({ approved: false, via: "stdin-closed" });
    expect(outcome.exitCode).toBe(0);
  });

  it("flag off → no permissionConfirm is injected (fail-closed stays)", async () => {
    let sawConfirm = "unset";
    const h = harness({
      options: { interactiveApprovals: false },
      agentLoop: async function* (messages, opts) {
        sawConfirm = typeof opts.permissionConfirm;
        yield { type: "response-complete", content: "ok" };
        yield { type: "run-ended", reason: "complete" };
      },
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "hi" }) + "\n";
      },
    });
    await h.run();
    expect(sawConfirm).toBe("undefined");
  });

  it("the ApprovalGate confirmer is swapped only when the flag is on", async () => {
    const captured = [];
    const gate = {
      setSessionPolicy: () => {},
      setConfirmer: (fn) => captured.push(fn),
    };
    for (const interactiveApprovals of [true, false]) {
      const lines = [];
      await runAgentHeadlessStream(
        { expandFileRefs: false, interactiveApprovals },
        {
          bootstrap: async () => ({ db: null }),
          getApprovalGate: async () => gate,
          writeOut: (s) => lines.push(s),
          writeErr: () => {},
          agentLoop: async function* () {
            yield { type: "response-complete", content: "ok" };
            yield { type: "run-ended", reason: "complete" };
          },
          input: (async function* () {
            yield JSON.stringify({ type: "user", text: "hi" }) + "\n";
          })(),
        },
      );
    }
    expect(captured).toHaveLength(2);
    // interactive: an async confirmer that emits approval_request (arity 0-1
    // promise fn); off: the permission-mode deny confirmer. They must differ.
    expect(captured[0]).not.toBe(captured[1]);
    expect(await captured[1]({})).toBe(false); // perm-mode deny confirmer
  });
});
