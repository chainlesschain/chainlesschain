import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  AUTO_COMPLETION_SLO,
  MAX_COMPLETION_CHARS,
  AutomaticCompletionPolicy,
  cleanCompletion,
  extractContext,
  parseCompletionResponse,
  spawnComplete,
  createInlineCompletionProvider,
  isAutomaticCompletionUsable,
  normalizeAutoOptions,
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

describe("inline completion - governed automatic mode", () => {
  const token = { isCancellationRequested: false };
  const automatic = {
    triggerKind: fakeVscode.InlineCompletionTriggerKind.Automatic,
  };

  it("normalizes bounded automatic options", () => {
    expect(
      normalizeAutoOptions({
        debounceMs: 1,
        maxRequestsPerHour: 0,
        maxCompletionChars: 99999,
      }),
    ).toMatchObject({
      debounceMs: 100,
      maxRequestsPerHour: 1,
      maxCompletionChars: MAX_COMPLETION_CHARS,
    });
  });

  it("stays opt-in and keeps automatic typing quiet by default", async () => {
    const runComplete = vi.fn(async () => "suggested");
    const provider = createInlineCompletionProvider({
      vscode: fakeVscode,
      isEnabled: () => true,
      isAutomaticEnabled: () => false,
      runComplete,
    });
    expect(
      await provider.provideInlineCompletionItems(
        fakeDoc("const value"),
        { offset: 11 },
        automatic,
        token,
      ),
    ).toBeUndefined();
    expect(runComplete).not.toHaveBeenCalled();
  });

  it("debounces, caches exact contexts, and records latency SLO evidence", async () => {
    vi.useFakeTimers();
    try {
      let now = 1000;
      const runComplete = vi.fn(async () => {
        now += 292;
        return " = buildValue()";
      });
      const provider = createInlineCompletionProvider({
        vscode: fakeVscode,
        isEnabled: () => true,
        isAutomaticEnabled: () => true,
        getAutomaticOptions: () => ({ debounceMs: 250 }),
        runComplete,
        now: () => now,
      });
      const first = provider.provideInlineCompletionItems(
        fakeDoc("const value"),
        { offset: 11 },
        automatic,
        token,
      );
      expect(runComplete).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(249);
      expect(runComplete).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect((await first).items[0].insertText).toBe(" = buildValue()");

      const cached = await provider.provideInlineCompletionItems(
        fakeDoc("const value"),
        { offset: 11 },
        automatic,
        token,
      );
      expect(cached.items[0].insertText).toBe(" = buildValue()");
      expect(runComplete).toHaveBeenCalledTimes(1);
      expect(provider.getAutomaticMetrics()).toMatchObject({
        requests: 1,
        cacheHits: 1,
        p50Ms: 292,
        p95Ms: 292,
        samples: 1,
      });
      expect(runComplete).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 4750 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not spend budget when cancelled during debounce", async () => {
    let cancel;
    const runComplete = vi.fn(async () => "unused");
    const provider = createInlineCompletionProvider({
      vscode: fakeVscode,
      isEnabled: () => true,
      isAutomaticEnabled: () => true,
      runComplete,
      deps: { setTimeout: () => 1, clearTimeout: () => {} },
    });
    const pending = provider.provideInlineCompletionItems(
      fakeDoc("const value"),
      { offset: 11 },
      automatic,
      {
        isCancellationRequested: false,
        onCancellationRequested: (fn) => {
          cancel = fn;
          return { dispose: () => {} };
        },
      },
    );
    cancel();
    expect(await pending).toBeUndefined();
    expect(runComplete).not.toHaveBeenCalled();
    expect(provider.getAutomaticMetrics()).toMatchObject({
      requests: 0,
      cancellations: 1,
    });
  });

  it("fails quiet when the independent hourly budget is exhausted", async () => {
    vi.useFakeTimers();
    try {
      const runComplete = vi.fn(async () => "Suggestion");
      const provider = createInlineCompletionProvider({
        vscode: fakeVscode,
        isEnabled: () => true,
        isAutomaticEnabled: () => true,
        getAutomaticOptions: () => ({
          debounceMs: 100,
          maxRequestsPerHour: 1,
        }),
        runComplete,
      });
      const first = provider.provideInlineCompletionItems(
        fakeDoc("const one"),
        { offset: 9 },
        automatic,
        token,
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(await first).toBeDefined();
      const second = provider.provideInlineCompletionItems(
        fakeDoc("const two"),
        { offset: 9 },
        automatic,
        token,
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(await second).toBeUndefined();
      expect(runComplete).toHaveBeenCalledTimes(1);
      expect(provider.getAutomaticMetrics().budgetRejects).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects low-quality automatic output", () => {
    const options = normalizeAutoOptions({ maxCompletionLines: 2 });
    expect(
      isAutomaticCompletionUsable(
        "line1\nline2\nline3",
        { suffix: "" },
        options,
      ),
    ).toBe(false);
    expect(
      isAutomaticCompletionUsable(
        "Here is the completion",
        { suffix: "" },
        options,
      ),
    ).toBe(false);
    expect(
      isAutomaticCompletionUsable("value", { suffix: "value;" }, options),
    ).toBe(false);
    expect(
      isAutomaticCompletionUsable("nextValue", { suffix: ";" }, options),
    ).toBe(true);
  });

  it("keeps a rolling request and character budget", () => {
    let now = 0;
    const policy = new AutomaticCompletionPolicy({ now: () => now });
    const options = normalizeAutoOptions({
      maxRequestsPerHour: 2,
      maxContextCharsPerHour: 1000,
    });
    expect(policy.reserve(500, options)).toBe(true);
    expect(policy.reserve(500, options)).toBe(true);
    expect(policy.reserve(1, options)).toBe(false);
    now = 3_600_001;
    expect(policy.reserve(500, options)).toBe(true);
  });

  it("deduplicates in-flight exact contexts and rejects stale slow output", () => {
    const policy = new AutomaticCompletionPolicy();
    expect(policy.begin("same")).toBe(true);
    expect(policy.begin("same")).toBe(false);
    expect(policy.snapshot().dedupeHits).toBe(1);
    policy.end("same");
    expect(policy.begin("same")).toBe(true);
    policy.end("same");

    expect(policy.recordLatency(AUTO_COMPLETION_SLO.p95Ms + 1)).toBe(false);
    expect(policy.snapshot()).toMatchObject({
      sloRejects: 1,
      sloTargetP50Ms: 2000,
      sloTargetP95Ms: 5000,
    });
  });

  it("evaluates the published P50/P95 SLO after twenty samples", () => {
    const policy = new AutomaticCompletionPolicy();
    for (let sample = 1; sample <= 20; sample++) {
      expect(policy.recordLatency(sample * 100)).toBe(true);
    }
    expect(policy.snapshot()).toMatchObject({
      p50Ms: 1000,
      p95Ms: 1900,
      samples: 20,
      sloEvaluable: true,
      sloMet: true,
    });
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

describe("inline completion — cleanCompletion (JetBrains-twin parity)", () => {
  it("strips markdown fences and the <CURSOR> sentinel", () => {
    expect(cleanCompletion("```js\nfoo();\n```")).toBe("foo();");
    expect(cleanCompletion("bar(<CURSOR>);")).toBe("bar();");
  });

  it("caps runaway completions and trims TRAILING whitespace only", () => {
    expect(cleanCompletion("x".repeat(MAX_COMPLETION_CHARS + 100)).length).toBe(
      MAX_COMPLETION_CHARS,
    );
    // Leading indentation is meaningful — must survive.
    expect(cleanCompletion("  indented();  \n")).toBe("  indented();");
    expect(cleanCompletion("")).toBe("");
    expect(cleanCompletion(null)).toBe("");
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

  it("applies the defensive clean to the spawned result", async () => {
    const { spawnFn } = fakeSpawn(
      JSON.stringify({ completion: "```js\nfoo();\n```" }),
    );
    const out = await spawnComplete({
      command: "cc",
      request: { prefix: "a" },
      deps: { spawn: spawnFn },
    });
    expect(out).toBe("foo();");
  });

  it("kills the in-flight child when the token cancels", async () => {
    // A child that never produces output — only cancellation ends the call.
    let killed = 0;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin = { on: () => {}, write: () => {}, end: () => {} };
    child.kill = () => {
      killed++;
    };
    let fireCancel;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (fn) => {
        fireCancel = fn;
        return { dispose: () => {} };
      },
    };
    const pending = spawnComplete({
      command: "cc",
      request: { prefix: "a" },
      token,
      deps: { spawn: () => child },
    });
    fireCancel();
    expect(await pending).toBe("");
    expect(killed).toBeGreaterThan(0);
  });

  it.runIf(process.platform === "win32")(
    "tree-kills the cmd.exe wrapper on Windows cancel (plain kill orphans the cc grandchild)",
    async () => {
      const treeKills = [];
      const child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stdin = { on: () => {}, write: () => {}, end: () => {} };
      child.kill = () => {};
      let fireCancel;
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: (fn) => {
          fireCancel = fn;
          return { dispose: () => {} };
        },
      };
      const pending = spawnComplete({
        command: "cc",
        request: { prefix: "a" },
        token,
        deps: {
          spawn: () => child,
          treeKill: (cmd, args) => treeKills.push([cmd, ...args]),
        },
      });
      fireCancel();
      expect(await pending).toBe("");
      expect(treeKills).toEqual([["taskkill", "/pid", "4242", "/T", "/F"]]);
    },
  );

  it("does not tree-kill a child that already exited (normal completion)", async () => {
    const treeKills = [];
    const { spawnFn } = fakeSpawn('{"completion":"x"}');
    const out = await spawnComplete({
      command: "cc",
      request: { prefix: "a" },
      deps: {
        spawn: spawnFn,
        treeKill: (...a) => treeKills.push(a),
      },
    });
    expect(out).toBe("x");
    expect(treeKills).toEqual([]);
  });

  it("short-circuits an already-cancelled token", async () => {
    let killed = 0;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin = { on: () => {}, write: () => {}, end: () => {} };
    child.kill = () => {
      killed++;
    };
    const out = await spawnComplete({
      command: "cc",
      request: { prefix: "a" },
      token: {
        isCancellationRequested: true,
        onCancellationRequested: () => ({ dispose: () => {} }),
      },
      deps: { spawn: () => child },
    });
    expect(out).toBe("");
    expect(killed).toBeGreaterThan(0);
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
