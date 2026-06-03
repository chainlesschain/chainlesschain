import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  runHook,
  HOOK_EVENTS,
  resolveHookFile,
  hookFileExists,
} = require("../workflow-hook-runner.js");

let tmpRoot;

function writeHook(event, body) {
  const dir = path.join(tmpRoot, ".chainlesschain", "hooks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${event}.js`), body, "utf-8");
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hook-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("workflow-hook-runner", () => {
  it("exposes the canonical event list", () => {
    expect(HOOK_EVENTS).toContain("pre-intent");
    expect(HOOK_EVENTS).toContain("post-done");
    // Phase C added pre/post-verify and pre/post-complete alongside
    // the original 8 events (intent/plan/execute/done × pre/post).
    expect(HOOK_EVENTS).toContain("pre-verify");
    expect(HOOK_EVENTS).toContain("post-verify");
    expect(HOOK_EVENTS).toContain("pre-complete");
    expect(HOOK_EVENTS).toContain("post-complete");
    expect(HOOK_EVENTS).toHaveLength(12);
  });

  it("returns skipped when the hook file does not exist", async () => {
    const result = await runHook("pre-intent", {
      projectRoot: tmpRoot,
      sessionId: "s1",
    });
    expect(result).toEqual({ success: true, skipped: true });
  });

  it("hookFileExists detects hook presence", () => {
    expect(hookFileExists(tmpRoot, "pre-plan")).toBe(false);
    writeHook("pre-plan", "module.exports = async () => {};");
    expect(hookFileExists(tmpRoot, "pre-plan")).toBe(true);
  });

  it("invokes a hook and forwards its return value as data", async () => {
    writeHook(
      "post-plan",
      `module.exports = async (ctx) => ({ saw: ctx.sessionId, event: ctx.event });`,
    );
    const result = await runHook("post-plan", {
      projectRoot: tmpRoot,
      sessionId: "alpha",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ saw: "alpha", event: "post-plan" });
  });

  it("supports module.exports.run style hooks", async () => {
    writeHook("post-intent", `module.exports = { run: async () => "ok" };`);
    const result = await runHook("post-intent", {
      projectRoot: tmpRoot,
      sessionId: "s1",
    });
    expect(result).toEqual({ success: true, data: "ok" });
  });

  it("passes sessionId + projectRoot + payload to the hook", async () => {
    writeHook(
      "pre-execute",
      `const fs = require("fs");
       const path = require("path");
       module.exports = async (ctx) => {
         fs.writeFileSync(
           path.join(ctx.projectRoot, "hook-called.json"),
           JSON.stringify(ctx.payload),
         );
       };`,
    );
    await runHook("pre-execute", {
      projectRoot: tmpRoot,
      sessionId: "s2",
      payload: { role: "executor", size: 3 },
    });
    const written = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, "hook-called.json"), "utf-8"),
    );
    expect(written).toEqual({ role: "executor", size: 3 });
  });

  it("re-throws when a pre-* hook throws (veto semantics)", async () => {
    writeHook(
      "pre-plan",
      `module.exports = async () => { throw new Error("blocked by policy"); };`,
    );
    await expect(
      runHook("pre-plan", { projectRoot: tmpRoot, sessionId: "s1" }),
    ).rejects.toThrow(/blocked by policy/);
  });

  it("swallows errors from post-* hooks and returns success:false", async () => {
    writeHook(
      "post-execute",
      `module.exports = async () => { throw new Error("webhook down"); };`,
    );
    const result = await runHook("post-execute", {
      projectRoot: tmpRoot,
      sessionId: "s1",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/webhook down/);
  });

  it("rejects a pre-* hook that exceeds the timeout", async () => {
    writeHook("pre-intent", `module.exports = () => new Promise(() => {});`);
    await expect(
      runHook("pre-intent", {
        projectRoot: tmpRoot,
        sessionId: "s1",
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/timed out after 50ms/);
  });

  it("treats post-* timeout as a non-fatal failure", async () => {
    writeHook("post-intent", `module.exports = () => new Promise(() => {});`);
    const result = await runHook("post-intent", {
      projectRoot: tmpRoot,
      sessionId: "s1",
      timeoutMs: 50,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });

  it("rejects hook files that don't export a function", async () => {
    writeHook("pre-done", `module.exports = { notAFunction: true };`);
    await expect(
      runHook("pre-done", { projectRoot: tmpRoot, sessionId: "s1" }),
    ).rejects.toThrow(/must export a function/);
  });

  it("post-* with bad export returns success:false", async () => {
    writeHook("post-done", `module.exports = "plain string";`);
    const result = await runHook("post-done", {
      projectRoot: tmpRoot,
      sessionId: "s1",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must export a function/);
  });

  it("throws for unknown events", async () => {
    await expect(
      runHook("pre-nope", { projectRoot: tmpRoot, sessionId: "s1" }),
    ).rejects.toThrow(/unknown event/);
  });

  it("throws if projectRoot is missing", async () => {
    await expect(runHook("pre-intent", { sessionId: "s1" })).rejects.toThrow(
      /projectRoot is required/,
    );
  });

  it("hot-reloads hook edits (require cache bypass)", async () => {
    writeHook("post-plan", `module.exports = async () => "v1";`);
    const first = await runHook("post-plan", {
      projectRoot: tmpRoot,
      sessionId: "s1",
    });
    expect(first.data).toBe("v1");

    writeHook("post-plan", `module.exports = async () => "v2";`);
    const second = await runHook("post-plan", {
      projectRoot: tmpRoot,
      sessionId: "s1",
    });
    expect(second.data).toBe("v2");
  });

  it("resolveHookFile produces the expected path", () => {
    const expected = path.join(
      tmpRoot,
      ".chainlesschain",
      "hooks",
      "pre-execute.js",
    );
    expect(resolveHookFile(tmpRoot, "pre-execute")).toBe(expected);
  });
});
