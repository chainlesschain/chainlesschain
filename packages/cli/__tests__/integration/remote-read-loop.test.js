import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import { webFetch } from "../../src/lib/web-fetch.js";
import broker from "../../src/lib/process-execution-broker/index.js";
import {
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

vi.mock("../../src/lib/web-fetch.js", () => ({ webFetch: vi.fn() }));
vi.mock("../../src/lib/project-detector.js", () => ({
  findProjectRoot: vi.fn(() => null),
  loadProjectConfig: vi.fn(() => null),
  isInsideProject: vi.fn(() => false),
}));

const url = "https://github.com/owner/repo/actions/runs/123/job/456";
const command = "gh run view 123 --job 456 --log --repo owner/repo";
const tool = (name, args, id) => ({
  message: mockToolCallMessage(name, args, `call-${id}`),
});
const done = () => ({ message: mockTextMessage("Finished the local change") });

async function drain(iterator, events = []) {
  for await (const event of iterator) events.push(event);
  return events;
}

describe("remote read recovery in the agent runtime", () => {
  let cwd;
  let base;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-remote-loop-"));
    webFetch.mockReset().mockResolvedValue({
      error: "web_fetch failed: HTTP 403",
      statusCode: 403,
    });
    base = {
      cwd,
      contextMemorySkipPlanning: true,
      autoMicroCompact: false,
      approvalGate: {
        decide: async () => ({
          decision: "allow",
          via: "test-policy",
          policy: "autopilot",
        }),
      },
      _autoCompactor: {
        shouldAutoCompact: (messages) => messages.length > 4,
        compress: async (messages) => ({
          messages: [messages[0]],
          stats: {
            originalMessages: messages.length,
            compressedMessages: 1,
            saved: 1,
          },
        }),
      },
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("stops failed downloads despite planning and repeated history compaction", async () => {
    let calls = 0;
    const events = [];
    await expect(
      drain(
        agentLoop([{ role: "user", content: "Fix the CI failure" }], {
          ...base,
          chatFn: async () => {
            expect(++calls).toBeLessThan(15);
            return calls % 2
              ? tool("web_fetch", { url }, calls)
              : tool(
                  "todo_write",
                  {
                    todos: [
                      { content: "Inspect failures", status: "in_progress" },
                    ],
                  },
                  calls,
                );
          },
        }),
        events,
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_REPEATED_REMOTE_READ" });
    expect(calls).toBe(11);
    expect(webFetch).toHaveBeenCalledTimes(6);
    expect(events.some((event) => event.type === "compaction")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "iteration-warning" &&
          event.message.includes("Repeated web/log"),
      ),
    ).toBe(true);
  });

  it("retains the original failure evidence and resumes a real local change", async () => {
    webFetch.mockResolvedValueOnce({
      content: "FAIL src/fix.js: expected normalized path",
    });
    let calls = 0;
    await drain(
      agentLoop([{ role: "user", content: "Fix the CI failure" }], {
        ...base,
        chatFn: async (messages, options) => {
          calls++;
          if (calls <= 4) return tool("web_fetch", { url }, calls);
          if (calls === 5) {
            expect(options.disabledTools).toContain("web_fetch");
            expect(options.disabledTools).not.toContain("read_file");
            expect(JSON.stringify(messages)).toContain(
              "expected normalized path",
            );
            expect(
              messages.some(
                (message) =>
                  message.role === "system" &&
                  message.content.includes("Remote-read loop recovery"),
              ),
            ).toBe(true);
            expect(
              messages
                .filter((message) => message.role === "system")
                .some((message) =>
                  message.content.includes("expected normalized path"),
                ),
            ).toBe(false);
            return tool(
              "write_file",
              { path: "fix.js", content: "export const fixed = true;" },
              calls,
            );
          }
          expect(calls).toBe(6);
          expect(options.disabledTools || []).not.toContain("web_fetch");
          return done();
        },
      }),
    );
    expect(readFileSync(join(cwd, "fix.js"), "utf8")).toBe(
      "export const fixed = true;",
    );
    expect(webFetch).toHaveBeenCalledTimes(4);
  });

  it("detects actual run_shell stdout results without skipping any command execution", async () => {
    let executions = 0;
    const originalExec = broker.execSync;
    const originalSpawn = broker.spawnSync;
    vi.spyOn(broker, "execSync").mockImplementation(function (value, ...args) {
      if (value.includes("gh run view")) {
        executions++;
        return "FAIL macOS path assertion";
      }
      return originalExec.call(this, value, ...args);
    });
    vi.spyOn(broker, "spawnSync").mockImplementation(
      function (file, args, options) {
        if (args.some((value) => value.includes("gh run view"))) {
          executions++;
          return { status: 0, stdout: "FAIL macOS path assertion", stderr: "" };
        }
        return originalSpawn.call(this, file, args, options);
      },
    );
    let calls = 0;
    const results = [];
    await expect(
      drain(
        agentLoop([{ role: "user", content: "Fix the CI failure" }], {
          ...base,
          chatFn: async () => {
            expect(++calls).toBeLessThan(10);
            return tool(
              "run_shell",
              {
                command:
                  calls % 2
                    ? command
                    : command.replace("--log", "--log-failed"),
              },
              calls,
            );
          },
        }),
        results,
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_REPEATED_REMOTE_READ" });
    expect(calls).toBe(7);
    expect(executions).toBe(7);
    expect(
      results
        .filter((event) => event.type === "tool-result")
        .every((event) => event.result.stdout === "FAIL macOS path assertion"),
    ).toBe(true);
  });

  it("offers recovery after a batch of repeated fetches and restores the tool next turn", async () => {
    let calls = 0;
    await drain(
      agentLoop([{ role: "user", content: "Investigate CI" }], {
        ...base,
        chatFn: async (_messages, options) => {
          calls++;
          if (calls === 1)
            return {
              message: {
                role: "assistant",
                tool_calls: Array.from(
                  { length: 3 },
                  (_, i) =>
                    mockToolCallMessage("web_fetch", { url }, `fetch-${i}`)
                      .tool_calls[0],
                ),
              },
            };
          if (calls === 2) {
            expect(options.disabledTools).toContain("web_fetch");
            return tool(
              "todo_write",
              {
                todos: [
                  {
                    content: "Review retained findings",
                    status: "in_progress",
                  },
                ],
              },
              calls,
            );
          }
          expect(calls).toBe(3);
          expect(options.disabledTools || []).not.toContain("web_fetch");
          return {
            message: mockTextMessage(
              "The log endpoint requires authentication; the task remains blocked.",
            ),
          };
        },
      }),
    );
    expect(webFetch).toHaveBeenCalledTimes(3);
  });

  it.each([true, false])(
    "bounds repeated four-PR batches across compaction and preserves every tool result (parallel=%s)",
    async (parallelReadOnlyTools) => {
      const numbers = [340, 339, 332, 331];
      webFetch.mockImplementation(async (url) => ({
        content: `PR ${url.split("/").at(-1)}: already inspected evidence`,
        snapshotId: url,
        offset: 0,
        hasMore: false,
      }));
      let calls = 0;
      const events = [];
      const messages = [
        {
          role: "user",
          content: "Review PRs; close only already-handled changes",
        },
      ];
      await expect(
        drain(
          agentLoop(messages, {
            ...base,
            parallelReadOnlyTools,
            chatFn: async (context, options) => {
              expect(++calls).toBeLessThan(10);
              if (calls > 1) {
                const retained = context.find((message) =>
                  message.content?.includes("[Remote read results retained"),
                );
                for (const number of numbers)
                  expect(retained.content).toContain(`PR ${number}`);
              }
              if (calls === 5) {
                expect(options.disabledTools).toContain("web_fetch");
                expect(JSON.stringify(context)).toContain(
                  "Compare the specific PR diff/commits",
                );
              }
              return {
                message: {
                  role: "assistant",
                  content: "Let me check each PR again",
                  tool_calls: numbers.map(
                    (number) =>
                      mockToolCallMessage(
                        "web_fetch",
                        {
                          url: `https://github.com/owner/repo/pull/${number}`,
                          maxChars: calls % 2 ? 5000 : 8000,
                        },
                        `pr-${calls}-${number}`,
                      ).tool_calls[0],
                  ),
                },
              };
            },
          }),
          events,
        ),
      ).rejects.toMatchObject({ code: "CC_AGENT_REPEATED_REMOTE_READ" });
      expect(calls).toBe(7);
      expect(webFetch).toHaveBeenCalledTimes(28);
      const results = events.filter((event) => event.type === "tool-result");
      expect(results).toHaveLength(28);
      expect(new Set(results.map((event) => event.tool_use_id)).size).toBe(28);
      expect(
        messages
          .filter((message) => message.role === "tool")
          .map((message) => message.tool_call_id),
      ).toEqual(results.slice(-4).map((event) => event.tool_use_id));
      expect(events.some((event) => event.type === "response-complete")).toBe(
        false,
      );
    },
  );

  it("carries authorized PR triage into a concrete API comparison after a missing local origin", async () => {
    const originalExec = broker.execSync;
    const originalSpawn = broker.spawnSync;
    const comparison = "gh api repos/owner/repo/compare/main...feature";
    vi.spyOn(broker, "execSync").mockImplementation(function (value, ...args) {
      if (value === comparison) return '{"status":"behind","ahead_by":0}';
      return originalExec.call(this, value, ...args);
    });
    vi.spyOn(broker, "spawnSync").mockImplementation(
      function (file, args, options) {
        if (args.includes(comparison))
          return {
            status: 0,
            stdout: '{"status":"behind","ahead_by":0}',
            stderr: "",
          };
        return originalSpawn.call(this, file, args, options);
      },
    );
    webFetch.mockResolvedValue({ content: "PR 340 head=feature base=main" });
    let calls = 0;
    const events = await drain(
      agentLoop(
        [
          {
            role: "user",
            content: "Determine whether PR 340 is already included",
          },
        ],
        {
          ...base,
          chatFn: async (context) => {
            calls++;
            if (calls === 1)
              return tool(
                "web_fetch",
                { url: "https://github.com/owner/repo/pull/340" },
                calls,
              );
            if (calls === 2)
              return tool("git", { command: "fetch origin main", cwd }, calls);
            if (calls === 3) {
              expect(JSON.stringify(context)).toContain(
                "does not select the local git repository",
              );
              expect(
                context.some(
                  (message) =>
                    message.role === "system" &&
                    message.content?.includes("compare/<base>...<head>"),
                ),
              ).toBe(true);
              return tool("run_shell", { command: comparison }, calls);
            }
            expect(calls).toBe(4);
            expect(JSON.stringify(context)).toContain("ahead_by");
            return {
              message: mockTextMessage(
                "PR 340 has no commits ahead of main according to the comparison.",
              ),
            };
          },
        },
      ),
    );
    expect(
      events.find((event) => event.type === "response-complete")?.content,
    ).toContain("no commits ahead");
    expect(webFetch).toHaveBeenCalledTimes(1);
  });

  it("bounds repeated policy rejections even when each attempt uses a different commit", async () => {
    let calls = 0;
    const events = [];
    await expect(
      drain(
        agentLoop([{ role: "user", content: "Inspect PR commits" }], {
          ...base,
          chatFn: async (context, options) => {
            expect(++calls).toBeLessThan(10);
            if (calls === 4) {
              expect(options.disabledTools).toContain("run_shell");
              expect(JSON.stringify(context)).toContain(
                "Tool-policy loop recovery",
              );
            }
            return tool(
              "run_shell",
              { command: `git branch -r --contains commit-${calls} 2>&1` },
              calls,
            );
          },
        }),
        events,
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_REPEATED_REMOTE_READ" });
    expect(calls).toBe(6);
    expect(events.filter((event) => event.type === "tool-result")).toHaveLength(
      6,
    );
    expect(events.some((event) => event.type === "response-complete")).toBe(
      false,
    );
  });
});
