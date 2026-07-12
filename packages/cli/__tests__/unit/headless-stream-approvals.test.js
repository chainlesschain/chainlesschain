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
import {
  runAgentHeadlessStream,
  parseInputEvent,
} from "../../src/runtime/headless-stream.js";
import { approvalBindingDigest } from "../../src/lib/agent-authority.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("parseInputEvent — approval verdicts", () => {
  it("parses approve/deny and rejects malformed ones", () => {
    expect(
      parseInputEvent('{"type":"approval","id":"appr-1","approve":true}'),
    ).toEqual({ approval: { id: "appr-1", approve: true, binding: null } });
    expect(
      parseInputEvent('{"type":"approval","id":"appr-2","approve":"yes"}'),
    ).toEqual({ approval: { id: "appr-2", approve: false, binding: null } }); // strict boolean
    expect(parseInputEvent('{"type":"approval"}')).toBe(null); // no id
  });

  it("carries an optional approval binding when present", () => {
    expect(
      parseInputEvent(
        '{"type":"approval","id":"appr-1","approve":true,"binding":"ab_deadbeef"}',
      ),
    ).toEqual({
      approval: { id: "appr-1", approve: true, binding: "ab_deadbeef" },
    });
    // a non-string binding is ignored (stays null)
    expect(
      parseInputEvent(
        '{"type":"approval","id":"appr-1","approve":true,"binding":5}',
      ),
    ).toEqual({ approval: { id: "appr-1", approve: true, binding: null } });
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

  function harness({ inputGen, agentLoop = confirmingLoop, options = {} }) {
    const lines = [];
    const deps = {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (s) => lines.push(s),
      writeErr: () => {},
      agentLoop,
      input: inputGen(),
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

  it("approval_request advertises a binding; echoing it back approves", async () => {
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
    ).toMatchObject({ id: "appr-1", approved: true, via: "user-approve" });
    expect(h.events().find((e) => e.type === "result").result).toBe("executed");
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
