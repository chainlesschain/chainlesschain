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
});
