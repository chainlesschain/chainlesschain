import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { agentLoop } from "../../src/runtime/agent-core.js";
import {
  createMockLLMProvider,
  mockTextMessage,
  mockToolCallMessage,
} from "../../src/harness/mock-llm-provider.js";
import { normalizeGoldenTranscript } from "../../src/harness/golden-transcript.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(
  here,
  "../fixtures/golden-transcripts/read-file.json",
);

async function drain(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("Phase 7 parity: file-backed golden transcripts", () => {
  let workspace;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "parity-golden-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("matches the canonical read-file transcript across platforms", async () => {
    const target = join(workspace, "note.txt");
    writeFileSync(target, "golden transcript content", "utf8");

    const mock = createMockLLMProvider([
      {
        response: {
          message: mockToolCallMessage("read_file", { path: target }, "call-1"),
        },
      },
      {
        expect: (messages) =>
          messages.some(
            (message) =>
              message.role === "tool" &&
              message.content.includes("golden transcript content"),
          ),
        response: { message: mockTextMessage("Read complete.") },
      },
    ]);

    const actual = normalizeGoldenTranscript(
      await drain(
        agentLoop([{ role: "user", content: "Read note.txt" }], {
          provider: "mock",
          model: "mock-1",
          cwd: workspace,
          chatFn: mock.chatFn,
        }),
      ),
      { workspace },
    );
    const expected = JSON.parse(readFileSync(fixturePath, "utf8"));

    expect(actual).toEqual(expected);
    mock.assertDrained();
  });

  it("removes volatile envelope fields recursively", () => {
    expect(
      normalizeGoldenTranscript([
        {
          type: "assistant.completed",
          eventId: "random",
          timestamp: Date.now(),
          sequence: 9,
          payload: { content: "ok", durationMs: 12 },
        },
      ]),
    ).toEqual([
      { payload: { content: "ok" }, type: "assistant.completed" },
    ]);
  });
});
