import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as turnCtx from "../../src/lib/turn-context.js";

const { buildTurnContext, defaultPrepareCall, _deps } = turnCtx;

describe("turn-context — buildTurnContext", () => {
  let realExec;

  beforeEach(() => {
    realExec = _deps.execSync;
  });

  afterEach(() => {
    _deps.execSync = realExec;
  });

  it("always includes cwd and iteration heading", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = buildTurnContext({ iteration: 1, cwd: "/tmp/x" });
    expect(out).toMatch(/## Turn context \(iteration 1\)/);
    expect(out).toMatch(/- cwd:/);
  });

  it("includes git branch + short sha + clean status", () => {
    _deps.execSync = vi.fn((cmd) => {
      if (cmd.includes("abbrev-ref")) return "main\n";
      if (cmd.includes("short HEAD")) return "abc1234\n";
      if (cmd.includes("porcelain")) return "";
      return "";
    });
    const out = buildTurnContext({ iteration: 2, cwd: "/tmp" });
    expect(out).toMatch(/- git: main@abc1234 \(clean\)/);
  });

  it("reports dirty file count", () => {
    _deps.execSync = vi.fn((cmd) => {
      if (cmd.includes("abbrev-ref")) return "feat/x";
      if (cmd.includes("short HEAD")) return "def5";
      if (cmd.includes("porcelain")) return " M a.js\n M b.js\n?? c.js";
      return "";
    });
    const out = buildTurnContext({ iteration: 1, cwd: "/tmp" });
    expect(out).toMatch(/- git: feat\/x@def5 \(3 uncommitted\)/);
  });

  it("omits git line when not a repo", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("fatal: not a git repo");
    });
    const out = buildTurnContext({ iteration: 1, cwd: "/tmp" });
    expect(out).not.toMatch(/- git:/);
  });

  it("includes session id when provided", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = buildTurnContext({ sessionId: "sess-1", cwd: "/tmp" });
    expect(out).toMatch(/- session: sess-1/);
  });

  it("includes active skills when non-empty", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = buildTurnContext({
      activeSkills: ["code-review", "summarize"],
      cwd: "/tmp",
    });
    expect(out).toMatch(/- active skills: code-review, summarize/);
  });

  it("defaults iteration to 1 when missing", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = buildTurnContext({ cwd: "/tmp" });
    expect(out).toMatch(/iteration 1/);
  });
});

describe("turn-context — defaultPrepareCall", () => {
  let realExec;

  beforeEach(() => {
    realExec = _deps.execSync;
  });
  afterEach(() => {
    _deps.execSync = realExec;
  });

  it("returns { systemSuffix } for non-empty context", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("no git");
    });
    const out = defaultPrepareCall({ iteration: 3, cwd: "/tmp" });
    expect(out).toBeTruthy();
    expect(typeof out.systemSuffix).toBe("string");
    expect(out.systemSuffix).toMatch(/iteration 3/);
  });
});
