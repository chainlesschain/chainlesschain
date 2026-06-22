/**
 * Stream-mode custom slash-command frontmatter scoping (parity with `cc command
 * run` / headless -p). When a `/name` from .claude/commands matches in the
 * stream-json panel input, its `model:` / `allowed-tools:` frontmatter scopes
 * THIS turn's loopOptions. It is the LOWEST-priority override: an explicit
 * per-turn LLM (privacy-tier) or vision switch still wins on model.
 */
import { describe, it, expect } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

function harness({ inputObjs, runOptions = {}, macro }) {
  const seenOpts = [];
  async function* loop(_messages, opts) {
    seenOpts.push(opts || {});
    yield { type: "response-complete", content: "reply" };
    yield { type: "run-ended", reason: "complete" };
  }
  async function* input() {
    for (const o of inputObjs) yield JSON.stringify(o) + "\n";
  }
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: () => {},
    writeErr: () => {},
    agentLoop: loop,
    input: input(),
    // Inject the macro resolver so no real .claude/commands file is needed.
    resolveSlashMacro: async (text) =>
      typeof text === "string" && text.startsWith("/") ? macro : null,
  };
  return {
    run: () =>
      runAgentHeadlessStream({ expandFileRefs: false, ...runOptions }, deps),
    seenOpts,
  };
}

describe("stream slash-macro frontmatter scoping", () => {
  it("a matched command's model + allowed-tools scope the turn", async () => {
    const h = harness({
      runOptions: { provider: "volcengine", model: "doubao", apiKey: "K" },
      macro: {
        matched: true,
        name: "review",
        scope: "project",
        promptText: "Review the diff.",
        model: "doubao-pro",
        allowedTools: "read_file, search_files",
      },
      inputObjs: [{ type: "user", text: "/review" }],
    });
    await h.run();
    expect(h.seenOpts).toHaveLength(1);
    expect(h.seenOpts[0].model).toBe("doubao-pro");
    expect(h.seenOpts[0].enabledToolNames).toEqual([
      "read_file",
      "search_files",
    ]);
  });

  it("an explicit per-turn LLM override still wins over the macro model", async () => {
    const h = harness({
      runOptions: { provider: "volcengine", model: "doubao", apiKey: "K" },
      macro: {
        matched: true,
        name: "review",
        scope: "project",
        promptText: "Review the diff.",
        model: "macro-model",
        allowedTools: "read_file",
      },
      inputObjs: [
        {
          type: "user",
          text: "/review",
          llm: { provider: "ollama", model: "qwen2.5" },
        },
      ],
    });
    await h.run();
    // Privacy-tier override wins on model; macro still scopes the tools.
    expect(h.seenOpts[0].model).toBe("qwen2.5");
    expect(h.seenOpts[0].provider).toBe("ollama");
    expect(h.seenOpts[0].enabledToolNames).toEqual(["read_file"]);
  });

  it("a macro without model/allowed-tools leaves the session LLM + tools", async () => {
    const h = harness({
      runOptions: { provider: "volcengine", model: "doubao", apiKey: "K" },
      macro: {
        matched: true,
        name: "note",
        scope: "project",
        promptText: "Take a note.",
      },
      inputObjs: [{ type: "user", text: "/note" }],
    });
    await h.run();
    expect(h.seenOpts[0].model).toBe("doubao"); // session model unchanged
  });

  it("a non-slash turn is unaffected by macro scoping", async () => {
    const h = harness({
      runOptions: { provider: "volcengine", model: "doubao", apiKey: "K" },
      macro: {
        matched: true,
        name: "review",
        scope: "project",
        promptText: "x",
        model: "doubao-pro",
      },
      inputObjs: [{ type: "user", text: "just a normal message" }],
    });
    await h.run();
    expect(h.seenOpts[0].model).toBe("doubao"); // no leading slash → no macro
  });
});
