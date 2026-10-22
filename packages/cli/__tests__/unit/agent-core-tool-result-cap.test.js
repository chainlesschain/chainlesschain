/**
 * Per-tool-result truncation (capToolResultString) — the safety net that keeps
 * one giant tool output from blowing the context, now with a VISIBLE marker
 * (the old code silently sliced to 5000 chars mid-content, undercutting even
 * read_file's own 50k self-limit and never telling the model it was cut).
 */
import { describe, it, expect } from "vitest";
import {
  capToolResultString,
  MAX_TOOL_RESULT_CHARS,
  MAX_TOOL_RESULT_CHARS_HARD_LIMIT,
  resolveMaxToolResultChars,
  safeStringifyToolResult,
  boundedCodeOutput,
  toolResultForModel,
} from "../../src/runtime/agent-core.js";
import { createEvidenceJsonTextBoundary } from "../../src/lib/evolution/evidence-json-text.js";
import { buildReadFilePage } from "../../src/lib/read-file-page.js";
import { shellOutputPreview } from "../../src/lib/shell-output.js";
import { ReadFileLoopGuard } from "../../src/lib/read-file-loop-guard.js";

function projectText(text) {
  const scan = createEvidenceJsonTextBoundary((message) => new Error(message));
  const visit = (value, layer) => {
    if (typeof value === "string") return project(value, layer);
    if (Array.isArray(value)) return value.map((child) => visit(child, layer));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, visit(child, layer)]),
      );
    return value;
  };
  const project = (value, layer = 0) =>
    scan(value, {
      layer,
      codeText: true,
      visit,
      plain: (plain) => plain,
      equal: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    });
  return project(text);
}

describe("large command output", () => {
  it("preserves short output and labels long JSON-escaped Unicode output", () => {
    expect(boundedCodeOutput("hello")).toEqual({ output: "hello" });
    const source = '中文😀\\"\n'.repeat(20000);
    const result = boundedCodeOutput(source);
    const visible = JSON.parse(
      capToolResultString(
        JSON.stringify({
          success: true,
          ...result,
          duration: "12ms",
          language: "python",
        }),
      ),
    );
    expect(visible.truncated).toBe(true);
    expect(visible.outputChars).toBe(source.length);
    expect(visible.returnedChars).toBe(visible.output.length);
    expect(visible.output).toContain("omitted");
    expect(() => projectText(JSON.stringify(visible))).not.toThrow();
    expect(visible.output).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(visible.hint).toContain("filter/count locally");
  });

  it("reuses visible output without replaying it, but restores it after compaction", () => {
    const result = {
      success: true,
      ...boundedCodeOutput("rows\n".repeat(20000)),
    };
    const messages = [
      {
        role: "assistant",
        tool_calls: [{ id: "c1", function: { name: "run_code" } }],
      },
      { role: "tool", tool_call_id: "c1", content: JSON.stringify(result) },
    ];
    const repeat = JSON.parse(
      toolResultForModel("run_code", { ...result, duration: "9ms" }, messages),
    );
    expect(repeat.output).toBeUndefined();
    expect(repeat.previousToolCallId).toBe("c1");
    expect(repeat.truncated).toBe(true);
    expect(repeat.duration).toBe("9ms");
    expect(
      JSON.parse(toolResultForModel("run_shell", result, messages)).output,
    ).toBe(result.output);
    const changed = { ...result, output: result.output + "new" };
    expect(
      JSON.parse(toolResultForModel("run_code", changed, messages)).output,
    ).toBe(changed.output);
    messages[1].content = "[compacted]";
    expect(
      JSON.parse(toolResultForModel("run_code", result, messages)).output,
    ).toBe(result.output);
  });
});

describe("capToolResultString", () => {
  it("returns short results unchanged (no marker)", () => {
    const s = JSON.stringify({ content: "hello world" });
    expect(capToolResultString(s)).toBe(s);
    expect(capToolResultString(s)).not.toMatch(/truncated/);
  });

  it("passes a result exactly at the cap through untouched", () => {
    const s = "x".repeat(MAX_TOOL_RESULT_CHARS);
    expect(capToolResultString(s)).toBe(s);
  });

  it("keeps a plain prefix and marker within the total budget", () => {
    const big = "y".repeat(MAX_TOOL_RESULT_CHARS + 5000);
    const out = capToolResultString(big);
    expect(out.startsWith("y".repeat(1000))).toBe(true);
    expect(out).toMatch(/Tool output truncated/);
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(out).toContain(String(MAX_TOOL_RESULT_CHARS + 5000)); // original length
    expect(() => projectText(out)).not.toThrow();
  });

  it("honors an explicit max argument", () => {
    expect(capToolResultString("abcdefgh", 4)).toBe("null");
    expect(capToolResultString("abc", 4)).toBe("abc");
  });

  it("only permits environment or call-site values to tighten the host cap", () => {
    expect(resolveMaxToolResultChars(4096)).toBe(4096);
    for (const value of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(resolveMaxToolResultChars(value)).toBe(
        MAX_TOOL_RESULT_CHARS_HARD_LIMIT,
      );
    }
    const oversized = "z".repeat(MAX_TOOL_RESULT_CHARS_HARD_LIMIT + 10);
    expect(capToolResultString(oversized, Number.MAX_SAFE_INTEGER)).toMatch(
      /Tool output truncated/,
    );
    expect(
      capToolResultString(oversized, Number.MAX_SAFE_INTEGER).length,
    ).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS_HARD_LIMIT);
  });

  it("default cap is generous enough not to undercut read_file's 50k self-limit", () => {
    // read_file caps its own content at 50000 + marker; the generic net must be
    // at least that so it stops silently re-truncating to a tiny window.
    expect(MAX_TOOL_RESULT_CHARS).toBeGreaterThanOrEqual(50000);
  });

  it("coerces a non-string input without throwing", () => {
    expect(capToolResultString(undefined)).toBe("");
    expect(capToolResultString(null)).toBe("");
    expect(capToolResultString(12345)).toBe("12345");
  });
});

describe("safeStringifyToolResult", () => {
  it("matches JSON.stringify on the happy path", () => {
    const v = { content: "ok", n: 1, arr: [1, 2], nested: { a: true } };
    expect(safeStringifyToolResult(v)).toBe(JSON.stringify(v));
    expect(safeStringifyToolResult("plain")).toBe('"plain"');
    expect(safeStringifyToolResult(undefined)).toBe(undefined); // as JSON.stringify
  });

  it("does not throw on a circular reference (recovers with [Circular])", () => {
    const a = { name: "node" };
    a.self = a; // circular — plain JSON.stringify throws here
    let out;
    expect(() => {
      out = safeStringifyToolResult(a);
    }).not.toThrow();
    expect(out).toContain("node");
    expect(out).toContain("[Circular]");
  });

  it("does not throw on a BigInt (serializes it as a string)", () => {
    let out;
    expect(() => {
      out = safeStringifyToolResult({ big: 10n, ok: 1 });
    }).not.toThrow();
    expect(out).toContain("10");
  });

  it("does not throw when a value's toJSON throws (last-resort string)", () => {
    const bad = {
      toJSON() {
        throw new Error("boom");
      },
    };
    let out;
    expect(() => {
      out = safeStringifyToolResult(bad);
    }).not.toThrow();
    expect(typeof out).toBe("string");
  });

  it("feeds cleanly into capToolResultString (the real call chain)", () => {
    const a = {};
    a.loop = a;
    expect(() => capToolResultString(safeStringifyToolResult(a))).not.toThrow();
  });
});

describe("complete structured output previews", () => {
  it("keeps host output identities outside canonical JSON evidence", () => {
    const raw = boundedCodeOutput(
      JSON.stringify({ payload: "x".repeat(100000) }),
    );
    const canonical = (value) => {
      if (!value || typeof value !== "object") return;
      expect([Object.prototype, Array.prototype, null]).toContain(
        Object.getPrototypeOf(value),
      );
      for (const key of Reflect.ownKeys(value)) {
        expect(typeof key).toBe("string");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        expect(descriptor.get).toBeUndefined();
        expect(descriptor.set).toBeUndefined();
        canonical(descriptor.value);
      }
    };
    canonical({ type: "tool-result", result: raw });
    expect(JSON.stringify(raw)).not.toMatch(/digest|fingerprint/);
  });

  it("counts omitted large outputs without confusing distinct originals or JSON-forged identities", () => {
    const first = boundedCodeOutput(
      JSON.stringify({ payload: "x".repeat(100000) }),
    );
    const second = boundedCodeOutput(
      JSON.stringify({ payload: "y".repeat(100000) }),
    );
    expect(first.output).toBe(second.output);
    const guard = new ReadFileLoopGuard();
    const record = (result) => {
      guard.startBatch();
      guard.record("run_code", result);
      guard.finishBatch();
    };
    record(first);
    record(second);
    expect(guard.repeatedBatches).toBe(0);
    record(first);
    expect(guard.repeatedBatches).toBe(1);
    record(JSON.parse(JSON.stringify(first)));
    expect(guard.repeatedBatches).toBe(0);
  });

  it("retains exit/error state and small nested fields after a giant leaf", () => {
    const source = {
      stdout: JSON.stringify({ rows: "x".repeat(100000) }),
      exitCode: 7,
      success: false,
      error: "command failed",
      nested: { count: 12, huge: "😀中文".repeat(30000), ok: true },
    };
    const text = capToolResultString(safeStringifyToolResult(source));
    const result = JSON.parse(text);
    expect(text.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(result).toMatchObject({
      exitCode: 7,
      success: false,
      error: "command failed",
    });
    expect(result.nested).toMatchObject({ count: 12, ok: true });
    expect(result.stdout).toContain(String(source.stdout.length));
    expect(result._toolOutputPreview.originalChars).toBe(
      JSON.stringify(source).length,
    );
    expect(() => projectText(text)).not.toThrow();
  });

  it("never normalizes duplicate decoded keys or unsafe numbers into a preview", () => {
    for (const source of [
      `{"a":"first","\\u0061":"last","huge":"${"x".repeat(60000)}"}`,
      `{"number":1e999,"huge":"${"x".repeat(60000)}"}`,
      `{"number":9007199254740993,"huge":"${"x".repeat(60000)}"}`,
    ]) {
      const text = capToolResultString(source);
      const result = JSON.parse(text);
      expect(result.a).toBeUndefined();
      expect(result.number).toBeUndefined();
      expect(result.preview).toContain("omitted");
      expect(() => projectText(text)).not.toThrow();
    }
  });

  it("bounds arrays and deep subtrees without stringifying broken previews", () => {
    const array = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      ok: true,
    }));
    let nested = "x".repeat(80000);
    for (let i = 0; i < 30; i++) nested = { nested };
    for (const source of [array, { nested }]) {
      const text = capToolResultString(JSON.stringify(source));
      expect(text.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
      expect(() => projectText(text)).not.toThrow();
      expect(JSON.parse(text)).toBeTypeOf("object");
    }
    const result = JSON.parse(capToolResultString(JSON.stringify(array)));
    expect(result.preview[0]).toEqual({ id: 0, ok: true });
    expect(result.preview.at(-1)).toMatch(/Items omitted/);
  });

  it("handles prototype keys and marker collisions as data", () => {
    const source = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"value","_omittedFields":0,"_toolOutputPreview":true}',
    );
    source.huge = "z".repeat(100000);
    for (let i = 0; i < 50; i++) source[`field${i}`] = i;
    const text = capToolResultString(JSON.stringify(source));
    const result = JSON.parse(text);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result.__proto__).toEqual({ polluted: true });
    expect(result._toolOutputPreview_).toMatchObject({ truncated: true });
    expect({}.polluted).toBeUndefined();
    expect(() => projectText(text)).not.toThrow();
  });

  it("returns valid bounded JSON even for tiny budgets", () => {
    for (const max of [1, 2, 3, 4, 17, 18, 32, 128, 512, 2048]) {
      const text = capToolResultString(
        JSON.stringify({ error: "failed", huge: "😀".repeat(50000) }),
        max,
      );
      expect(text.length).toBeLessThanOrEqual(max);
      expect(() => JSON.parse(text)).not.toThrow();
      expect(() => projectText(text)).not.toThrow();
    }
  });

  it("previews large JSON command output as a complete tree", () => {
    const source = JSON.stringify({
      payload: "x".repeat(100000),
      total: 123,
      ok: true,
    });
    const raw = { ...boundedCodeOutput(source), exitCode: 0 };
    const text = toolResultForModel("run_code", raw, []);
    const result = JSON.parse(text);
    expect(JSON.parse(result.output)).toMatchObject({ total: 123, ok: true });
    expect(result.exitCode).toBe(0);
    expect(result.returnedChars).toBe(result.output.length);
    expect(() => projectText(text)).not.toThrow();
  });

  it("omits host-cut JSON file pages while preserving the cursor and raw result", () => {
    const raw = buildReadFilePage(
      JSON.stringify({ payload: "x".repeat(100000) }),
      { path: "big.json" },
      {
        filePath: "big.json",
        fileVersion: "1:2:3",
        maxChars: 50000,
      },
    );
    expect(() => projectText(JSON.stringify(raw))).toThrow(/malformed/);
    const before = JSON.stringify(raw);
    const text = toolResultForModel("read_file", raw, []);
    expect(JSON.parse(text)).toMatchObject({
      contentOmitted: true,
      nextRead: raw.nextRead,
      range: raw.range,
      readSpan: raw.readSpan,
      fileVersion: raw.fileVersion,
    });
    expect(JSON.stringify(raw)).toBe(before);
    expect(() => projectText(text)).not.toThrow();
  });

  it("omits incomplete streamed and foreground JSON, retaining exit status", () => {
    const stdout = JSON.stringify({ payload: "x".repeat(100000) });
    for (const [tool, raw] of [
      [
        "run_shell",
        {
          ...shellOutputPreview(stdout, "stdout", 24000),
          exitCode: 7,
          error: "failed",
        },
      ],
      [
        "git",
        {
          ...shellOutputPreview(stdout, "stdout", 30000),
          exitCode: 7,
          error: "failed",
        },
      ],
      [
        "check_shell",
        {
          stdout: stdout.slice(0, 16000),
          exitCode: 7,
          error: "failed",
          next_check: { task_id: "t1" },
        },
      ],
    ]) {
      const text = toolResultForModel(tool, raw, []);
      expect(JSON.parse(text)).toMatchObject({
        stdoutOmitted: true,
        exitCode: 7,
        error: "failed",
      });
      expect(raw.stdout).toContain('{"payload":');
      expect(() => projectText(text)).not.toThrow();
    }
  });

  it("preserves complete JSON file excerpts and rejects uncut malicious strings", () => {
    const complete = {
      path: "data.jsonl",
      content: '{"ok":true}\n',
      range: { startLine: 1, endLine: 1 },
    };
    expect(
      JSON.parse(toolResultForModel("read_file", complete, [])).content,
    ).toBe(complete.content);
    for (const content of ['{"a":1,"a":2}', '{"payload":"unfinished']) {
      const text = toolResultForModel("read_file", { path: "x", content }, []);
      expect(JSON.parse(text).content).toBe(content);
      expect(() => projectText(text)).toThrow(/malformed/);
    }
  });
});
