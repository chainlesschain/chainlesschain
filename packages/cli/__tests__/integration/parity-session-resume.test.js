/**
 * Parity Harness — JSONL session resume round-trip
 *
 * Phase 7 Step 6. Exercises the append-only JSONL session store through
 * its public canonical API (`startSession`, `appendUserMessage`,
 * `appendAssistantMessage`, `appendCompactEvent`, `rebuildMessages`,
 * `validateJsonlSession`) and asserts that:
 *
 *   1. A written session can be replayed via `rebuildMessages()` into a
 *      messages array whose shape matches what `agentLoop` consumes.
 *   2. A resumed session, when fed into `agentLoop` with the mock LLM
 *      provider, preserves prior history and produces a deterministic
 *      continuation event.
 *   3. `compact` events act as a history boundary: messages before the
 *      last compact are replaced by the compact's `messages` payload,
 *      and only events AFTER the compact are appended.
 *   4. Tool-call / tool-result events are NOT surfaced in rebuilt
 *      history — only user / assistant / system messages are.
 *   5. `validateJsonlSession()` reports `valid: true` with the correct
 *      event and message counts.
 *
 * Cross-platform path isolation: both `getHomeDir()` (used by the store)
 * and `os.homedir()` consult `USERPROFILE` (win32) and `HOME` (posix),
 * so overriding those env vars in `beforeEach` redirects all session
 * file I/O into a temp dir without any mocking.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir, platform } from "os";
import { join } from "path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import { PlanModeManager } from "../../src/lib/plan-mode.js";
import {
  startSession,
  appendUserMessage,
  appendAssistantMessage,
  appendToolCall,
  appendToolResult,
  appendCompactEvent,
  appendEvent,
  rebuildMessages,
  readEvents,
  validateJsonlSession,
  sessionExists,
} from "../../src/harness/jsonl-session-store.js";
import {
  createMockLLMProvider,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

async function drain(iterable) {
  const out = [];
  for await (const event of iterable) {
    if (event.type === "run-started" || event.type === "run-ended") continue;
    out.push(event);
  }
  return out;
}

describe("Phase 7 parity: JSONL session resume round-trip", () => {
  let tmpHome;
  let savedEnv;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "parity-session-"));
    savedEnv = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
    };
    // Redirect homedir() — both getHomeDir() (store) and os.homedir()
    // consult these env vars. Writing to process.env updates the
    // in-process view; no need to respawn Node.
    if (platform() === "win32") {
      process.env.USERPROFILE = tmpHome;
    } else {
      process.env.HOME = tmpHome;
    }
    // Set both regardless, so the test is robust on any platform where
    // the interpreter happens to pick a different one first.
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = savedEnv.HOME;
    process.env.USERPROFILE = savedEnv.USERPROFILE;
    if (savedEnv.HOME === undefined) delete process.env.HOME;
    if (savedEnv.USERPROFILE === undefined) delete process.env.USERPROFILE;
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("round-trip: write → rebuildMessages → agentLoop continues with correct history", async () => {
    const id = startSession("session-parity-round-trip", {
      title: "parity",
      provider: "mock",
      model: "mock-1",
    });

    expect(sessionExists(id)).toBe(true);

    appendUserMessage(id, "what is 2+2?");
    appendAssistantMessage(id, "4");
    appendUserMessage(id, "and 3+3?");

    // Rebuild and verify shape
    const rebuilt = rebuildMessages(id);
    expect(rebuilt).toEqual([
      { role: "user", content: "what is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "and 3+3?" },
    ]);

    // Feed rebuilt history into agentLoop — the mock LLM continues
    // from where the session left off. The history must reach the
    // provider verbatim for parity to hold.
    const mock = createMockLLMProvider([
      {
        expect: (messages) => {
          // Verify the LLM sees the full replayed history plus any
          // appended items the test added (none here).
          const roles = messages.map((m) => m.role).join(",");
          return roles === "user,assistant,user";
        },
        response: { message: mockTextMessage("6") },
      },
    ]);

    const events = await drain(
      agentLoop(rebuilt, {
        provider: "mock",
        model: "mock-1",
        cwd: tmpHome,
        chatFn: mock.chatFn,
        planManager: new PlanModeManager(),
      }),
    );

    expect(events).toEqual([{ type: "response-complete", content: "6" }]);
    mock.assertDrained();

    // Persist the continuation and verify it round-trips
    appendAssistantMessage(id, "6");
    const rebuilt2 = rebuildMessages(id);
    expect(rebuilt2).toHaveLength(4);
    expect(rebuilt2[3]).toEqual({ role: "assistant", content: "6" });
  });

  it("compact boundary: messages before last compact are replaced by the compact payload", async () => {
    const id = startSession("session-parity-compact");

    appendUserMessage(id, "old-1");
    appendAssistantMessage(id, "old-reply-1");
    appendUserMessage(id, "old-2");
    appendAssistantMessage(id, "old-reply-2");

    // Compact event replaces all prior history with a condensed view.
    appendCompactEvent(id, {
      messages: [
        {
          role: "system",
          content: "[summary: discussed old-1 and old-2 in detail]",
        },
      ],
      stats: { tokensSaved: 1234 },
    });

    // New turn after the compact
    appendUserMessage(id, "new-question");
    appendAssistantMessage(id, "new-answer");

    const rebuilt = rebuildMessages(id);
    expect(rebuilt).toEqual([
      {
        role: "system",
        content: "[summary: discussed old-1 and old-2 in detail]",
      },
      { role: "user", content: "new-question" },
      { role: "assistant", content: "new-answer" },
    ]);
  });

  it("tool-call/tool-result events do not pollute rebuilt messages", async () => {
    const id = startSession("session-parity-tools");

    appendUserMessage(id, "read foo.txt");
    // These are observability events and must NOT appear in rebuilt
    // messages — only in the raw event log.
    appendToolCall(id, "read_file", { path: "foo.txt" });
    appendToolResult(id, "read_file", { content: "bar" });
    appendAssistantMessage(id, "It says 'bar'.");

    const rebuilt = rebuildMessages(id);
    expect(rebuilt).toEqual([
      { role: "user", content: "read foo.txt" },
      { role: "assistant", content: "It says 'bar'." },
    ]);

    // But the raw event log should contain everything
    const raw = readEvents(id);
    const types = raw.map((e) => e.type);
    expect(types).toContain("session_start");
    expect(types).toContain("user_message");
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types).toContain("assistant_message");
  });

  it("system events are preserved across rebuildMessages", async () => {
    const id = startSession("session-parity-system");

    appendUserMessage(id, "hi");
    appendEvent(id, "system", {
      role: "system",
      content: "[injected system note]",
    });
    appendAssistantMessage(id, "hello");

    const rebuilt = rebuildMessages(id);
    expect(rebuilt).toEqual([
      { role: "user", content: "hi" },
      { role: "system", content: "[injected system note]" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("validateJsonlSession reports valid, correct counts, and no malformed lines", async () => {
    const id = startSession("session-parity-validate", {
      title: "validate",
    });
    appendUserMessage(id, "u1");
    appendAssistantMessage(id, "a1");
    appendUserMessage(id, "u2");
    appendAssistantMessage(id, "a2");

    const report = validateJsonlSession(id);
    expect(report).toMatchObject({
      sessionId: id,
      valid: true,
      malformedLines: 0,
      hasStartEvent: true,
      messageCount: 4,
    });
    // session_start + 4 messages = 5 events
    expect(report.eventCount).toBe(5);
  });

  it("malformed lines are tolerated by rebuildMessages and flagged by validate", async () => {
    const id = startSession("session-parity-malformed");
    appendUserMessage(id, "before");

    // Inject a garbage line by direct append — simulates a truncated
    // write or a corrupted log entry.
    const { appendFileSync } = await import("fs");
    const { getHomeDir } = await import("../../src/lib/paths.js");
    const filePath = join(getHomeDir(), "sessions", `${id}.jsonl`);
    appendFileSync(filePath, "this is not json\n", "utf-8");

    appendAssistantMessage(id, "after");

    // rebuildMessages skips the malformed line silently
    const rebuilt = rebuildMessages(id);
    expect(rebuilt).toEqual([
      { role: "user", content: "before" },
      { role: "assistant", content: "after" },
    ]);

    // But validateJsonlSession surfaces it
    const report = validateJsonlSession(id);
    expect(report.valid).toBe(false);
    expect(report.malformedLines).toBe(1);
    // Start event + 2 valid messages, malformed line not counted
    expect(report.eventCount).toBe(3);
    expect(report.messageCount).toBe(2);

    // Verify the raw file still exists at the expected location
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toContain("this is not json");
  });
});
