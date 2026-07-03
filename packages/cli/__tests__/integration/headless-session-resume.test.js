/**
 * Integration: a SessionResume settings hook fires when `cc agent --resume`
 * replays a persisted session's prior history — distinct from SessionStart
 * (which also fires on a fresh startup). Uses a stubbed JSONL store to inject
 * history and a real `node -e` hook so the fire path is exercised end to end.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

const NODE = process.execPath.replace(/\\/g, "/");
let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-resume-"));
});
afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function baseDeps(history) {
  return {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: () => {},
    writeErr: () => {},
    agentLoop: async function* () {
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    },
    sessionExists: () => true,
    rebuildMessages: () => history,
    startSession: () => {},
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    appendTokenUsage: () => {},
    appendCompactEvent: () => {},
    getLastSessionId: () => "sid",
  };
}

const resumeHook = (sentinel) => ({
  SessionResume: [
    {
      matcher: null,
      hooks: [
        {
          type: "command",
          // Single-quote the JS string so it doesn't collide with the outer
          // double-quoted `-e "..."`; escape Windows backslashes for the path.
          command: `"${NODE}" -e "require('fs').writeFileSync('${sentinel.replace(/\\/g, "\\\\")}','x')"`,
        },
      ],
    },
  ],
});

describe("headless SessionResume hook", () => {
  it("fires when replaying a persisted session's history", async () => {
    const sentinel = path.join(tmp, "RESUMED");
    await runAgentHeadless(
      {
        prompt: "continue please",
        resume: "sid",
        outputFormat: "json",
        expandFileRefs: false,
        settingsHooks: resumeHook(sentinel),
      },
      baseDeps([
        { role: "user", content: "prior task" },
        { role: "assistant", content: "prior reply" },
      ]),
    );
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it("does NOT fire on a fresh (non-resumed) run", async () => {
    const sentinel = path.join(tmp, "SHOULD_NOT_RESUME");
    await runAgentHeadless(
      {
        prompt: "hello",
        outputFormat: "json",
        expandFileRefs: false,
        settingsHooks: resumeHook(sentinel),
      },
      baseDeps([]), // no resume id, no history
    );
    expect(fs.existsSync(sentinel)).toBe(false);
  });
});
