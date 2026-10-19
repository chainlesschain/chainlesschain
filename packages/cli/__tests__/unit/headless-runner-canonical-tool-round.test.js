import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentHeadless } from "../helpers/test-model-egress.js";
import { PromptCompressor } from "../../src/harness/prompt-compressor.js";
import {
  startSession,
  appendUserMessage,
  readVerifiedEvents,
  readVerifiedMessages,
} from "../../src/harness/jsonl-session-store.js";

let root;
let workspace;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "runner-tool-round-"));
  workspace = join(root, "workspace");
  mkdirSync(workspace);
  for (const name of ["first", "second", "third"]) {
    writeFileSync(join(workspace, `${name}.txt`), `${name} local evidence`);
  }
  vi.stubEnv("CHAINLESSCHAIN_HOME", join(root, "home"));
  vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", join(root, "anchors"));
  vi.stubEnv("CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE", "canonical_default");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function reply(content) {
  return {
    message: { role: "assistant", content },
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}
function read(name) {
  return {
    ...reply(`Reading ${name}`),
    message: {
      role: "assistant",
      content: `Reading ${name}`,
      tool_calls: [
        {
          id: `read-${name}`,
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify({ path: `${name}.txt` }),
          },
        },
      ],
    },
  };
}
async function run(chatFn, options = {}, extraDeps = {}) {
  const lines = [];
  const outcome = await runAgentHeadless(
    {
      prompt: "Inspect the local evidence.",
      persistSession: true,
      sessionId: "runner-rounds",
      cwd: workspace,
      provider: "ollama",
      model: "qwen2.5:7b",
      outputFormat: "stream-json",
      expandFileRefs: false,
      projectMemory: false,
      useRegisteredMcp: false,
      ...options,
    },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      chatFn,
      writeOut: (line) => lines.push(line),
      writeErr: () => {},
      ...extraDeps,
    },
  );
  return {
    outcome,
    events: lines.join("").trim().split("\n").filter(Boolean).map(JSON.parse),
  };
}

it.each([true, false])(
  "persists actual runner rounds with auto compaction=%s and resumes once",
  async (automatic) => {
    // Only force the scheduling decision. JSONL, lease, canonical compaction,
    // model accounting, the agent loop and read_file execution are production.
    const compact = vi
      .spyOn(PromptCompressor.prototype, "shouldAutoCompact")
      .mockImplementation(
        (messages) =>
          automatic && messages.some((message) => message.role === "tool"),
      );
    let calls = 0;
    const chatFn = vi.fn(async () =>
      ++calls <= 3
        ? read(["first", "second", "third"][calls - 1])
        : reply("All three files checked."),
    );
    const { outcome, events } = await run(chatFn);
    expect(outcome, JSON.stringify(events)).toMatchObject({
      exitCode: 0,
      isError: false,
    });
    expect(chatFn).toHaveBeenCalledTimes(4);
    const durable = readVerifiedMessages("runner-rounds");
    expect(durable.filter((message) => message.role === "tool")).toHaveLength(
      3,
    );
    expect(
      durable.filter(
        (message) => message.content === "All three files checked.",
      ),
    ).toHaveLength(1);
    const compactions = readVerifiedEvents("runner-rounds").filter(
      (event) => event.type === "compact",
    );
    expect(compactions.length).toBe(automatic ? 2 : 0);
    compact.mockReturnValue(false);
    const resumedChat = vi.fn(async (messages) => {
      expect(
        messages.filter((message) => message.role === "tool"),
      ).toHaveLength(3);
      expect(
        messages.filter(
          (message) => message.content === "All three files checked.",
        ),
      ).toHaveLength(1);
      return reply("Resumed evidence verified.");
    });
    const resumed = await run(resumedChat, {
      resume: "runner-rounds",
      prompt: "Continue with the recorded evidence.",
    });
    expect(resumed.outcome, JSON.stringify(resumed.events)).toMatchObject({
      exitCode: 0,
      isError: false,
    });
    expect(resumedChat).toHaveBeenCalledOnce();
    const afterResume = readVerifiedMessages("runner-rounds");
    expect(
      afterResume.filter(
        (message) => message.content === "All three files checked.",
      ),
    ).toHaveLength(1);
    expect(
      afterResume.filter(
        (message) => message.content === "Resumed evidence verified.",
      ),
    ).toHaveLength(1);
  },
);

it("rejects concurrent durable input before saving the final assistant", async () => {
  vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockReturnValue(
    false,
  );
  let calls = 0;
  const { outcome, events } = await run(async () => {
    if (++calls === 1) return read("first");
    appendUserMessage("runner-rounds", "Concurrent input must survive.");
    return reply("This final answer must not be persisted.");
  });
  expect(outcome).toMatchObject({
    exitCode: 1,
    isError: true,
    code: "SESSION_REVISION_STALE",
  });
  expect(events.at(-1)).toMatchObject({
    subtype: "error_session_persistence",
    code: "SESSION_REVISION_STALE",
  });
  expect(
    readVerifiedMessages("runner-rounds").map((message) => message.content),
  ).toEqual(["Inspect the local evidence.", "Concurrent input must survive."]);
});

it.each([true, false])(
  "stops on tool settlement storage failure before auto compaction=%s",
  async (automatic) => {
    vi.spyOn(
      PromptCompressor.prototype,
      "shouldAutoCompact",
    ).mockImplementation(
      (messages) =>
        automatic && messages.some((message) => message.role === "tool"),
    );
    let calls = 0;
    const append = vi.fn(() => {
      throw Object.assign(new Error("disk full"), {
        code: "ENOSPC",
      });
    });
    const { outcome, events } = await run(
      async () =>
        ++calls <= 2
          ? read(calls === 1 ? "first" : "second")
          : reply("Not durable."),
      {},
      {
        appendToolRoundsIfMessagesMatch: append,
      },
    );
    expect(outcome.isError, JSON.stringify(events)).toBe(true);
    expect(outcome.exitCode).toBe(1);
    expect(calls).toBe(automatic ? 2 : 3);
    expect(append).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ subtype: "error_persistence" });
    expect(outcome.persistence).toMatchObject({
      fs_code: "ENOSPC",
      phase: "after-model",
      commit_state: "unknown",
      retryable: false,
    });
    expect(readVerifiedMessages("runner-rounds")).toEqual([
      { role: "user", content: "Inspect the local evidence." },
    ]);
  },
);

it("preserves separate durable users while projecting a resumed bare-user history for the provider", async () => {
  startSession("runner-rounds", {});
  appendUserMessage("runner-rounds", "An earlier unanswered request.");
  vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockImplementation(
    (messages) => messages.some((message) => message.role === "tool"),
  );
  let calls = 0;
  const chatFn = vi.fn(async (messages) => {
    const users = messages.filter((message) => message.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0].content).toBe(
      "An earlier unanswered request.\n\nInspect the local evidence.",
    );
    return ++calls <= 2
      ? read(calls === 1 ? "first" : "second")
      : reply("Recovered answer.");
  });
  const { outcome, events } = await run(chatFn, { resume: "runner-rounds" });
  expect(outcome, JSON.stringify(events)).toMatchObject({
    exitCode: 0,
    isError: false,
  });
  const durable = readVerifiedMessages("runner-rounds");
  expect(
    durable
      .filter((message) => message.role === "user")
      .map((message) => message.content),
  ).toEqual(["An earlier unanswered request.", "Inspect the local evidence."]);
  expect(durable.filter((message) => message.role === "tool")).toHaveLength(2);
  expect(
    durable.filter((message) => message.content === "Recovered answer."),
  ).toHaveLength(1);
});

it("keeps IDE context live without modifying the persisted user prompt", async () => {
  vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockImplementation(
    (messages) => messages.some((message) => message.role === "tool"),
  );
  let calls = 0;
  const chatFn = vi.fn(async (messages) => {
    expect(JSON.stringify(messages)).toContain("Ephemeral IDE selection");
    return ++calls <= 2
      ? read(calls === 1 ? "first" : "second")
      : reply("IDE evidence checked.");
  });
  const { outcome, events } = await run(
    chatFn,
    {},
    { buildIdePromptContext: async () => "Ephemeral IDE selection" },
  );
  expect(outcome, JSON.stringify(events)).toMatchObject({
    exitCode: 0,
    isError: false,
  });
  const durable = readVerifiedMessages("runner-rounds");
  expect(durable.filter((message) => message.role === "user")).toEqual([
    { role: "user", content: "Inspect the local evidence." },
  ]);
  expect(JSON.stringify(readVerifiedEvents("runner-rounds"))).not.toContain(
    "Ephemeral IDE selection",
  );
});

it("keeps multimodal user input aligned with the verified transcript through tool settlement", async () => {
  vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockReturnValue(
    false,
  );
  const image = { mediaType: "image/png", data: "aW1hZ2U=" };
  let calls = 0;
  const { outcome, events } = await run(
    async () =>
      ++calls === 1 ? read("first") : reply("Image and source inspected."),
    { images: [image] },
  );
  expect(outcome, JSON.stringify(events)).toMatchObject({
    exitCode: 0,
    isError: false,
  });
  expect(readVerifiedMessages("runner-rounds")[0]).toEqual({
    role: "user",
    content: [
      { type: "text", text: "Inspect the local evidence." },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,aW1hZ2U=" },
      },
    ],
  });
});

it("keeps goal-condition follow-ups live without turning them into durable user input", async () => {
  vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockImplementation(
    (messages) => messages.some((message) => message.role === "tool"),
  );
  let calls = 0;
  const chatFn = vi.fn(async (messages) => {
    calls += 1;
    if (calls === 1) return read("first");
    if (calls === 2) return reply("More inspection needed.");
    expect(
      messages.some((message) =>
        String(message.content).includes(
          "The completion condition is not yet met",
        ),
      ),
    ).toBe(true);
    if (calls === 3) return read("second");
    return reply("DONE");
  });
  const { outcome, events } = await run(chatFn, {
    goalCondition: "contains:DONE",
  });
  expect(outcome, JSON.stringify(events)).toMatchObject({
    exitCode: 0,
    isError: false,
  });
  expect(chatFn).toHaveBeenCalledTimes(4);
  const durable = readVerifiedMessages("runner-rounds");
  expect(durable.filter((message) => message.role === "user")).toEqual([
    { role: "user", content: "Inspect the local evidence." },
  ]);
  expect(durable.filter((message) => message.role === "tool")).toHaveLength(2);
  expect(durable.filter((message) => message.content === "DONE")).toHaveLength(
    1,
  );
  expect(JSON.stringify(readVerifiedEvents("runner-rounds"))).not.toContain(
    "The completion condition is not yet met",
  );
});

it.each(["missing-head", "async-rejection"])(
  "fails closed when the tool settlement capability returns %s",
  async (mode) => {
    vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockReturnValue(
      false,
    );
    let calls = 0;
    const append = vi.fn(() =>
      mode === "missing-head"
        ? false
        : Promise.reject(new Error("late settlement rejection")),
    );
    const { outcome, events } = await run(
      async () => (++calls === 1 ? read("first") : reply("Not settled.")),
      {},
      {
        appendToolRoundsIfMessagesMatch: append,
      },
    );
    expect(outcome).toMatchObject({ exitCode: 1, isError: true });
    expect(events.at(-1)).toMatchObject({
      subtype: "error_session_persistence",
    });
    expect(append).toHaveBeenCalledOnce();
    expect(readVerifiedMessages("runner-rounds")).toEqual([
      { role: "user", content: "Inspect the local evidence." },
    ]);
  },
);

it.each([false, true])(
  "settles completed evidence at max-turns; settlement failure=%s",
  async (failed) => {
    vi.spyOn(PromptCompressor.prototype, "shouldAutoCompact").mockReturnValue(
      false,
    );
    const chatFn = vi.fn(async () => read("first"));
    const { outcome, events } = await run(
      chatFn,
      { maxTurns: 1 },
      failed
        ? {
            appendToolRoundsIfMessagesMatch: () => {
              throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
            },
          }
        : {},
    );
    expect(chatFn).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ exitCode: failed ? 1 : 3, isError: true });
    expect(events.at(-1)).toMatchObject({
      subtype: failed ? "error_persistence" : "error_max_turns",
    });
    const durable = readVerifiedMessages("runner-rounds");
    expect(durable.filter((message) => message.role === "tool")).toHaveLength(
      failed ? 0 : 1,
    );
    expect(
      durable.filter(
        (message) =>
          message.role === "assistant" && !message.tool_calls?.length,
      ),
    ).toEqual([]);
  },
);
