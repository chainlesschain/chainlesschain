/**
 * Integration: headless `--disallowed-tools` deny-list is honored.
 *
 * Regression for a silent no-op — `runAgentHeadless` threaded `disabledTools`
 * all the way into `agentLoop` options, but `chatWithTools` only forwarded the
 * project-persona deny-list (`persona.toolsDisabled`) to
 * `getAgentToolDefinitions` and dropped `options.disabledTools` on the floor,
 * so `--disallowed-tools run_shell` left run_shell fully callable.
 *
 * These tests drive the REAL chatWithTools (ollama branch) with a stubbed fetch
 * and assert the deny-list actually removes tools from the request body.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { chatWithTools } from "../../src/runtime/agent-core.js";

describe("headless deny-list reaches chatWithTools tool definitions", () => {
  let capturedBody;

  beforeEach(() => {
    capturedBody = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, options) => {
        capturedBody = options?.body ? JSON.parse(options.body) : null;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              message: { role: "assistant", content: "ok" },
            }),
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const baseOpts = {
    provider: "ollama",
    model: "qwen2.5:7b",
    baseUrl: "http://localhost:11434",
  };
  const messages = [{ role: "user", content: "hi" }];
  const toolNames = () => capturedBody.tools.map((t) => t.function.name);

  it("excludes a caller-supplied disabled tool from the request body", async () => {
    await chatWithTools(messages, {
      ...baseOpts,
      disabledTools: ["run_shell"],
    });
    expect(toolNames()).not.toContain("run_shell");
    // sanity: a non-disabled tool is still present
    expect(toolNames()).toContain("read_file");
  });

  it("keeps the tool when no deny-list is supplied (proves the test is real)", async () => {
    await chatWithTools(messages, { ...baseOpts });
    expect(toolNames()).toContain("run_shell");
  });

  it("honors deny-list alongside an allow-list (deny wins)", async () => {
    await chatWithTools(messages, {
      ...baseOpts,
      enabledToolNames: ["read_file", "run_shell"],
      disabledTools: ["run_shell"],
    });
    expect(toolNames()).toEqual(["read_file"]);
  });

  it("tolerates a non-array disabledTools without throwing", async () => {
    await chatWithTools(messages, {
      ...baseOpts,
      disabledTools: undefined,
    });
    expect(toolNames()).toContain("run_shell");
  });
});
