import "../helpers/test-model-egress.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import {
  startSession,
  appendUserMessage,
  appendToolRoundsIfMessagesMatch,
  readVerifiedMessages,
  readVerifiedEvents,
} from "../../src/harness/jsonl-session-store.js";
import { readSessionInputReceipt } from "../../src/lib/session-input-receipt.js";
import { SESSION_RUNTIME_RELEASE_MARKER } from "../../src/lib/session-runtime-retention.js";
import { PromptCompressor } from "../../src/harness/prompt-compressor.js";

let root;
let workspace;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-headless-receipt-"));
  workspace = join(root, "workspace");
  mkdirSync(workspace);
  vi.stubEnv("CHAINLESSCHAIN_HOME", join(root, "home"));
  vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", join(root, "anchors"));
  vi.stubEnv("CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE", "canonical_default");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function run(id, prompt, chatFn, extra = {}) {
  const events = [];
  const result = await runAgentHeadlessStream(
    {
      sessionId: id,
      cwd: workspace,
      provider: "volcengine",
      model: "deepseek-v4-1-flash-260910",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "offline-test-key",
      includePartialMessages: true,
      expandFileRefs: false,
      projectMemory: false,
      useRegisteredMcp: false,
      ...extra,
    },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      ...(chatFn ? { chatFn } : {}),
      input: (async function* () {
        yield JSON.stringify({
          type: "user",
          content: prompt,
          client_message_id: `input-${prompt.length}`,
        }) + "\n";
      })(),
      writeOut: (line) => events.push(JSON.parse(line)),
      writeErr: () => {},
    },
  );
  expect(
    result.exitCode,
    JSON.stringify(events.filter((event) => event.type === "result")),
  ).toBe(0);
  return events;
}

it("settles a newly executed tool before long-session retention and resumes its bounded checkpoint", async () => {
  // Isolate result retention from the independent semantic-compaction trigger.
  vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockReturnValue(
    false,
  );
  const id = "receipt-retention";
  startSession(id, {});
  appendUserMessage(id, "Earlier inspection");
  const expected = readVerifiedMessages(id);
  const rounds = Array.from({ length: 32 }, (_, index) => [
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: `old-${index}`,
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: `old-${index}`,
      content: `${index}:`.padEnd(2048, "x"),
    },
  ]).flat();
  appendToolRoundsIfMessagesMatch(id, [...expected, ...rounds], expected);
  writeFileSync(join(workspace, "new.txt"), "Fresh local evidence");
  let calls = 0;
  const events = await run(id, "Inspect new.txt", async () => ({
    message:
      ++calls === 1
        ? {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "new-read",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: '{"path":"new.txt"}',
                },
              },
            ],
          }
        : { role: "assistant", content: "Inspection complete" },
    usage: { input_tokens: 10, output_tokens: 10 },
  }));
  expect(calls).toBe(2);
  expect(
    events.some((event) =>
      JSON.stringify(event).includes("retention-degraded"),
    ),
  ).toBe(false);
  const persisted = readVerifiedEvents(id);
  const compact = persisted.find(
    (event) =>
      event.type === "compact" && event.data.trigger === "runtime-retention",
  );
  expect(
    compact,
    JSON.stringify(
      persisted
        .filter((event) => event.type === "compact")
        .map((event) => ({
          trigger: event.data.trigger,
          strategy: event.data.strategy,
        })),
    ),
  ).toBeDefined();
  expect(persisted.filter((event) => event.type === "tool_round")).toHaveLength(
    2,
  );
  const active = readVerifiedMessages(id);
  expect(active.filter((message) => message.role === "tool")).toHaveLength(33);
  expect(active.find((message) => message.role === "tool").content).toContain(
    SESSION_RUNTIME_RELEASE_MARKER,
  );
  expect(
    persisted.find((event) => event.type === "tool_round").data.messages[1]
      .content,
  ).toBe(rounds[1].content);
  expect(readSessionInputReceipt(id, "input-15").accepted).toBe(true);
  const resumed = await run(id, "Confirm saved evidence", async (messages) => {
    // Provider context planning may select a bounded subset of old evidence;
    // the durable transcript must still retain every completed exchange.
    expect(
      messages.find(
        (message) =>
          message.role === "tool" && message.tool_call_id === "new-read",
      ),
    ).toBeDefined();
    expect(
      messages.some(
        (message) =>
          Object.hasOwn(message, "clientMessageId") ||
          Object.hasOwn(message, "inputDigest"),
      ),
    ).toBe(false);
    return {
      message: { role: "assistant", content: "Saved evidence confirmed" },
      usage: { input_tokens: 10, output_tokens: 10 },
    };
  });
  expect(resumed.filter((event) => event.type === "tool_use")).toHaveLength(0);
  expect(
    readVerifiedMessages(id).filter((message) => message.role === "tool"),
  ).toHaveLength(33);
}, 60000);

it("persists nine Git tools from real Volcengine SSE with IDE receipts and checkpoints without replay", async () => {
  const git = (args) => {
    const result = spawnSync("git", args, {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status, result.stderr).toBe(0);
  };
  git(["init", "--quiet"]);
  for (let index = 0; index < 9; index++)
    writeFileSync(join(workspace, `file-${index}.txt`), "before\n");
  git(["add", "."]);
  git([
    "-c",
    "user.name=Offline Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  for (let index = 0; index < 9; index++)
    writeFileSync(join(workspace, `file-${index}.txt`), "after\n");
  const requests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    expect(String(url)).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    );
    const request = JSON.parse(options.body);
    expect(request.stream).toBe(true);
    expect(request.model).toBe("deepseek-v4-1-flash-260910");
    expect(
      request.messages.some(
        (message) =>
          Object.hasOwn(message, "clientMessageId") ||
          Object.hasOwn(message, "inputDigest"),
      ),
    ).toBe(false);
    requests.push(request);
    const batch = requests.length - 1;
    const delta =
      batch < 3
        ? {
            role: "assistant",
            content: null,
            tool_calls: Array.from({ length: 3 }, (_, index) => ({
              index,
              id: `git-${batch * 3 + index}`,
              type: "function",
              function: {
                name: "git",
                arguments: JSON.stringify({
                  command: `diff -- file-${batch * 3 + index}.txt`,
                }),
              },
            })),
          }
        : { role: "assistant", content: "All diffs checked" };
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta }], usage: { prompt_tokens: 10, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const first = await run("git-receipts", "Inspect all nine Git diffs", null, {
    autoCheckpoint: true,
  });
  expect(requests).toHaveLength(4);
  expect(first.filter((event) => event.type === "tool_result")).toHaveLength(9);
  expect(
    first
      .filter((event) => event.type === "tool_result")
      .every((event) => !event.is_error),
  ).toBe(true);
  const durable = readVerifiedMessages("git-receipts");
  expect(durable.filter((message) => message.role === "tool")).toHaveLength(9);
  const resumed = await run(
    "git-receipts",
    "Confirm the persisted diff findings",
    null,
    { autoCheckpoint: true },
  );
  expect(requests).toHaveLength(5);
  expect(
    requests[4].messages
      .filter((message) => message.role !== "system")
      .slice(0, durable.length),
  ).toEqual(durable);
  expect(resumed.filter((event) => event.type === "tool_use")).toHaveLength(0);
  expect(
    readVerifiedMessages("git-receipts").filter(
      (message) => message.role === "tool",
    ),
  ).toHaveLength(9);
}, 60000);
