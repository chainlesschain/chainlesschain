import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnBindingLog } from "../../src/lib/turn-binding.js";
import { Command } from "commander";
import { ContextMemoryKernel } from "@chainlesschain/context-memory-kernel";

const testDir = join(tmpdir(), `cc-checkpoint-timeline-${process.pid}`);
const sessionsDir = join(testDir, "sessions");
const securityAnchorDir = `${testDir}-security-anchors`;

vi.mock("../../src/lib/paths.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getHomeDir: () => testDir,
  getStatePath: () => join(testDir, "state"),
  getMachineSecurityAnchorDir: () => securityAnchorDir,
  resolveConfigDataRoot: () => ({ path: testDir, source: "chainlesschain" }),
  getClaudeProjectStorageDir: () => null,
}));

const store = await import("../../src/harness/jsonl-session-store.js");
const bindings = await import("../../src/lib/turn-binding-store.js");
const { JsonlSessionContextPort } =
  await import("../../src/lib/context-memory-kernel/jsonl-session-context-port.js");
const { readSessionTranscriptHistory } =
  await import("../../src/lib/session-transcript-history.js");
const { registerCheckpointCommand } =
  await import("../../src/commands/checkpoint.js");

describe("checkpoint timeline atomic session commit", () => {
  beforeEach(() => mkdirSync(sessionsDir, { recursive: true }));
  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    rmSync(securityAnchorDir, { recursive: true, force: true });
  });

  it("compare-and-appends only at the exact transcript head", () => {
    store.startSession("timeline-cas", { title: "timeline CAS" });
    const first = store.appendEvent("timeline-cas", "user_message", {
      role: "user",
      content: "one",
    });
    const claimed = store.appendEventIfHead(
      "timeline-cas",
      "checkpoint_timeline_action_intent",
      { revision: "r1" },
      first.hash,
    );
    expect(claimed.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      store.appendEventIfHead(
        "timeline-cas",
        "checkpoint_timeline_action_intent",
        { revision: "stale" },
        first.hash,
      ),
    ).toThrowError(expect.objectContaining({ code: "SESSION_REVISION_STALE" }));
  });

  it("one composite event atomically replaces replay messages and binding", () => {
    store.startSession("timeline-commit", { title: "timeline commit" });
    const first = store.appendEvent("timeline-commit", "user_message", {
      role: "user",
      content: "old",
    });
    const log = new TurnBindingLog();
    log.startTurn("turn-kept", { conversationOffset: 2 });
    const messages = [
      { role: "system", content: "system" },
      { role: "user", content: "kept" },
    ];
    const committed = store.appendEventIfHead(
      "timeline-commit",
      bindings.TURN_BINDING_TIMELINE_EVENT,
      {
        action: "restore-conversation",
        messages,
        binding: log.toJSON(),
      },
      first.hash,
    );
    store.appendEvent("timeline-commit", "checkpoint_timeline_action", {
      status: "completed",
    });

    expect(committed.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.rebuildMessages("timeline-commit")).toEqual(messages);
    expect(bindings.loadTurnBindingLog("timeline-commit").list()).toEqual([
      expect.objectContaining({ turnId: "turn-kept", conversationOffset: 2 }),
    ]);
  });

  it("persists and consumes ancestry through real timeline preview and confirmation", async () => {
    const id = "timeline-history-command";
    const workspace = join(testDir, "workspace");
    mkdirSync(workspace, { recursive: true });
    store.startSession(id, {});
    for (let i = 0; i < 4; i++) {
      store.appendUserMessage(id, `question ${i} ${"x".repeat(500)}`);
      store.appendAssistantMessage(id, `answer ${i} ${"y".repeat(500)}`);
    }
    store.appendUserMessage(id, "rewind this turn");
    const original = readSessionTranscriptHistory(id);
    const kernel = new ContextMemoryKernel({
      sessionPort: new JsonlSessionContextPort({ sessionId: id }),
    });
    const compacted = await kernel.compactContext({
      operationId: "timeline-command-compact",
      sessionId: id,
      modelWindowTokens: 200,
      reservedOutputTokens: 20,
      safetyMarginTokens: 10,
      recoveryReserveTokens: 10,
      sink: "provider.local",
      scopeAdmissions: [{ scope: "session", scopeId: id }],
      policyVersion: "test",
      modelProfile: "test",
      now: "2026-09-27T00:00:00.000Z",
    });
    expect(compacted.status).toBe("committed");
    const active = store.readVerifiedMessages(id);
    expect(active.length).toBeLessThan(original.totalMessages);
    const log = new TurnBindingLog();
    log.startTurn("cut", { conversationOffset: active.length + 1 });
    bindings.persistTurnBinding(id, log);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const oldExit = process.exitCode;
    try {
      const invoke = async (args) => {
        const program = new Command();
        registerCheckpointCommand(program);
        await program.parseAsync(
          ["checkpoint", ...args, "-s", id, "-d", workspace, "--json"],
          { from: "user" },
        );
        return JSON.parse(output.mock.calls.at(-1)[0]);
      };
      const timeline = await invoke(["timeline"]);
      const submission = timeline.entries[0].actions.find(
        (action) => action.action === "restore-conversation",
      ).submission;
      const preview = await invoke([
        "action",
        "--preview",
        "--submission",
        JSON.stringify(submission),
      ]);
      expect(preview.ok).toBe(true);
      const result = await invoke([
        "action",
        "--confirm",
        "--submission",
        JSON.stringify(preview.confirmationSubmission),
      ]);
      expect(result.ok).toBe(true);
      const page = readSessionTranscriptHistory(id);
      expect(page.messages).toEqual(original.messages.slice(0, -1));
      expect(page.coverage.kind).toBe("from-origin");
      expect(store.readVerifiedMessages(id)).toEqual(active.slice(0, -1));
      expect(bindings.loadTurnBindingLog(id).list()).toEqual([]);
      const event = store.findLatestEvent(id, "checkpoint_timeline_commit");
      expect(event.data.historyPrefix.sourceHead).toBe(event.prevHash);
    } finally {
      output.mockRestore();
      process.exitCode = oldExit;
    }
  });
});
