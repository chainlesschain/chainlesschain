/** Additional deterministic behavior controls for frozen baseline coverage gaps. */
export function extraDiagnosticControl(taskId, sourceModuleRelative) {
  const source = JSON.stringify(sourceModuleRelative);
  if (taskId === "verify-05") {
    return `
import { it as controlIt, expect as controlExpect } from "vitest";
import { AgentRouter as ControlRouter } from ${source};

controlIt("installed external CLIs cannot pass dispatch admission", () => {
  for (const type of ["claude", "codex"]) {
    const router = new ControlRouter({ backends: [{ type, installed: true }] });
    controlExpect(() => router.assertDispatchAvailable()).toThrowError(
      controlExpect.objectContaining({
        code: "AGENT_ROUTER_EXTERNAL_MODEL_INGRESS_UNATTESTED",
      }),
    );
  }
  const apiRouter = new ControlRouter({ backends: [{ type: "ollama" }] });
  controlExpect(() => apiRouter.assertDispatchAvailable()).not.toThrow();
});
`;
  }
  if (taskId === "verify-11") {
    return `
import { it as controlIt, expect as controlExpect } from "vitest";
import { BackgroundInteractionJournal as ControlJournal } from ${source};

const controlBinding = {
  backgroundAgentId: "control-background",
  sessionId: "control-session",
  turnId: "control-turn",
  toolUseId: "control-tool",
  sequence: 1,
};
function controlPendingJournal() {
  const journal = new ControlJournal({
    backgroundAgentId: controlBinding.backgroundAgentId,
    now: () => 100,
  });
  journal.recordPending({
    requestId: "control-question",
    binding: controlBinding,
    payload: { question: "Continue?" },
  });
  return journal;
}

controlIt("journal recovery rejects the same question from another session", () => {
  const snapshot = controlPendingJournal().toJSON();
  const restored = ControlJournal.fromJSON(snapshot, {
    expectedSessionId: controlBinding.sessionId,
  });
  controlExpect(restored.pending().map((record) => record.requestId)).toEqual([
    "control-question",
  ]);
  controlExpect(() => ControlJournal.fromJSON(snapshot, {
    expectedSessionId: "different-session",
  })).toThrowError(controlExpect.objectContaining({
    code: "INTERACTION_JOURNAL_CORRUPT",
  }));
});

controlIt("journal pending excludes every terminal status after recovery", () => {
  for (const status of ["resolved", "rejected", "cancelled"]) {
    const journal = controlPendingJournal();
    journal.recordPending({
      requestId: "still-pending",
      binding: { ...controlBinding, toolUseId: "next-tool", sequence: 2 },
      payload: { question: "Next?" },
    });
    journal.settle("control-question", controlBinding, {
      status,
      answer: "yes",
      error: { code: "CONTROL_TERMINAL", message: "finished" },
    });
    const restored = ControlJournal.fromJSON(journal.toJSON(), {
      expectedSessionId: controlBinding.sessionId,
    });
    controlExpect(restored.get("control-question").status).toBe(status);
    controlExpect(restored.pending().map((record) => record.requestId)).toEqual([
      "still-pending",
    ]);
  }
});
`;
  }
  if (taskId === "verify-13") {
    return `
import { it as controlIt, expect as controlExpect } from "vitest";
import { readBoundedImage as controlReadImage } from ${source};

function controlImageFixture(width, changedField = null) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(1, 20);
  let stats = 0;
  let closed = 0;
  return {
    bytes,
    closed: () => closed,
    io: {
      openSync: () => 7,
      fstatSync() {
        stats++;
        return { size: bytes.length, isFile: () => true, mtimeMs: 1, ctimeMs: 1,
          ...(stats > 1 && changedField ? { [changedField]: 2 } : {}) };
      },
      readSync(fd, target, offset, length, position) {
        return bytes.copy(target, offset, position, position + length);
      },
      closeSync() { closed++; },
    },
  };
}

controlIt("a pinned image rejects metadata changes even when all bytes match", () => {
  for (const changedField of ["mtimeMs", "ctimeMs"]) {
    const fixture = controlImageFixture(1, changedField);
    controlExpect(() => controlReadImage("image.png", "image/png", 100, fixture.io))
      .toThrow(/Image changed while being read/);
    controlExpect(fixture.closed()).toBe(1);
  }
});

controlIt("image admission enforces the positive pixel budget boundary", () => {
  const allowed = controlImageFixture(40_000_000);
  controlExpect(controlReadImage("image.png", "image/png", 100, allowed.io))
    .toEqual(allowed.bytes);
  controlExpect(allowed.closed()).toBe(1);
  const oversized = controlImageFixture(40_000_001);
  controlExpect(() => controlReadImage("image.png", "image/png", 100, oversized.io))
    .toThrow(/at most 40 megapixels/);
  controlExpect(oversized.closed()).toBe(1);
});
`;
  }
  if (taskId === "verify-19") {
    return `
import { it as controlIt, expect as controlExpect } from "vitest";
import { PassThrough as ControlInput } from "node:stream";
import { runAgentHeadlessStream as controlRunStream } from ${source};

controlIt("cancelling a pending approval delivers denial to the blocked tool", async () => {
  const input = new ControlInput();
  const controller = new AbortController();
  let toolVerdict = null;
  let approvalRequests = 0;
  input.write(JSON.stringify({ type: "user", text: "Request approval" }) + "\\n");
  try {
    await controlRunStream({
      expandFileRefs: false,
      interactiveApprovals: true,
      settingsHooks: {},
      signal: controller.signal,
    }, {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut(line) {
        const event = JSON.parse(line);
        if (event.type === "approval_request") {
          approvalRequests++;
          queueMicrotask(() => controller.abort());
        }
      },
      writeErr() {},
      async *agentLoop(messages, options) {
        toolVerdict = await options.permissionConfirm({
          tool: "run_shell", command: "control-only", riskLevel: "medium",
          reason: "deterministic pending approval",
        });
        yield { type: "response-complete", content: "control finished" };
        yield { type: "run-ended", reason: "complete" };
      },
      input,
    });
    controlExpect(approvalRequests).toBe(1);
    // The emitted approval_resolved event can say false even if the suspended
    // tool receives true. Assert the actual permission promise's result.
    controlExpect(toolVerdict).toBe(false);
    controlExpect(input.destroyed).toBe(true);
  } finally {
    controller.abort();
    input.destroy();
  }
}, 15000);
`;
  }
  if (taskId === "verify-29") {
    return `
import { it as controlIt, expect as controlExpect } from "vitest";
import { createRequire as controlCreateRequire } from "node:module";
const { acceptModeAcknowledgement: controlAcceptMode } =
  controlCreateRequire(import.meta.url)(${source});

controlIt("matching request IDs cannot authorize another session's mode ACK", () => {
  const conversation = {
    sessionId: "control-session",
    modeRequestId: "control-mode-request",
    mode: "acceptEdits",
    effectiveMode: "default",
    modeStatus: "pending",
    policyRevision: null,
    modeError: "",
  };
  const before = { ...conversation };
  const event = {
    session_id: "different-session",
    permission_mode_state: {
      correlation_id: conversation.modeRequestId,
      requested: conversation.mode,
      effective: "acceptEdits",
      policy_revision: "a".repeat(64),
    },
  };
  controlExpect(controlAcceptMode(conversation, event)).toBe(false);
  controlExpect(conversation).toEqual(before);
  controlExpect(controlAcceptMode(conversation, {
    ...event, session_id: conversation.sessionId,
  })).toBe(true);
  controlExpect(conversation).toMatchObject({
    effectiveMode: "acceptEdits",
    modeStatus: "effective",
    policyRevision: event.permission_mode_state.policy_revision,
  });
});
`;
  }
  return "";
}
