/**
 * read_file offset/limit line-range paging (Claude-Code Read parity) — lets the
 * agent page a large file past the size cap instead of being stuck at its head.
 * Exercises executeTool against real temp files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ReadFileLoopGuard } from "../../src/lib/read-file-loop-guard.js";

vi.mock("../../src/lib/plan-mode.js", () => {
  const planModeManager = {
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  };
  return { getPlanModeManager: vi.fn(() => planModeManager) };
});
vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn(function () {
    return { getResolvedSkills: vi.fn(() => []) };
  }),
}));
vi.mock("../../src/lib/project-detector.js", () => ({
  findProjectRoot: vi.fn(() => null),
  loadProjectConfig: vi.fn(() => null),
  isInsideProject: vi.fn(() => false),
}));
vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

const {
  executeTool,
  capToolResultString,
  toolResultForModel,
  agentLoop,
  _toAnthropicMessages,
} = await import("../../src/runtime/agent-core.js");

describe("read_file offset/limit line ranges", () => {
  let dir;
  const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-readrange-"));
    writeFileSync(join(dir, "f.txt"), lines.join("\n"), "utf8");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = (args) =>
    executeTool("read_file", { path: "f.txt", ...args }, { cwd: dir });

  it("reads a large document to EOF using progress retained through repeated compaction", async () => {
    const documentLines = Array.from(
      { length: 4000 },
      (_, i) => `section ${i + 1}: ${"document content ".repeat(12)}`,
    );
    writeFileSync(join(dir, "f.txt"), documentLines.join("\n"), "utf8");
    const compactor = {
      shouldAutoCompact: (messages) => messages.length > 4,
      compress: async (messages) => ({
        messages: [messages[0]],
        stats: {
          originalMessages: messages.length,
          compressedMessages: 1,
          saved: 1,
        },
      }),
    };
    let modelCalls = 0;
    let nextLine = 1;
    let compactions = 0;
    for await (const event of agentLoop(
      [{ role: "user", content: "Read the document and finish the task" }],
      {
        cwd: dir,
        contextMemorySkipPlanning: true,
        autoMicroCompact: false,
        _autoCompactor: compactor,
        chatFn: async (messages) => {
          modelCalls++;
          expect(modelCalls).toBeLessThan(30);
          const progress = messages.find((message) =>
            message.content?.startsWith("[Current run file read progress"),
          );
          const cursor = progress
            ? JSON.parse(progress.content.split("\n")[1])[0]
            : null;
          return {
            message: cursor?.reachedEnd
              ? { role: "assistant", content: "completed" }
              : {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: `page-${modelCalls}`,
                      type: "function",
                      function: {
                        name: "read_file",
                        arguments: JSON.stringify(
                          cursor?.nextRead || { path: "f.txt" },
                        ),
                      },
                    },
                  ],
                },
          };
        },
      },
    )) {
      if (event.type === "compaction") compactions++;
      if (event.type !== "tool-result") continue;
      const page = event.result;
      expect(page.error).toBeUndefined();
      expect(page.range.startLine).toBe(nextLine);
      expect(page.content.replace(/\n$/, "").split("\n")).toEqual(
        documentLines.slice(nextLine - 1, page.range.endLine),
      );
      nextLine = page.range.endLine + 1;
    }
    expect(nextLine).toBe(documentLines.length + 1);
    expect(compactions).toBeGreaterThan(2);
  });

  it("auto-continues a model that repeatedly omits nextRead, even with search batches", async () => {
    const documentLines = Array.from(
      { length: 4000 },
      (_, i) => `section ${i + 1}: ${"document content ".repeat(12)}`,
    );
    writeFileSync(join(dir, "f.txt"), documentLines.join("\n"), "utf8");
    let calls = 0;
    const pages = [];
    for await (const event of agentLoop(
      [{ role: "user", content: "Read the document and finish the task" }],
      {
        cwd: dir,
        autoCompact: false,
        contextMemorySkipPlanning: true,
        chatFn: async (messages) => {
          calls++;
          expect(calls).toBeLessThan(30);
          const progress = messages.find((message) =>
            message.content?.startsWith("[Current run file read progress"),
          );
          const cursor = progress
            ? JSON.parse(progress.content.split("\n")[1])[0]
            : null;
          if (cursor?.reachedEnd)
            return { message: { role: "assistant", content: "completed" } };
          return {
            message: {
              role: "assistant",
              tool_calls: [
                ...(calls % 2 === 0
                  ? [
                      {
                        id: `search-${calls}`,
                        type: "function",
                        function: {
                          name: "search_files",
                          arguments: JSON.stringify({ query: "TODO" }),
                        },
                      },
                    ]
                  : []),
                {
                  id: `read-${calls}`,
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({ path: "f.txt" }),
                  },
                },
              ],
            },
          };
        },
      },
    )) {
      if (event.type === "tool-result" && event.tool === "read_file")
        pages.push(event.result);
    }
    expect(pages.at(-1).nextRead).toBeUndefined();
    expect(pages.map((value) => value.range?.startLine || 1)).toEqual(
      [...pages.map((_, index) => index)].map((index) =>
        index === 0 ? 1 : pages[index - 1].range.endLine + 1,
      ),
    );
    expect(calls).toBe(pages.length + 1);
  });

  it("recovers the reported real document through compaction and completes a follow-up file task", async () => {
    const source = fs.readFileSync(
      fileURLToPath(
        new URL(
          "../../../../docs/AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    writeFileSync(join(dir, "report.md"), source);
    let calls = 0;
    let compactions = 0;
    let covered = 0;
    let wrote = false;
    let completed = false;
    const compactor = {
      shouldAutoCompact: (messages) => messages.length > 4,
      compress: async (messages) => ({
        messages: [messages[0]],
        stats: {
          originalMessages: messages.length,
          compressedMessages: 1,
          saved: 1,
        },
      }),
    };
    for await (const event of agentLoop(
      [
        {
          role: "user",
          content: "Read report.md, then write a heading index to result.txt",
        },
      ],
      {
        cwd: dir,
        contextMemorySkipPlanning: true,
        autoMicroCompact: false,
        _autoCompactor: compactor,
        chatFn: async (messages) => {
          expect(++calls).toBeLessThan(40);
          expect(
            _toAnthropicMessages(
              messages.filter((message) => message.role !== "system"),
            ).at(-1)?.role,
          ).toBe("user");
          if (wrote)
            return { message: { role: "assistant", content: "Index written" } };
          const progress = messages.find((message) =>
            message.content?.startsWith("[Current run file read progress"),
          );
          const cursor = progress
            ? JSON.parse(progress.content.split("\n")[1])[0]
            : null;
          if (cursor?.reachedEnd) {
            const findings = messages.find((message) =>
              message.content?.startsWith("[File excerpts retained"),
            );
            expect(findings.role).toBe("assistant");
            const outline = JSON.parse(findings.content.split("\n")[1])[0]
              .outline;
            expect(outline.headings.length).toBeGreaterThan(0);
            return {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "write-index",
                    type: "function",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({
                        path: "result.txt",
                        content: outline.headings
                          .map(({ line, text }) => `${line}: ${text}`)
                          .join("\n"),
                      }),
                    },
                  },
                ],
              },
            };
          }
          // Deliberately ignore every nextRead, as in the user screenshots.
          return {
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: `read-${calls}`,
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({
                      path: "report.md",
                      offset: 1,
                      limit: 5000,
                    }),
                  },
                },
              ],
            },
          };
        },
      },
    )) {
      if (event.type === "compaction") compactions++;
      if (event.type === "tool-result" && event.tool === "read_file") {
        expect(event.result.readSpan.start).toBe(covered);
        expect(event.result.readSpan.end).toBeGreaterThan(covered);
        covered = event.result.readSpan.end;
        expect(JSON.stringify(event.result).length).toBeLessThan(50000);
      }
      if (event.type === "tool-result" && event.tool === "write_file") {
        expect(event.result.error).toBeUndefined();
        wrote = true;
      }
      if (event.type === "response-complete") completed = true;
    }
    expect(covered).toBe(source.length);
    expect(compactions).toBeGreaterThan(2);
    expect(fs.readFileSync(join(dir, "result.txt"), "utf8")).toContain("#");
    expect(completed).toBe(true);
  });

  it("does not consult read recovery when capability authorization denies the read", async () => {
    const guard = new ReadFileLoopGuard();
    const spy = vi.spyOn(guard, "read");
    const result = await executeTool(
      "read_file",
      { path: "f.txt" },
      {
        cwd: dir,
        readFileLoopGuard: guard,
        effectiveAllowedToolNames: [],
      },
    );
    expect(result.error).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    expect(guard.progress.size).toBe(0);
  });

  it("offers an action turn after repeated EOF reads and restores targeted reading afterwards", async () => {
    let calls = 0;
    const events = [];
    const tool = (name, args) => ({
      role: "assistant",
      tool_calls: [
        {
          id: `call-${calls}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    });
    for await (const event of agentLoop(
      [{ role: "user", content: "Extract line 8 to result.txt" }],
      {
        cwd: dir,
        autoCompact: false,
        contextMemorySkipPlanning: true,
        chatFn: async (_messages, options) => {
          calls++;
          if (calls <= 3)
            return { message: tool("read_file", { path: "f.txt" }) };
          if (calls === 4) {
            expect(options.disabledTools).toContain("read_file");
            return {
              message: tool("search_files", { pattern: "line8", path: "." }),
            };
          }
          expect(options.disabledTools || []).not.toContain("read_file");
          if (calls === 5)
            return {
              message: tool("read_file", {
                path: "f.txt",
                offset: 8,
                limit: 1,
              }),
            };
          if (calls === 6)
            return {
              message: tool("write_file", {
                path: "result.txt",
                content: "line8",
              }),
            };
          return { message: { role: "assistant", content: "extracted" } };
        },
      },
    ))
      events.push(event);
    expect(calls).toBe(7);
    expect(
      events.find((event) => event.type === "response-complete")?.content,
    ).toBe("extracted");
    expect(fs.readFileSync(join(dir, "result.txt"), "utf8")).toBe("line8");
  });

  it.each([false, true])(
    "bounds a model that ignores EOF recovery without claiming completion (parallel=%s)",
    async (parallel) => {
      const messages = [{ role: "user", content: "finish the task" }];
      const events = [];
      let recoverySeen = false;
      let calls = 0;
      const chatFn = async (context) => {
        calls++;
        recoverySeen ||= context.some((m) =>
          m.content?.includes("Repeated unchanged file reads detected"),
        );
        return {
          message: {
            role: "assistant",
            content: "Let me read the file again",
            tool_calls: Array.from({ length: parallel ? 2 : 1 }, (_, i) => ({
              id: `read-${calls}-${i}`,
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({
                  path: "f.txt",
                }),
              },
            })),
          },
        };
      };
      let failure;
      try {
        for await (const event of agentLoop(messages, {
          cwd: dir,
          chatFn,
          autoCompact: false,
          contextMemorySkipPlanning: true,
          prepareCall: async () => ({ systemSuffix: "Keep working" }),
        }))
          events.push(event);
      } catch (error) {
        failure = error;
      }
      expect(failure?.code).toBe("CC_AGENT_REPEATED_FILE_READ");
      expect(calls).toBe(7);
      expect(recoverySeen).toBe(true);
      const results = events.filter((e) => e.type === "tool-result");
      expect(results).toHaveLength(parallel ? 14 : 7);
      expect(results.filter((e) => e.result.content)).toHaveLength(1);
      expect(results.every((e) => !e.result.error)).toBe(true);
      const toolMessages = messages.filter((m) => m.role === "tool");
      expect(toolMessages.map((m) => m.tool_call_id)).toEqual(
        results.map((e) => e.tool_use_id),
      );
      expect(events.some((e) => e.type === "response-complete")).toBe(false);
    },
  );

  it("continues when the model follows the next page after recovery guidance", async () => {
    let calls = 0;
    const events = [];
    for await (const event of agentLoop(
      [{ role: "user", content: "read both sections" }],
      {
        cwd: dir,
        autoCompact: false,
        contextMemorySkipPlanning: true,
        chatFn: async () => {
          calls++;
          return {
            message:
              calls === 5
                ? { role: "assistant", content: "completed" }
                : {
                    role: "assistant",
                    tool_calls: [
                      {
                        id: `read-${calls}`,
                        type: "function",
                        function: {
                          name: "read_file",
                          arguments: JSON.stringify({
                            path: "f.txt",
                            offset: calls === 4 ? 6 : 1,
                            limit: 5,
                          }),
                        },
                      },
                    ],
                  },
          };
        },
      },
    ))
      events.push(event);
    expect(events.find((e) => e.type === "response-complete")?.content).toBe(
      "completed",
    );
    expect(
      events.filter((e) => e.type === "tool-result").at(-1).result.range
        .startLine,
    ).toBe(6);
  });

  it("reads the whole file with no range (unchanged behavior)", async () => {
    const r = await read({});
    expect(r.content).toBe(lines.join("\n"));
    expect(r.range).toBeUndefined();
  });

  it("offset+limit returns just that line window with a range descriptor", async () => {
    const r = await read({ offset: 5, limit: 3 });
    expect(r.content).toBe("line5\nline6\nline7");
    expect(r.range).toEqual({ startLine: 5, endLine: 7, totalLines: 20 });
  });

  it("offset alone reads to end", async () => {
    const r = await read({ offset: 18 });
    expect(r.content).toBe("line18\nline19\nline20");
    expect(r.range).toEqual({ startLine: 18, endLine: 20, totalLines: 20 });
  });

  it("limit alone reads from the top", async () => {
    const r = await read({ limit: 2 });
    expect(r.content).toBe("line1\nline2");
    expect(r.range).toEqual({ startLine: 1, endLine: 2, totalLines: 20 });
  });

  it("coerces numeric-string args ('5'/'3') the model may emit", async () => {
    const r = await read({ offset: "5", limit: "3" });
    expect(r.content).toBe("line5\nline6\nline7");
  });

  it("a limit past EOF clamps endLine to the file length", async () => {
    const r = await read({ offset: 19, limit: 100 });
    expect(r.content).toBe("line19\nline20");
    expect(r.range).toEqual({ startLine: 19, endLine: 20, totalLines: 20 });
  });

  it("an offset past EOF returns empty content, not an error", async () => {
    const r = await read({ offset: 99 });
    expect(r.content).toBe("");
    expect(r.error).toBeUndefined();
  });

  it("ignores zero / negative / non-numeric range args (full read)", async () => {
    expect((await read({ offset: 0 })).content).toBe(lines.join("\n"));
    expect((await read({ limit: -3 })).content).toBe(lines.join("\n"));
    expect((await read({ offset: "abc" })).content).toBe(lines.join("\n"));
  });

  it("works with hashed:true (each ranged line keeps its hash tag)", async () => {
    const r = await read({ offset: 2, limit: 2, hashed: true });
    const out = r.content.split("\n");
    expect(out).toHaveLength(2);
    // annotateLines prefixes a tag; the underlying content is still line2/line3
    expect(r.content).toMatch(/line2/);
    expect(r.content).toMatch(/line3/);
    expect(r.range).toEqual({ startLine: 2, endLine: 3, totalLines: 20 });
  });

  it("reports the actual page boundary and preserves its cursor after JSON serialization", async () => {
    const largeLines = Array.from(
      { length: 1500 },
      (_, i) => `${i + 1}: "quoted" \\ ${"内容".repeat(45)}`,
    );
    writeFileSync(join(dir, "f.txt"), largeLines.join("\n"), "utf8");
    const first = await read({ offset: 1, limit: 1500 });
    const visible = JSON.parse(capToolResultString(JSON.stringify(first)));
    expect(visible.truncated).toBe(true);
    expect(visible.range.endLine).toBeLessThan(1500);
    expect(visible.nextRead.offset).toBe(visible.range.endLine + 1);
    expect(visible.content.trimEnd().split("\n")).toEqual(
      largeLines.slice(0, visible.range.endLine),
    );
    const next = await read(visible.nextRead);
    expect(next.content.startsWith(largeLines[visible.range.endLine])).toBe(
      true,
    );
  });

  it("does not reinject an unchanged page, but rereads after edits or compaction", async () => {
    const first = await read({ offset: 1, limit: 5 });
    const original = toolResultForModel("read_file", first, []);
    const messages = [
      { role: "tool", tool_call_id: "read-1", content: original },
    ];
    const duplicate = await read({ offset: 1, limit: 5 });
    expect(
      JSON.parse(toolResultForModel("read_file", duplicate, messages)),
    ).toMatchObject({
      alreadyRead: true,
      previousToolCallId: "read-1",
      nextRead: { offset: 6 },
    });
    writeFileSync(join(dir, "f.txt"), "changed content", "utf8");
    const changed = await read({ offset: 1, limit: 5 });
    expect(
      JSON.parse(toolResultForModel("read_file", changed, messages)).content,
    ).toBe("changed content");
    messages[0].content = "[earlier file content compacted]";
    expect(
      JSON.parse(toolResultForModel("read_file", first, messages)).content,
    ).toBe(first.content);
  });

  it("caches repeated reads within a run and invalidates the cache when the file changes", async () => {
    const filePath = join(dir, "f.txt");
    const readSpy = vi.spyOn(fs, "readFileSync");
    const context = { cwd: dir, readFileCache: new Map() };
    try {
      const first = await executeTool(
        "read_file",
        { path: "f.txt", limit: 2 },
        context,
      );
      const second = await executeTool(
        "read_file",
        { path: "f.txt", limit: 2 },
        context,
      );
      expect(second.content).toBe(first.content);
      expect(readSpy.mock.calls.filter(([p]) => p === filePath)).toHaveLength(
        1,
      );
      writeFileSync(filePath, "modified file contents", "utf8");
      const changed = await executeTool(
        "read_file",
        { path: "f.txt", limit: 2 },
        context,
      );
      expect(changed.content).toBe("modified file contents");
      expect(readSpy.mock.calls.filter(([p]) => p === filePath)).toHaveLength(
        2,
      );
    } finally {
      readSpy.mockRestore();
    }
  });
});
