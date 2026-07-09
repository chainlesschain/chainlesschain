import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import {
  extractContext,
  parseCompletionResponse,
  spawnComplete,
  createInlineCompletionProvider,
} from "../../../vscode-extension/src/completion.js";

const fakeVscode = {
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  InlineCompletionItem: class {
    constructor(insertText, range) {
      this.insertText = insertText;
      this.range = range;
    }
  },
  Range: class {
    constructor(a, b) {
      this.start = a;
      this.end = b;
    }
  },
};

function fakeDoc(text, langId = "javascript") {
  return {
    getText: () => text,
    languageId: langId,
    offsetAt: (pos) => pos.offset,
  };
}

describe("inline completion — extractContext", () => {
  it("splits prefix/suffix at the caret with the language id", () => {
    const r = extractContext("abcXYZdef", 3, "python");
    expect(r.prefix).toBe("abc");
    expect(r.suffix).toBe("XYZdef");
    expect(r.language).toBe("python");
  });

  it("caps each side to maxChars", () => {
    const text = "a".repeat(100) + "|" + "b".repeat(100);
    const r = extractContext(text, 101, "", 10); // caret just after '|'
    expect(r.prefix.length).toBe(10);
    expect(r.suffix.length).toBe(10);
  });

  it("clamps an out-of-range offset", () => {
    const r = extractContext("abc", 999, "");
    expect(r.prefix).toBe("abc");
    expect(r.suffix).toBe("");
  });
});

describe("inline completion — parseCompletionResponse", () => {
  it("reads the completion field", () => {
    expect(parseCompletionResponse('{"completion":"foo()"}')).toBe("foo()");
  });
  it("returns empty on bad JSON or missing field", () => {
    expect(parseCompletionResponse("not json")).toBe("");
    expect(parseCompletionResponse('{"x":1}')).toBe("");
    expect(parseCompletionResponse("")).toBe("");
  });
});

describe("inline completion — spawnComplete", () => {
  function fakeSpawn(stdoutText, { failSpawn = false } = {}) {
    const calls = { stdinData: "" };
    const spawnFn = () => {
      if (failSpawn) throw new Error("spawn failed");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = {
        on: () => {},
        write: (d) => (calls.stdinData += d),
        end: () => {
          // deliver output then close on next tick
          setTimeout(() => {
            child.stdout.emit("data", Buffer.from(stdoutText, "utf8"));
            child.emit("close", 0);
          }, 0);
        },
      };
      child.kill = () => {};
      return child;
    };
    return { spawnFn, calls };
  }

  it("pipes the request as JSON and resolves the parsed completion", async () => {
    const { spawnFn, calls } = fakeSpawn('{"completion":"bar()"}');
    const out = await spawnComplete({
      command: "cc",
      request: { prefix: "a", suffix: "b", language: "js" },
      deps: { spawn: spawnFn },
    });
    expect(out).toBe("bar()");
    expect(JSON.parse(calls.stdinData)).toEqual({
      prefix: "a",
      suffix: "b",
      language: "js",
    });
  });

  it("resolves empty string when the spawn throws", async () => {
    const { spawnFn } = fakeSpawn("", { failSpawn: true });
    const out = await spawnComplete({
      command: "cc",
      request: {},
      deps: { spawn: spawnFn },
    });
    expect(out).toBe("");
  });
});

describe("inline completion — provider gating (manual only)", () => {
  const base = {
    vscode: fakeVscode,
    getCommand: () => "cc",
    getCwd: () => undefined,
    isEnabled: () => true,
    runComplete: async () => "SUGGESTED",
  };

  it("returns a suggestion on an explicit Invoke", async () => {
    const p = createInlineCompletionProvider(base);
    const res = await p.provideInlineCompletionItems(
      fakeDoc("abc"),
      { offset: 3 },
      { triggerKind: fakeVscode.InlineCompletionTriggerKind.Invoke },
      { isCancellationRequested: false },
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0].insertText).toBe("SUGGESTED");
  });

  it("ignores automatic (per-keystroke) triggers", async () => {
    const p = createInlineCompletionProvider(base);
    const res = await p.provideInlineCompletionItems(
      fakeDoc("abc"),
      { offset: 3 },
      { triggerKind: fakeVscode.InlineCompletionTriggerKind.Automatic },
      { isCancellationRequested: false },
    );
    expect(res).toBeUndefined();
  });

  it("returns nothing when disabled", async () => {
    const p = createInlineCompletionProvider({
      ...base,
      isEnabled: () => false,
    });
    const res = await p.provideInlineCompletionItems(
      fakeDoc("abc"),
      { offset: 3 },
      { triggerKind: fakeVscode.InlineCompletionTriggerKind.Invoke },
      { isCancellationRequested: false },
    );
    expect(res).toBeUndefined();
  });

  it("returns nothing for an empty document", async () => {
    const p = createInlineCompletionProvider(base);
    const res = await p.provideInlineCompletionItems(
      fakeDoc(""),
      { offset: 0 },
      { triggerKind: fakeVscode.InlineCompletionTriggerKind.Invoke },
      { isCancellationRequested: false },
    );
    expect(res).toBeUndefined();
  });

  it("suppresses a suggestion that arrives after cancellation", async () => {
    const p = createInlineCompletionProvider(base);
    const res = await p.provideInlineCompletionItems(
      fakeDoc("abc"),
      { offset: 3 },
      { triggerKind: fakeVscode.InlineCompletionTriggerKind.Invoke },
      { isCancellationRequested: true },
    );
    expect(res).toBeUndefined();
  });
});
