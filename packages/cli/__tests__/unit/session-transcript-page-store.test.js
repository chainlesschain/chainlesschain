import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "cc-transcript-page-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const { startSession, appendUserMessage, appendAssistantMessage } =
  await import("../../src/harness/jsonl-session-store.js");
const { readSessionTranscriptPage } =
  await import("../../src/lib/session-transcript-page.js");
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("canonical transcript page reader", () => {
  it("uses the verified store and fails on tampered history", () => {
    const id = "page-session";
    startSession(id, { provider: "test", model: "test" });
    appendUserMessage(id, "question");
    appendAssistantMessage(id, "answer");
    const last = readSessionTranscriptPage(id, { limit: 1 });
    expect(last.messages.map((m) => m.text)).toEqual(["answer"]);
    expect(
      readSessionTranscriptPage(id, { limit: 1, cursor: last.nextCursor })
        .messages[0].text,
    ).toBe("question");
    appendFileSync(
      join(root, "home", "sessions", `${id}.jsonl`),
      '{"type":"assistant_message","data":{"role":"assistant","content":"forged"}}\n',
    );
    expect(() => readSessionTranscriptPage(id)).toThrow();
  });
});
