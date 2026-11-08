import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "cc-input-lifecycle-integration-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getSessionStoreDir: () => join(root, "home", "sessions"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const { startSession, rebuildMessages, readEvents } =
  await import("../../src/harness/jsonl-session-store.js");
const { appendSessionInputAcceptance, appendSessionInputSettlement } =
  await import("../../src/lib/session-input-receipt.js");

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("REPL accepted/settled integration contract", () => {
  it("keeps accepted input private until one settled event publishes both messages", () => {
    const sessionId = "repl-lifecycle";
    startSession(sessionId, { provider: "test", model: "test" });
    const accepted = appendSessionInputAcceptance(sessionId, {
      inputId: "repl-input-1",
      turnId: "repl-lifecycle:turn-1",
      prompt: "old prompt with side effect",
    });
    expect(rebuildMessages(sessionId)).toEqual([]);
    expect(
      readEvents(sessionId).some(
        (event) => event.type === "session_input_accepted",
      ),
    ).toBe(true);
    expect(
      readEvents(sessionId).some(
        (event) => event.type === "session_input_settled",
      ),
    ).toBe(false);

    appendSessionInputSettlement(sessionId, accepted, "answer");
    expect(rebuildMessages(sessionId)).toEqual([
      { role: "user", content: "old prompt with side effect" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("rejects acceptance failure before any provider-like dispatch callback", () => {
    const dispatch = vi.fn();
    expect(() =>
      appendSessionInputAcceptance("missing-session", {
        inputId: "bad input id",
        turnId: "missing-session:turn-1",
        prompt: "must not dispatch",
      }),
    ).toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
