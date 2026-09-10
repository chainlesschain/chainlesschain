import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("keeps recovery through web/file/status switching and command failures until a real change", async () => {
    for (let i = 0; i < 8; i++)
      writeFileSync(join(cwd, `part-${i}.js`), `export const part = ${i};`);
    webFetch.mockResolvedValue({ content: "Sign in to view detailed logs" });
    let inspections = 0;
    const inspect = (command) => {
      if (command.includes("--log")) {
        const error = new Error("Logs unavailable for cancelled job");
        error.status = 1;
        error.stderr = "Logs unavailable for cancelled job";
        throw error;
      }
      return `Run ${++inspections}: matrix jobs cancelled`;
    };
    const originalExec = broker.execSync;
    const originalSpawn = broker.spawnSync;
    vi.spyOn(broker, "execSync").mockImplementation(function (value, ...args) {
      if (value.includes("gh run view")) return inspect(value);
      return originalExec.call(this, value, ...args);
    });
    vi.spyOn(broker, "spawnSync").mockImplementation(
      function (file, args, options) {
        const command = args.find((value) => value.includes("gh run view"));
        if (!command) return originalSpawn.call(this, file, args, options);
        try {
          return { status: 0, stdout: inspect(command), stderr: "" };
        } catch (error) {
          return { status: 1, stdout: "", stderr: error.stderr };
        }
      },
    );
    let calls = 0;
    const events = await drain(
      agentLoop(
        [{ role: "user", content: "Fix the CI failure in result.js" }],
        {
          ...base,
          chatFn: async (messages, options) => {
            expect(++calls).toBeLessThanOrEqual(30);
            if (calls <= 24) {
              const index = Math.floor((calls - 1) / 3);
              if (calls % 3 === 1)
                return tool("read_file", { path: `part-${index}.js` }, calls);
              if (calls % 3 === 2)
                return tool("web_fetch", { url: `${url}${index}` }, calls);
              return tool(
                "run_shell",
                {
                  command: "gh run view 123 --repo owner/repo",
                },
                calls,
              );
            }
            if (calls <= 28) {
              expect(JSON.stringify(messages)).toContain(
                "matrix jobs cancelled",
              );
              if (calls >= 27)
                expect(JSON.stringify(messages)).toContain(
                  "Logs unavailable for cancelled job",
                );
              expect(options.disabledTools).toEqual(
                expect.arrayContaining([
                  "read_file",
                  "list_dir",
                  "web_fetch",
                  "web_search",
                  "todo_write",
                  "spawn_sub_agent",
                  "tool_search",
                ]),
              );
              for (const name of [
                "search_files",
                "write_file",
                "edit_file",
                "run_shell",
              ])
                expect(options.disabledTools).not.toContain(name);
              expect(
                messages.some(
                  (message) =>
                    message.role === "system" &&
                    message.content.includes("Recovery remains active"),
                ),
              ).toBe(true);
              if (calls === 25)
                return tool(
                  "search_files",
                  { path: ".", pattern: "part" },
                  calls,
                );
              if (calls === 26) return tool("run_shell", { command }, calls);
              if (calls === 27)
                return tool(
                  "run_shell",
                  {
                    command: "gh run view 123 --repo owner/repo --json jobs",
                  },
                  calls,
                );
              return tool(
                "write_file",
                {
                  path: "result.js",
                  content: "export const fixed = true;",
                },
                calls,
              );
            }
            expect(options.disabledTools || []).not.toContain("read_file");
            expect(options.disabledTools || []).not.toContain("web_fetch");
            if (calls === 29)
              return tool("read_file", { path: "result.js" }, calls);
            return done();
          },
        },
      ),
    );
    expect(inspections).toBe(9);
    expect(events.some((event) => event.type === "compaction")).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.type === "iteration-warning" &&
          event.message.startsWith("Task progress:"),
      ),
    ).toHaveLength(2);
    expect(
      events.find(
        (event) =>
          event.type === "tool-result" &&
          event.tool === "run_shell" &&
          event.result.error,
      ),
    ).toBeTruthy();
    expect(
      events
        .filter(
          (event) => event.type === "tool-result" && event.tool === "read_file",
        )
        .at(-1).result.content,
    ).toContain("fixed = true");
    expect(readFileSync(join(cwd, "result.js"), "utf8")).toBe(
      "export const fixed = true;",
    );
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

  it("keeps an explicit PR-close request through compaction and executes closure instead of re-reviewing", async () => {
    const originalExec = broker.execSync;
    const originalSpawn = broker.spawnSync;
    const close = "gh pr close 331 --repo owner/repo";
    const state =
      "gh pr view 331 --repo owner/repo --json number,state,closedAt";
    const executed = [];
    const resultFor = (value) => {
      executed.push(value);
      if (value === close) return "✓ Closed pull request owner/repo#331";
      if (value === state)
        return '{"number":331,"state":"CLOSED","closedAt":"2026-09-10T00:00:00Z"}';
      return null;
    };
    vi.spyOn(broker, "execSync").mockImplementation(function (value, ...args) {
      const result = resultFor(value);
      return result ?? originalExec.call(this, value, ...args);
    });
    vi.spyOn(broker, "spawnSync").mockImplementation(
      function (file, args, options) {
        const value = args.find((arg) => arg === close || arg === state);
        const result = value && resultFor(value);
        return result == null
          ? originalSpawn.call(this, file, args, options)
          : { status: 0, stdout: result, stderr: "" };
      },
    );
    let calls = 0;
    const events = await drain(
      agentLoop(
        [
          {
            role: "user",
            content: "请关闭这些 PR，候选列表是 #331；不要再评审是否应该关闭。",
          },
        ],
        {
          ...base,
          chatFn: async (context) => {
            calls++;
            expect(
              context.some(
                (message) =>
                  message.role === "system" &&
                  message.content?.includes("User-authorized PR closure"),
              ),
            ).toBe(true);
            if (calls === 1)
              return tool("run_shell", { command: close }, calls);
            if (calls === 2) {
              // The test compactor removes old tool context; the directive is
              // injected again from the original user authorization.
              expect(JSON.stringify(context)).toContain(
                "do not keep gathering diffs",
              );
              return tool("run_shell", { command: state }, calls);
            }
            expect(calls).toBe(3);
            expect(JSON.stringify(context)).toContain("CLOSED");
            return { message: mockTextMessage("PR #331 is closed.") };
          },
        },
      ),
    );
    expect(executed).toEqual([close, state]);
    expect(
      events.find((event) => event.type === "response-complete")?.content,
    ).toContain("closed");
  });

  it("blocks PR comparison loops until an explicitly requested close is attempted", async () => {
    const originalExec = broker.execSync;
    const originalSpawn = broker.spawnSync;
    const compare = "gh api repos/owner/repo/compare/main...feature";
    const close = "gh pr close 331 --repo owner/repo";
    const state =
      "gh pr view 331 --repo owner/repo --json number,state,closedAt";
    const executed = [];
    const resultFor = (value) => {
      executed.push(value);
      if (value === compare) return '{"ahead_by":1}';
      if (value === close) return "✓ Closed pull request owner/repo#331";
      if (value === state) return '{"number":331,"state":"CLOSED"}';
      return null;
    };
    vi.spyOn(broker, "execSync").mockImplementation(function (value, ...args) {
      const result = resultFor(value);
      return result ?? originalExec.call(this, value, ...args);
    });
    vi.spyOn(broker, "spawnSync").mockImplementation(
      function (file, args, options) {
        const value = args.find((arg) => [compare, close, state].includes(arg));
        const result = value && resultFor(value);
        return result == null
          ? originalSpawn.call(this, file, args, options)
          : { status: 0, stdout: result, stderr: "" };
      },
    );
    let calls = 0;
    const events = await drain(
      agentLoop([{ role: "user", content: "关闭 PR #331，不要再评审。" }], {
        ...base,
        chatFn: async (context) => {
          calls++;
          if (calls <= 3) return tool("run_shell", { command: compare }, calls);
          if (calls === 4) {
            expect(JSON.stringify(context)).toContain(
              "CC_PR_CLOSE_ACTION_REQUIRED",
            );
            return tool("run_shell", { command: close }, calls);
          }
          if (calls === 5) return tool("run_shell", { command: state }, calls);
          return { message: mockTextMessage("PR #331 is closed.") };
        },
      }),
    );
    expect(executed.filter((command) => command === compare)).toHaveLength(2);
    expect(executed).toContain(close);
    expect(executed).toContain(state);
    expect(
      events.find((event) => event.type === "response-complete")?.content,
    ).toContain("closed");
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
