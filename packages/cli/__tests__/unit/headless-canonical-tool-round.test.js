import "../helpers/test-model-egress.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import {
  PromptCompressor,
  estimateMessagesTokens,
} from "../../src/harness/prompt-compressor.js";
import {
  readVerifiedMessages,
  readVerifiedEvents,
  startSession,
  appendUserMessage,
  appendEvent,
  appendAssistantMessage,
  appendToolRoundsIfMessagesMatch,
  appendCompactEventIfMessagesMatch,
  readVerifiedProjection,
  createBranchSession,
} from "../../src/harness/jsonl-session-store.js";
import { compactLiveMessagesCanonical } from "../../src/lib/context-memory-kernel/live-compaction.js";
import {
  markDurableSystemMessage,
  getDurableSystemMessageProvenance,
  DURABLE_SYSTEM_MESSAGE_KINDS,
  markRuntimeOnlySessionMessage,
} from "../../src/lib/session-message-provenance.js";
import { readSessionHostResumeState } from "../../src/lib/session-host-snapshot.js";
import {
  readSessionTranscriptHistory,
  createSessionTranscriptBranchProjection,
} from "../../src/lib/session-transcript-history.js";
import { readSessionTranscriptPage } from "../../src/lib/session-transcript-page.js";
import { renderAgentSessionMarkdown } from "../../src/lib/agent-session-export.js";

const round = (id = "read-one") => [
  {
    role: "assistant",
    content: `Reading ${id}`,
    tool_calls: [
      {
        id,
        type: "function",
        function: { name: "read_file", arguments: '{"path":"local.txt"}' },
      },
    ],
  },
  { role: "tool", tool_call_id: id, content: `Evidence ${id}` },
];
const compressor = {
  maxTokens: 65536,
  compress: async () => {
    throw new Error("No summarizer call expected");
  },
};

let root;
let workspace;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "headless-tool-round-"));
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

it.each([true, false])(
  "settles actual headless tool rounds with automatic compaction=%s",
  async (automatic) => {
    writeFileSync(join(workspace, "first.txt"), "first local evidence");
    writeFileSync(join(workspace, "second.txt"), "second local evidence");
    writeFileSync(join(workspace, "third.txt"), "third local evidence");
    // Force only the scheduling decision. The runner, loop, canonical planner,
    // tool execution, authority verification and JSONL writer are production code.
    vi.spyOn(
      PromptCompressor.prototype,
      "shouldAutoCompact",
    ).mockImplementation(
      (messages) =>
        automatic && messages.some((message) => message.role === "tool"),
    );
    let calls = 0;
    const lines = [];
    const chatFn = vi.fn(async () => ({
      message:
        ++calls <= 3
          ? {
              role: "assistant",
              content: `Read ${calls}`,
              tool_calls: [
                {
                  id: `read-${calls}`,
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({
                      path: ["first.txt", "second.txt", "third.txt"][calls - 1],
                    }),
                  },
                },
              ],
            }
          : { role: "assistant", content: "Both files checked." },
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
    const result = await runAgentHeadlessStream(
      {
        sessionId: "offline-rounds",
        cwd: workspace,
        provider: "ollama",
        model: "qwen2.5:7b",
        expandFileRefs: false,
        projectMemory: false,
        useRegisteredMcp: false,
      },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        resolveAgentMcp: async () => null,
        chatFn,
        input: (async function* () {
          yield JSON.stringify({
            type: "user",
            content: "Read both local files.",
          }) + "\n";
        })(),
        writeOut: (line) => lines.push(line),
        writeErr: () => {},
      },
    );
    const events = lines.join("").trim().split("\n").map(JSON.parse);
    expect(result.exitCode, JSON.stringify(events)).toBe(0);
    expect(chatFn).toHaveBeenCalledTimes(4);
    expect(
      events.filter((event) =>
        JSON.stringify(event).includes("live messages do not match"),
      ),
    ).toEqual([]);
    const durable = readVerifiedMessages("offline-rounds");
    expect(durable.filter((message) => message.role === "tool")).toHaveLength(
      3,
    );
    expect(
      durable.filter((message) => message.content === "Both files checked."),
    ).toHaveLength(1);
    expect(
      readVerifiedEvents("offline-rounds").filter(
        (event) => event.type === "compact",
      ),
      JSON.stringify(
        events
          .filter((event) =>
            /compact|degrad/.test(
              JSON.stringify({
                type: event.type,
                subtype: event.subtype,
                reason: event.reason,
              }),
            ),
          )
          .map(({ type, reason, code }) => ({ type, reason, code })),
      ),
    ).toHaveLength(automatic ? 2 : 0);
    if (automatic) {
      const resumeChat = vi.fn(async (messages) => {
        expect(
          messages.filter((message) => message.role === "tool"),
        ).toHaveLength(3);
        expect(
          messages.filter(
            (message) => message.content === "Both files checked.",
          ),
        ).toHaveLength(1);
        return {
          message: { role: "assistant", content: "Resumed evidence verified." },
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      });
      const resumed = await runAgentHeadlessStream(
        {
          sessionId: "offline-rounds",
          cwd: workspace,
          provider: "ollama",
          model: "qwen2.5:7b",
          expandFileRefs: false,
          projectMemory: false,
          useRegisteredMcp: false,
        },
        {
          bootstrap: async () => ({ db: null }),
          getApprovalGate: async () => null,
          resolveAgentMcp: async () => null,
          chatFn: resumeChat,
          input: (async function* () {
            yield JSON.stringify({
              type: "user",
              content: "Continue from the recorded evidence.",
            }) + "\n";
          })(),
          writeOut: () => {},
          writeErr: () => {},
        },
      );
      expect(resumed.exitCode).toBe(0);
      expect(resumeChat).toHaveBeenCalledOnce();
      expect(
        readVerifiedMessages("offline-rounds").filter(
          (message) => message.content === "Both files checked.",
        ),
      ).toHaveLength(1);
    }
  },
);

it.each([
  { label: "missing", content: {}, provider: "openai", streaming: false },
  {
    label: "null",
    content: { content: null },
    provider: "openai",
    streaming: false,
  },
  {
    label: "empty",
    content: { content: "" },
    provider: "openai",
    streaming: false,
  },
  {
    label: "volcengine SSE",
    content: {},
    provider: "volcengine",
    streaming: true,
  },
  {
    label: "volcengine SSE null",
    content: { content: null },
    provider: "volcengine",
    streaming: true,
  },
  {
    label: "volcengine SSE empty",
    content: { content: "" },
    provider: "volcengine",
    streaming: true,
  },
])(
  "persists actual adapter tool rounds with $label content and reopens without replay",
  async ({ content, provider, streaming }) => {
    const id = "adapter-rounds";
    writeFileSync(join(workspace, "adapter.txt"), "adapter local evidence");
    const call = {
      id: "adapter-read",
      type: "function",
      function: { name: "read_file", arguments: '{"path":"adapter.txt"}' },
    };
    const requests = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      expect(String(url)).toBe(
        streaming
          ? "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
          : "https://api.openai.com/v1/chat/completions",
      );
      expect(request.stream).toBe(streaming ? true : undefined);
      expect(request.model).toBe(
        streaming ? "deepseek-v4-1-flash-260910" : "gpt-4o",
      );
      const text =
        requests.length === 2
          ? "Evidence checked."
          : "Resumed evidence checked.";
      const message =
        requests.length === 1
          ? { role: "assistant", ...content, tool_calls: [call] }
          : { role: "assistant", content: text };
      const usage = { prompt_tokens: 10, completion_tokens: 10 };
      if (!streaming)
        return new Response(JSON.stringify({ choices: [{ message }], usage }), {
          headers: { "content-type": "application/json" },
        });
      const delta =
        requests.length === 1
          ? {
              role: "assistant",
              ...content,
              tool_calls: [{ index: 0, ...call }],
            }
          : { role: "assistant", content: text };
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta }], usage })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const allEvents = [];
    const run = async (prompt) => {
      const lines = [];
      const outcome = await runAgentHeadlessStream(
        {
          sessionId: id,
          cwd: workspace,
          provider,
          model: streaming ? "deepseek-v4-1-flash-260910" : "gpt-4o",
          baseUrl: streaming
            ? "https://ark.cn-beijing.volces.com/api/v3"
            : "https://api.openai.com/v1",
          apiKey: "test-only-key",
          includePartialMessages: streaming,
          expandFileRefs: false,
          projectMemory: false,
          useRegisteredMcp: false,
        },
        {
          bootstrap: async () => ({ db: null }),
          getApprovalGate: async () => null,
          resolveAgentMcp: async () => null,
          input: (async function* () {
            yield JSON.stringify({
              type: "user",
              content: prompt,
              client_message_id: `adapter-input-${requests.length}`,
            }) + "\n";
          })(),
          writeOut: (line) => lines.push(line),
          writeErr: () => {},
        },
      );
      const events = lines.join("").trim().split("\n").map(JSON.parse);
      allEvents.push(...events);
      expect(
        outcome.exitCode,
        JSON.stringify(events.filter(({ type }) => type === "result")),
      ).toBe(0);
    };
    await run("Read adapter.txt once.");
    const durable = readVerifiedMessages(id);
    expect(durable.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(durable[1]).toEqual({
      role: "assistant",
      content: streaming ? "" : (content.content ?? null),
      tool_calls: [call],
    });
    expect(durable[2]).toMatchObject({ tool_call_id: call.id });
    expect(durable[2].content).toContain("adapter local evidence");
    expect(requests).toHaveLength(2);
    await run("Continue from the recorded evidence.");
    expect(requests).toHaveLength(3);
    expect(
      requests[2].messages
        .filter(({ role }) => role !== "system")
        .slice(0, durable.length),
    ).toEqual(durable);
    expect(allEvents.filter(({ type }) => type === "tool_use")).toHaveLength(1);
    expect(allEvents.filter(({ type }) => type === "tool_result")).toHaveLength(
      1,
    );
    expect(
      readVerifiedMessages(id).filter(({ role }) => role === "tool"),
    ).toHaveLength(1);
    expect(
      readVerifiedEvents(id).filter(({ type }) => type === "tool_round"),
    ).toHaveLength(1);
  },
);

it("preserves complete rounds, durable provenance, display origins and restart replay", async () => {
  const id = "round-store";
  startSession(id, { model: "offline" });
  const summary = markDurableSystemMessage(
    { role: "system", content: "Verified earlier lineage" },
    DURABLE_SYSTEM_MESSAGE_KINDS.FORK_LINEAGE,
  );
  appendEvent(id, "system", summary);
  appendUserMessage(id, "Inspect local evidence");
  const expected = readVerifiedMessages(id);
  const live = [...expected, ...round(), ...round("read-two")];
  appendToolRoundsIfMessagesMatch(id, live, expected);
  const before = readSessionTranscriptHistory(id, { limit: 2 });
  const host = { role: "system", content: "Ephemeral host policy" };
  await expect(
    compactLiveMessagesCanonical([host, ...structuredClone(live)], {
      sessionId: id,
      compressor,
    }),
  ).rejects.toMatchObject({ code: "SESSION_REVISION_STALE" });
  const result = await compactLiveMessagesCanonical([host, ...live], {
    sessionId: id,
    compressor,
  });
  expect(result.receipt.status).toBe("committed");
  expect(result.messages[0]).toBe(host);
  const durable = readVerifiedMessages(id);
  expect(durable.some((message) => message.content === host.content)).toBe(
    false,
  );
  expect(
    getDurableSystemMessageProvenance(
      durable.find((message) => message.content === summary.content),
    ),
  ).toBeTruthy();
  expect(durable.filter((message) => message.role === "tool")).toHaveLength(2);
  appendAssistantMessage(id, "Final answer");
  const resumed = readSessionHostResumeState(id);
  expect(
    resumed.messages.filter((message) => message.content === "Final answer"),
  ).toHaveLength(1);
  expect(
    resumed.messages.filter((message) => message.role === "tool"),
  ).toHaveLength(2);
  const history = readSessionTranscriptHistory(id);
  expect(history.coverage.kind).toBe("from-origin");
  expect(history.totalMessages).toBe(6);
  expect(history.messages.slice(3, 5).map((message) => message.id)).toEqual(
    before.messages.map((message) => message.id),
  );
  expect(
    readSessionTranscriptHistory(id, {
      cursor: before.nextCursor,
    }).messages.map((message) => message.text),
  ).toEqual([
    "Inspect local evidence",
    "Reading read-one",
    "Evidence read-one",
  ]);
  expect(
    readSessionTranscriptPage(id).messages.filter(
      (message) => message.role === "tool",
    ),
  ).toHaveLength(2);
  expect(renderAgentSessionMarkdown(id, readVerifiedEvents(id))).toContain(
    "Evidence read-two",
  );
  const branchMessages = readVerifiedMessages(id);
  appendUserMessage(id, "Discard this turn when branching");
  readVerifiedProjection(id, () =>
    createSessionTranscriptBranchProjection(id, branchMessages, (history) => {
      expect(history).toBeTruthy();
      return createBranchSession({
        branchSessionId: "tool-branch",
        parentSessionId: id,
        messages: branchMessages,
        history,
      });
    }),
  );
  const branch = readVerifiedMessages("tool-branch");
  expect(branch.filter((message) => message.role === "tool")).toEqual([]);
  expect(branch.some((message) => message.tool_calls?.length)).toBe(false);
  expect(
    readSessionTranscriptHistory("tool-branch").messages.map(
      (message) => message.text,
    ),
  ).toEqual(history.messages.map((message) => message.text));
  expect(
    (
      await compactLiveMessagesCanonical(branch, {
        sessionId: "tool-branch",
        compressor,
      })
    ).receipt.status,
  ).toBe("committed");
});

it("rejects stale prefixes and concurrent input without overwriting durable messages", async () => {
  const id = "round-race";
  startSession(id, {});
  appendUserMessage(id, "Original user");
  const before = readVerifiedMessages(id);
  const live = [...before, ...round()];
  appendUserMessage(id, "Concurrent user");
  expect(() => appendToolRoundsIfMessagesMatch(id, live, before)).toThrow(
    /Session messages changed/,
  );
  const newer = readVerifiedMessages(id);
  expect(() => appendToolRoundsIfMessagesMatch(id, live, newer)).toThrow(
    /Session messages changed/,
  );
  expect(readVerifiedMessages(id)).toEqual(newer);
  expect(
    readVerifiedEvents(id).filter((event) => event.type === "tool_round"),
  ).toEqual([]);
});

it.each([
  [{ role: "tool", tool_call_id: "orphan", content: "wrong" }],
  [round()[0]],
  [...round(), round()[1]],
  [
    {
      ...round()[0],
      tool_calls: [round()[0].tool_calls[0], round()[0].tool_calls[0]],
    },
    round()[1],
  ],
  [{ role: "user", content: "injected user" }],
  [
    markDurableSystemMessage(
      { role: "system", content: "injected policy" },
      DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    ),
  ],
])("rejects an incomplete or forbidden tool suffix %#", (suffix) => {
  const id = "invalid-round";
  startSession(id, {});
  appendUserMessage(id, "Original");
  const before = readVerifiedMessages(id);
  expect(() =>
    appendToolRoundsIfMessagesMatch(id, [...before, ...suffix], before),
  ).toThrow();
  expect(readVerifiedMessages(id)).toEqual(before);
});

it("rejects a concurrent user arriving during canonical settlement", async () => {
  const id = "compact-race";
  startSession(id, {});
  appendUserMessage(id, "Original");
  const expected = readVerifiedMessages(id);
  const live = [...expected, ...round()];
  appendToolRoundsIfMessagesMatch(id, live, expected);
  await expect(
    compactLiveMessagesCanonical(live, {
      sessionId: id,
      compressor,
      commit(stats, messages, settlement) {
        appendUserMessage(id, "Concurrent user");
        return appendCompactEventIfMessagesMatch(
          id,
          { ...stats, messages },
          settlement.expectedMessages,
        );
      },
    }),
  ).rejects.toMatchObject({ code: "SESSION_REVISION_STALE" });
  expect(readVerifiedMessages(id).at(-1).content).toBe("Concurrent user");
  expect(
    readVerifiedEvents(id).filter((event) => event.type === "compact"),
  ).toEqual([]);
});

it("compresses settled tool history while keeping the archive and ephemeral policy separate", async () => {
  const id = "round-pressure";
  startSession(id, {});
  for (let index = 0; index < 10; index++) {
    appendUserMessage(id, `Question ${index}`);
    appendAssistantMessage(
      id,
      `Answer ${index}: ${"local evidence ".repeat(100)}`,
    );
  }
  appendUserMessage(id, "Finish the local inspection");
  const expected = readVerifiedMessages(id);
  const nudge = markRuntimeOnlySessionMessage({
    role: "user",
    content: "Host retry: continue the inspection",
  });
  const live = [...expected, nudge, ...round()];
  appendToolRoundsIfMessagesMatch(id, live, expected);
  const before = readSessionTranscriptHistory(id);
  const summarize = vi.fn(async () => ({
    messages: [
      {
        role: "assistant",
        content:
          "Earlier evidence was inspected; finish the current inspection.",
      },
    ],
    stats: { saved: 1000 },
  }));
  const host = {
    role: "system",
    content: "Current host policy only. ".repeat(40),
  };
  const result = await compactLiveMessagesCanonical([host, ...live], {
    sessionId: id,
    compressor: { maxTokens: 2048, compress: summarize },
  });
  expect(result.receipt.status).toBe("committed");
  expect(summarize).toHaveBeenCalledOnce();
  expect(result.messages.length).toBeLessThan(live.length);
  expect(result.messages[0]).toBe(host);
  expect(result.messages).toContain(nudge);
  expect(result.stats.originalMessages).toBe(live.length + 1);
  expect(result.stats.compressedMessages).toBe(result.messages.length);
  expect(result.stats.originalTokens).toBe(
    estimateMessagesTokens([host, ...live]),
  );
  expect(result.stats.compressedTokens).toBe(
    estimateMessagesTokens(result.messages),
  );
  expect(result.stats.saved).toBe(
    result.stats.originalTokens - result.stats.compressedTokens,
  );
  expect(result.messages.indexOf(nudge)).toBeLessThan(
    result.messages.findIndex((message) => message.role === "tool"),
  );
  const durable = readVerifiedMessages(id);
  expect(durable.some((message) => message.content === host.content)).toBe(
    false,
  );
  expect(durable.some((message) => message.content === nudge.content)).toBe(
    false,
  );
  expect(
    durable.some(
      (message) =>
        message.role === "assistant" &&
        message.content ===
          "Earlier evidence was inspected; finish the current inspection.",
    ),
  ).toBe(true);
  expect(readSessionTranscriptHistory(id).messages).toEqual(before.messages);
  const committedEvents = readVerifiedEvents(id).length;
  await expect(
    compactLiveMessagesCanonical(
      [{ role: "system", content: "host policy ".repeat(2000) }, ...durable],
      {
        sessionId: id,
        compressor: { maxTokens: 2048, compress: summarize },
      },
    ),
  ).rejects.toThrow();
  expect(summarize).toHaveBeenCalledOnce();
  expect(readVerifiedEvents(id)).toHaveLength(committedEvents);
});

it.each(["thinking-only", "Stop-hook"])(
  "keeps actual %s retries live while persisting the completed turn",
  async (kind) => {
    writeFileSync(join(workspace, "first.txt"), "first retry evidence");
    writeFileSync(join(workspace, "second.txt"), "second retry evidence");
    vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockReturnValue(
      true,
    );
    let calls = 0;
    const nudgeText =
      kind === "thinking-only"
        ? "only internal reasoning"
        : "Stop hook retry required";
    const hookFile = join(root, "stop-hook.cjs");
    if (kind === "Stop-hook")
      writeFileSync(
        hookFile,
        "let input='';process.stdin.on('data',chunk=>input+=chunk).on('end',()=>{const state=JSON.parse(input);console.log(JSON.stringify(state.stop_hook_active?{}:{decision:'block',reason:'Stop hook retry required'}));});",
      );
    const chatFn = vi.fn(async (messages) => {
      calls += 1;
      if (calls <= 2)
        return {
          message: {
            role: "assistant",
            content: "Reading",
            tool_calls: [
              {
                id: `thinking-read-${calls}`,
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({
                    path: calls === 1 ? "first.txt" : "second.txt",
                  }),
                },
              },
            ],
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      if (calls === 3)
        return {
          message: {
            role: "assistant",
            content: kind === "thinking-only" ? "" : "Premature answer.",
            ...(kind === "thinking-only"
              ? { _thinkingBlocks: [{ thinking: "The evidence is ready." }] }
              : {}),
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      expect(
        messages.some((message) => message.content?.includes?.(nudgeText)),
      ).toBe(true);
      return {
        message: { role: "assistant", content: "Retry completed." },
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const result = await runAgentHeadlessStream(
      {
        sessionId: "thinking-retry",
        cwd: workspace,
        provider: "ollama",
        model: "qwen2.5:7b",
        expandFileRefs: false,
        projectMemory: false,
        useRegisteredMcp: false,
        ...(kind === "Stop-hook"
          ? {
              settingsHooks: {
                Stop: [
                  {
                    hooks: [{ type: "command", command: `node "${hookFile}"` }],
                  },
                ],
              },
            }
          : {}),
      },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        resolveAgentMcp: async () => null,
        chatFn,
        input: (async function* () {
          yield JSON.stringify({
            type: "user",
            content: "Read the two files.",
          }) + "\n";
        })(),
        writeOut: () => {},
        writeErr: () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    expect(chatFn).toHaveBeenCalledTimes(4);
    const durable = readVerifiedMessages("thinking-retry");
    expect(durable.filter((message) => message.role === "user")).toEqual([
      { role: "user", content: "Read the two files." },
    ]);
    expect(
      durable.filter((message) => message.content === "Retry completed."),
    ).toHaveLength(1);
    expect(durable.filter((message) => message.role === "tool")).toHaveLength(
      2,
    );
    expect(JSON.stringify(readVerifiedEvents("thinking-retry"))).not.toContain(
      nudgeText,
    );
  },
);

it("does not trust cloned nudges or provider-supplied runtime-only flags", () => {
  const id = "forged-nudge";
  startSession(id, {});
  appendUserMessage(id, "Real user");
  const expected = readVerifiedMessages(id);
  const nudge = markRuntimeOnlySessionMessage({
    role: "user",
    content: "Host retry",
  });
  for (const forged of [
    structuredClone(nudge),
    { ...nudge, runtimeOnly: true },
    { ...nudge, _cc_runtime_only: true },
  ]) {
    expect(() =>
      appendToolRoundsIfMessagesMatch(
        id,
        [...expected, forged, ...round()],
        expected,
      ),
    ).toThrow();
    expect(readVerifiedMessages(id)).toEqual(expected);
  }
  appendToolRoundsIfMessagesMatch(
    id,
    [...expected, nudge, ...round(), ...round()],
    expected,
  );
  expect(readVerifiedMessages(id)).toEqual([
    ...expected,
    ...round(),
    ...round(),
  ]);
});

it("fails closed on malformed or unsupported persisted tool-round schemas", () => {
  for (const [index, data] of [
    { schema: "chainlesschain.session-tool-round/v2", messages: round() },
    { schema: "chainlesschain.session-tool-round/v1", messages: [round()[1]] },
  ].entries()) {
    const id = `invalid-wire-${index}`;
    startSession(id, {});
    appendEvent(id, "tool_round", data);
    expect(() => readVerifiedMessages(id)).toThrow();
    expect(() => readVerifiedEvents(id)).toThrow();
    expect(() => readSessionTranscriptHistory(id)).toThrow();
  }
});

it.each([
  "transport",
  "user-input-pending",
  "interrupt",
  "interrupt-reused-id",
  "concurrent-input",
])("settles retained rounds before another input after %s", async (mode) => {
  let announceStarted;
  const started = new Promise((resolve) => {
    announceStarted = resolve;
  });
  let turns = 0;
  const lines = [];
  const run = runAgentHeadlessStream(
    {
      sessionId: "continuation",
      cwd: workspace,
      expandFileRefs: false,
      projectMemory: false,
      useRegisteredMcp: false,
      interactiveApprovals: true,
    },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      input: (async function* () {
        yield JSON.stringify({ type: "user", content: "First request" }) + "\n";
        await started;
        if (mode.startsWith("interrupt"))
          yield JSON.stringify({ type: "interrupt" }) + "\n";
        yield JSON.stringify({ type: "user", content: "Next request" }) + "\n";
      })(),
      agentLoop: async function* (messages, options) {
        turns += 1;
        if (turns === 1) {
          messages.push(...round());
          if (mode.startsWith("interrupt")) {
            messages.push(
              round(
                mode === "interrupt-reused-id" ? "read-one" : "incomplete-read",
              )[0],
            );
            await new Promise((resolve, reject) => {
              options.signal.addEventListener(
                "abort",
                () => reject(new Error("Owned interrupt")),
                { once: true },
              );
              announceStarted();
            });
          }
          announceStarted();
          if (mode === "transport")
            throw new Error("Offline transport failure");
          if (mode === "concurrent-input")
            appendUserMessage("continuation", "Concurrent real input");
          yield { type: "run-ended", reason: "user-input-pending" };
          return;
        }
        expect(
          readVerifiedMessages("continuation").map(({ role }) => role),
        ).toEqual(["user", "assistant", "tool", "user"]);
        yield { type: "response-complete", content: "Continued successfully" };
        yield { type: "run-ended", reason: "complete" };
      },
      writeOut: (line) => lines.push(line),
      writeErr: () => {},
    },
  );
  if (mode === "interrupt-reused-id" || mode === "concurrent-input") {
    // The pre-existing sanitizer uses global IDs and can retain this dangling
    // call. The new writer must refuse it, never append the next real input.
    expect((await run).exitCode).toBe(1);
    expect(turns).toBe(1);
    const results = lines
      .join("")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((event) => event.type === "result");
    expect(results.at(-1)).toMatchObject({
      subtype: "error_session_persistence",
      is_error: true,
      code:
        mode === "concurrent-input"
          ? "SESSION_REVISION_STALE"
          : "CC_SESSION_TOOL_ROUND_PERSISTENCE_FAILED",
    });
    expect(readVerifiedMessages("continuation")).toEqual([
      { role: "user", content: "First request" },
      ...(mode === "concurrent-input"
        ? [{ role: "user", content: "Concurrent real input" }]
        : []),
    ]);
    return;
  }
  const result = await run;
  expect(result.exitCode).toBe(mode === "transport" ? 1 : 0);
  const durable = readVerifiedMessages("continuation");
  expect(durable.map(({ role }) => role)).toEqual([
    "user",
    "assistant",
    "tool",
    "user",
    "assistant",
  ]);
  expect(durable.at(-1).content).toBe("Continued successfully");
  expect(
    durable.some((message) => message.content === "Reading incomplete-read"),
  ).toBe(false);
});

it("preserves adjacent resumed user authority through provider normalization and tool compaction", async () => {
  const id = "resume-adjacent-tool-round";
  startSession(id, {});
  appendUserMessage(id, "Previous unanswered request");
  writeFileSync(join(workspace, "resume.txt"), "local resume evidence");
  vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockImplementation(
    (messages) => messages.some((message) => message.role === "tool"),
  );
  let calls = 0;
  const lines = [];
  const chatFn = vi.fn(async (messages) => {
    calls += 1;
    const users = messages.filter((message) => message.role === "user");
    expect(users[0].content).toBe(
      "Previous unanswered request\n\nResume the inspection",
    );
    expect(
      readVerifiedMessages(id)
        .filter((message) => message.role === "user")
        .slice(0, 2)
        .map((message) => message.content),
    ).toEqual(["Previous unanswered request", "Resume the inspection"]);
    return {
      message:
        calls <= 2
          ? {
              role: "assistant",
              content: "Inspecting resumed evidence",
              tool_calls: [
                {
                  id: `resume-read-${calls}`,
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({ path: "resume.txt" }),
                  },
                },
              ],
            }
          : { role: "assistant", content: `Resume completed ${calls}` },
      usage: { input_tokens: 10, output_tokens: 10 },
    };
  });
  const result = await runAgentHeadlessStream(
    {
      sessionId: id,
      cwd: workspace,
      provider: "ollama",
      model: "qwen2.5:7b",
      expandFileRefs: false,
      projectMemory: false,
      useRegisteredMcp: false,
    },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      chatFn,
      input: (async function* () {
        yield [
          { type: "user", content: "Resume the inspection" },
          { type: "user", content: "Confirm completion again" },
        ]
          .map(JSON.stringify)
          .join("\n") + "\n";
      })(),
      writeOut: (line) => lines.push(line),
      writeErr: () => {},
    },
  );
  expect(result.exitCode, lines.join("")).toBe(0);
  expect(chatFn).toHaveBeenCalledTimes(4);
  const durable = readVerifiedMessages(id);
  expect(
    durable
      .filter((message) => message.role === "user")
      .map((message) => message.content),
  ).toEqual([
    "Previous unanswered request",
    "Resume the inspection",
    "Confirm completion again",
  ]);
  expect(durable.filter((message) => message.role === "tool")).toHaveLength(2);
  expect(
    durable.filter((message) => message.content === "Resume completed 3"),
  ).toHaveLength(1);
  expect(
    durable.filter((message) => message.content === "Resume completed 4"),
  ).toHaveLength(1);
  expect(
    readVerifiedEvents(id).filter((event) => event.type === "compact").length,
  ).toBeGreaterThan(0);
});

it("persists explicit feedback notes before the next user turn", async () => {
  let turns = 0;
  const result = await runAgentHeadlessStream(
    {
      sessionId: "feedback-round",
      cwd: workspace,
      expandFileRefs: false,
      projectMemory: false,
      useRegisteredMcp: false,
    },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      input: (async function* () {
        for (const message of [
          { type: "user", content: "First request" },
          { type: "feedback", turn_id: "1", kind: "positive" },
          { type: "feedback", turn_id: "1", kind: "negative" },
          { type: "user", content: "Continue" },
        ])
          yield JSON.stringify(message) + "\n";
      })(),
      agentLoop: async function* (messages) {
        turns += 1;
        if (turns === 1) messages.push(...round());
        else
          expect(
            readVerifiedMessages("feedback-round").filter(
              (message) => message.role === "user",
            ),
          ).toHaveLength(4);
        yield { type: "response-complete", content: `Answer ${turns}` };
        yield { type: "run-ended", reason: "complete" };
      },
      writeOut: () => {},
      writeErr: () => {},
    },
  );
  expect(result.exitCode).toBe(0);
  expect(turns).toBe(2);
  expect(readVerifiedMessages("feedback-round").at(-1).content).toBe(
    "Answer 2",
  );
});
