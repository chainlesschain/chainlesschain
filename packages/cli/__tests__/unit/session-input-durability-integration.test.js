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
const { projectVerifiedSessionHostSnapshot } =
  await import("../../src/lib/session-host-snapshot.js");
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

  it("keeps pending prompt text out of the public host snapshot", () => {
    const sessionId = "repl-private-pending";
    startSession(sessionId, { provider: "test", model: "test" });
    appendSessionInputAcceptance(sessionId, {
      inputId: "repl-input-private",
      turnId: "repl-private-pending:turn-1",
      prompt: "private pending prompt",
    });
    const projected = projectVerifiedSessionHostSnapshot(
      sessionId,
      readEvents(sessionId),
    );
    expect(JSON.stringify(projected.snapshot)).not.toContain(
      "private pending prompt",
    );
    expect(projected.inputRecovery.pendingInputs).toHaveLength(1);
    expect(projected.inputRecovery.pendingInputs[0].prompt).toBe(
      "private pending prompt",
    );
    expect(projected.inputRecovery.summary).toEqual({
      pendingCount: 1,
      inputs: [
        {
          inputId: "repl-input-private",
          turnId: "repl-private-pending:turn-1",
          inputDigest: expect.any(String),
        },
      ],
    });
  });
});
