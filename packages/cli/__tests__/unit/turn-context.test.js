import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as turnCtx from "../../src/lib/turn-context.js";

const { buildTurnContext, defaultPrepareCall, _deps } = turnCtx;

describe("turn-context — buildTurnContext", () => {
  let realExecFile;

  beforeEach(() => {
    realExecFile = _deps.execFileSync;
  });

  afterEach(() => {
    _deps.execFileSync = realExecFile;
  });

  it("always includes cwd and iteration heading", () => {
    _deps.execFileSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = buildTurnContext({ iteration: 1, cwd: "/tmp/x" });
    expect(out).toMatch(/## Turn context \(iteration 1\)/);
    expect(out).toMatch(/- cwd:/);
  });

  it("includes git branch + short sha + clean status", () => {
    _deps.execFileSync = vi.fn((_command, args) => {
      if (args.includes("--abbrev-ref")) return "main\n";
      if (args.includes("--short")) return "abc1234\n";
      if (args.includes("--porcelain")) return "";
      return "";
    });
    const out = buildTurnContext({ iteration: 2, cwd: "/tmp" });
    expect(out).toMatch(/- git: main@abc1234 \(clean\)/);
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      1,
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      expect.objectContaining({
        cwd: "/tmp",
        origin: "context:git",
        policy: "allow",
        scope: "context",
        shell: false,
      }),
    );
  });

  it("reports dirty file count", () => {
    _deps.execFileSync = vi.fn((_command, args) => {
      if (args.includes("--abbrev-ref")) return "feat/x";
      if (args.includes("--short")) return "def5";
      if (args.includes("--porcelain")) return " M a.js\n M b.js\n?? c.js";
      return "";
    });
    const out = buildTurnContext({ iteration: 1, cwd: "/tmp" });
    expect(out).toMatch(/- git: feat\/x@def5 \(3 uncommitted\)/);
  });

  it("reports '(status unknown)' — not '(clean)' — when git status fails", () => {
    // branch/head resolve, but `status --porcelain` times out / exceeds the
    // buffer (returns null). The old code conflated null with "" → "(clean)".
    _deps.execFileSync = vi.fn((_command, args) => {
      if (args.includes("--abbrev-ref")) return "main\n";
      if (args.includes("--short")) return "abc1234\n";
      if (args.includes("--porcelain")) throw new Error("ENOBUFS / timeout");
      return "";
    });
    const out = buildTurnContext({ iteration: 1, cwd: "/tmp" });
    expect(out).toMatch(/- git: main@abc1234 \(status unknown\)/);
    expect(out).not.toMatch(/\(clean\)/);
  });

  it("passes a generous maxBuffer to git so a large status isn't ENOBUFS", () => {
    let porcelainOpts = null;
    _deps.execFileSync = vi.fn((_command, args, opts) => {
      if (args.includes("--abbrev-ref")) return "main";
      if (args.includes("--short")) return "abc";
      if (args.includes("--porcelain")) {
        porcelainOpts = opts;
        return " M a.js";
      }
      return "";
    });
    buildTurnContext({ cwd: "/tmp" });
    expect(porcelainOpts.maxBuffer).toBeGreaterThanOrEqual(8 * 1024 * 1024);
  });

  it("omits git line when not a repo", () => {
    _deps.execFileSync = vi.fn(() => {
      throw new Error("fatal: not a git repo");
    });
    const out = buildTurnContext({ iteration: 1, cwd: "/tmp" });
    expect(out).not.toMatch(/- git:/);
  });

  it("includes session id when provided", () => {
    _deps.execFileSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = buildTurnContext({ sessionId: "sess-1", cwd: "/tmp" });
    expect(out).toMatch(/- session: sess-1/);
  });

  it("includes active skills when non-empty", () => {
    _deps.execFileSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = buildTurnContext({
      activeSkills: ["code-review", "summarize"],
      cwd: "/tmp",
    });
    expect(out).toMatch(/- active skills: code-review, summarize/);
  });

  it("defaults iteration to 1 when missing", () => {
    _deps.execFileSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = buildTurnContext({ cwd: "/tmp" });
    expect(out).toMatch(/iteration 1/);
  });
});

describe("turn-context — defaultPrepareCall", () => {
  let realExecFile;

  beforeEach(() => {
    realExecFile = _deps.execFileSync;
  });
  afterEach(() => {
    _deps.execFileSync = realExecFile;
  });

  it("returns { systemSuffix } for non-empty context", () => {
    _deps.execFileSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = defaultPrepareCall({ iteration: 3, cwd: "/tmp" });
    expect(out).toBeTruthy();
    expect(typeof out.systemSuffix).toBe("string");
    expect(out.systemSuffix).toMatch(/iteration 3/);
  });
});
