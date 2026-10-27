import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentHeadless } from "../helpers/test-model-egress.js";

const usage = {
  input_tokens: 10,
  output_tokens: 2,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
const reply = (content, tokens = usage) => ({
  message: { role: "assistant", content },
  ...(tokens ? { usage: tokens } : {}),
});
const write = () => ({
  message: {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "change-review-write",
        type: "function",
        function: {
          name: "write_file",
          arguments: JSON.stringify({
            path: "deliverable.js",
            content: "// changed\n",
          }),
        },
      },
    ],
  },
  usage,
});

describe("headless change-review integration with real file tools", () => {
  let directory;
  beforeEach(() => {
    directory = realpathSync(
      mkdtempSync(join(tmpdir(), "cc-headless-review-")),
    );
    writeFileSync(join(directory, "deliverable.js"), "// placeholder\n");
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function run(steps, options = {}, overrides = {}) {
    const output = [];
    const chatFn = vi.fn(async (_messages, callOptions) => {
      const step = steps[chatFn.mock.calls.length - 1];
      if (!step) throw new Error("Unexpected model request");
      return typeof step === "function" ? step(callOptions) : step;
    });
    const result = await runAgentHeadless(
      {
        prompt: "Update the permitted deliverable.",
        cwd: directory,
        provider: "anthropic",
        model: "claude-opus",
        outputFormat: "stream-json",
        ephemeral: true,
        hermeticExecution: true,
        permissionMode: "acceptEdits",
        allowedTools: ["read_file", "write_file", "edit_file"],
        exactToolNames: true,
        fileMutationScope: {
          exact: true,
          worktreeRoot: directory,
          allowedPaths: ["deliverable.js"],
        },
        reviewChanges: true,
        maxTurns: 8,
        expandFileRefs: false,
        useRegisteredMcp: false,
        ...options,
      },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        resolveAgentMcp: async () => null,
        writeOut: (text) => output.push(text),
        writeErr: () => {},
        chatFn,
        ...overrides,
      },
    );
    expect(readFileSync(join(directory, "deliverable.js"), "utf8")).toBe(
      "// changed\n",
    );
    return {
      result,
      chatFn,
      events: output
        .join("")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    };
  }

  it("does not append review when usage is missing with only a USD cap", async () => {
    const { result, chatFn, events } = await run(
      [write(), reply("Unverified completion", null)],
      { maxCostUsd: 100 },
    );
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(result.result).toBe("Unverified completion");
    expect(events.filter((event) => event.type === "result")).toHaveLength(1);
  });

  it("stops before review when the completed response reaches the cost cap", async () => {
    const { result, chatFn, events } = await run(
      [write(), reply("draft", { ...usage, input_tokens: 1_000_000 })],
      { maxCostUsd: 1 },
    );
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(4);
    expect(events.at(-1).subtype).toBe("error_max_budget");
  });

  it("suppresses provider draft deltas and publishes only the reviewed result", async () => {
    let callbacks = 0;
    const { result, chatFn, events } = await run(
      [
        write(),
        (options) => {
          expect(options.onToken).toBeTypeOf("function");
          options.onToken("PROVISIONAL_DRAFT");
          options.onThinking?.("PROVISIONAL_REASONING");
          callbacks++;
          return reply("PROVISIONAL_DRAFT");
        },
        (options) => {
          options.onToken("Reviewed final response");
          callbacks++;
          return reply("Reviewed final response");
        },
      ],
      { includePartialMessages: true },
    );
    expect(callbacks).toBe(2);
    expect(chatFn).toHaveBeenCalledTimes(3);
    expect(result.result).toBe("Reviewed final response");
    expect(JSON.stringify(events)).not.toContain("PROVISIONAL_");
    expect(events.filter((event) => event.type === "result")).toHaveLength(1);
  });

  it("does not request review after usage persistence fails", async () => {
    let settlements = 0;
    const appendTokenUsage = vi.fn(() => {
      if (++settlements === 2) throw new Error("usage persistence unavailable");
    });
    const { result, chatFn } = await run(
      [write(), reply("draft")],
      {
        ephemeral: false,
        persistSession: true,
        sessionId: "review-usage-persistence",
      },
      {
        sessionExists: () => false,
        startSession: () => {},
        rebuildMessages: () => [],
        appendUserMessage: () => {},
        appendAssistantMessage: () => {},
        appendTokenUsage,
        appendToolCallCompact: () => {},
        appendLlmRetryCompact: () => {},
        appendEvent: () => {},
        appendCompactEvent: () => {},
        appendAuthorityEvent: () => true,
        getLastSessionId: () => null,
        verifySession: () => ({ status: "verified" }),
      },
    );
    expect(appendTokenUsage).toHaveBeenCalledTimes(2);
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(true);
  });
});
