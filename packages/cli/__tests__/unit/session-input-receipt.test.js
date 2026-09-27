import { afterAll, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

const root = mkdtempSync(join(tmpdir(), "cc-input-receipt-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const { startSession, appendCompactEvent, readEvents, rebuildMessages } =
  await import("../../src/harness/jsonl-session-store.js");
const { appendSessionInputWithReceipt, readSessionInputReceipt } =
  await import("../../src/lib/session-input-receipt.js");
const { registerSessionShowSubcommand } =
  await import("../../src/commands/session-show.js");
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("durable input acceptance", () => {
  it("accepts once, reads without executing and retains the receipt after compaction", () => {
    const id = "input-session";
    startSession(id, { provider: "test", model: "test" });
    expect(readSessionInputReceipt(id, "client-1").accepted).toBe(false);
    const first = appendSessionInputWithReceipt(id, "question", "client-1");
    expect(first).toMatchObject({
      duplicate: false,
      clientMessageId: "client-1",
      sessionId: id,
    });
    expect(first.eventHash).toMatch(/^[a-f0-9]{64}$/u);
    const duplicate = appendSessionInputWithReceipt(id, "question", "client-1");
    expect(duplicate).toEqual({ ...first, duplicate: true });
    expect(
      readEvents(id).filter((e) => e.type === "user_message"),
    ).toHaveLength(1);
    expect(rebuildMessages(id).map((m) => m.content)).toContain("question");
    appendCompactEvent(id, {
      messages: [{ role: "assistant", content: "summary" }],
    });
    expect(readSessionInputReceipt(id, "client-1")).toMatchObject({
      accepted: true,
      receipt: { eventHash: first.eventHash },
    });
    expect(
      appendSessionInputWithReceipt(id, "question", "client-1").duplicate,
    ).toBe(true);
  });

  it("refuses ID reuse with different input and does not add a second turn", () => {
    const id = "input-conflict";
    startSession(id, { provider: "test", model: "test" });
    appendSessionInputWithReceipt(id, "first", "client-1");
    expect(() =>
      appendSessionInputWithReceipt(id, "second", "client-1"),
    ).toThrow("different input");
    expect(
      readEvents(id).filter((e) => e.type === "user_message"),
    ).toHaveLength(1);
    expect(() => readSessionInputReceipt(id, "../bad")).toThrow(
      "client_message_id",
    );
  });

  it("binds acceptance to the original submission independently of expanded context", () => {
    const id = "input-expanded";
    startSession(id, { provider: "test", model: "test" });
    const submission = { text: "@README.md", images: [] };
    const first = appendSessionInputWithReceipt(
      id,
      "old expanded file",
      "client-1",
      submission,
    );
    const repeated = appendSessionInputWithReceipt(
      id,
      "new expanded file",
      "client-1",
      submission,
    );
    expect(repeated).toEqual({ ...first, duplicate: true });
    expect(rebuildMessages(id).map((m) => m.content)).toContain(
      "old expanded file",
    );
    expect(rebuildMessages(id).map((m) => m.content)).not.toContain(
      "new expanded file",
    );
  });

  it("does not trust a receipt in a tampered transcript", () => {
    const id = "input-tampered";
    startSession(id, { provider: "test", model: "test" });
    appendSessionInputWithReceipt(id, "first", "client-1");
    appendFileSync(
      join(root, "home", "sessions", `${id}.jsonl`),
      '{"type":"user_message","data":{"clientMessageId":"client-2"}}\n',
    );
    expect(() => readSessionInputReceipt(id, "client-1")).toThrow();
    expect(() =>
      appendSessionInputWithReceipt(id, "first", "client-1"),
    ).toThrow();
  });

  it("queries the verified receipt through session show without running an agent", async () => {
    const id = "input-command";
    startSession(id, { provider: "test", model: "test" });
    const receipt = appendSessionInputWithReceipt(id, "first", "client-1");
    const before = readEvents(id);
    const program = new Command();
    registerSessionShowSubcommand(program.command("session"), program);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await program.parseAsync(
        ["session", "show", id, "--json", "--input-receipt", "client-1"],
        { from: "user" },
      );
      expect(JSON.parse(output.mock.calls.at(-1)[0])).toMatchObject({
        accepted: true,
        receipt: { eventHash: receipt.eventHash },
      });
      expect(readEvents(id)).toEqual(before);
    } finally {
      output.mockRestore();
    }
  });
});
