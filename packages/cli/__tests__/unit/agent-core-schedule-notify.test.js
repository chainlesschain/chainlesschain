import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool, formatToolArgs } from "../../src/runtime/agent-core.js";
import { AgentScheduleStore } from "../../src/lib/agent-schedule-store.js";

// The `schedule` tool persists under ~/.chainlesschain/agent-schedule. Redirect
// HOME/USERPROFILE to a temp dir so the dispatch tests never touch the real one.
describe("schedule tool dispatch", () => {
  let tmpHome;
  let savedHome;
  let savedUserProfile;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-home-"));
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("schedules a wakeup and persists it", async () => {
    const res = await executeTool("schedule", {
      action: "wakeup",
      prompt: "check the deploy",
      delay: "5m",
    });
    expect(res.scheduled).toMatchObject({ kind: "wakeup", status: "pending" });
    const store = new AgentScheduleStore({
      dir: path.join(tmpHome, ".chainlesschain", "agent-schedule"),
    });
    expect(store.list("wakeup")).toHaveLength(1);
  });

  it("creates a cron entry", async () => {
    const res = await executeTool("schedule", {
      action: "cron",
      prompt: "daily standup notes",
      cron: "0 9 * * 1-5",
    });
    expect(res.scheduled).toMatchObject({ kind: "cron", cron: "0 9 * * 1-5" });
  });

  it("creates a monitor entry", async () => {
    const res = await executeTool("schedule", {
      action: "monitor",
      command: "curl -s localhost:3000/health",
      interval: "30s",
      stop_when: "healthy",
      notify_title: "service up",
    });
    expect(res.scheduled).toMatchObject({
      kind: "monitor",
      intervalMs: 30000,
      stopWhen: "healthy",
    });
  });

  it("lists and cancels", async () => {
    const created = await executeTool("schedule", {
      action: "wakeup",
      prompt: "x",
    });
    const listed = await executeTool("schedule", { action: "list" });
    expect(listed.entries).toHaveLength(1);
    const cancelled = await executeTool("schedule", {
      action: "cancel",
      id: created.scheduled.id,
    });
    expect(cancelled.found).toBe(true);
  });

  it("validates action + required args", async () => {
    expect((await executeTool("schedule", { action: "wakeup" })).error).toMatch(
      /requires a prompt/,
    );
    expect((await executeTool("schedule", { action: "cron" })).error).toMatch(
      /requires a prompt and a cron/,
    );
    expect(
      (await executeTool("schedule", { action: "monitor" })).error,
    ).toMatch(/requires a command/);
    expect((await executeTool("schedule", { action: "cancel" })).error).toMatch(
      /requires an id/,
    );
    expect((await executeTool("schedule", { action: "bogus" })).error).toMatch(
      /unknown schedule action/,
    );
  });

  it("threads expires + jitter through to the persisted entry", async () => {
    const before = Date.now();
    const res = await executeTool("schedule", {
      action: "wakeup",
      prompt: "expiring wakeup",
      delay: "1m",
      expires: "2h",
      jitter: "30s",
    });
    // jitter is stored verbatim; expiry is anchored to "now" (± clock skew).
    expect(res.scheduled.jitterMs).toBe(30_000);
    expect(res.scheduled.expiresAt).toBeGreaterThanOrEqual(
      before + 2 * 3600_000,
    );
    expect(res.scheduled.expiresAt).toBeLessThanOrEqual(
      Date.now() + 2 * 3600_000 + 5000,
    );
  });

  it("omits expiry/jitter when not supplied (defaults)", async () => {
    const res = await executeTool("schedule", {
      action: "cron",
      prompt: "plain cron",
      cron: "0 9 * * 1",
    });
    expect(res.scheduled.expiresAt).toBeNull();
    expect(res.scheduled.jitterMs).toBe(0);
  });

  it("threads per-task run policy (permission_mode/worktree/max_turns) through", async () => {
    const res = await executeTool("schedule", {
      action: "wakeup",
      prompt: "isolated report",
      delay: "1m",
      permission_mode: "plan",
      worktree: true,
      max_turns: 5,
    });
    expect(res.scheduled.runPolicy).toEqual({
      permissionMode: "plan",
      worktree: true,
      maxTurns: 5,
    });
  });

  it("threads a goal-condition + budget through to the persisted entry", async () => {
    const res = await executeTool("schedule", {
      action: "cron",
      prompt: "nightly test-to-green",
      cron: "0 2 * * *",
      goal_condition: "exit-zero: npm test",
      max_outer_turns: 6,
      goal_max_tokens: 40000,
    });
    expect(res.scheduled.runPolicy).toEqual({
      goalCondition: "exit-zero: npm test",
      maxOuterTurns: 6,
      goalMaxTokens: 40000,
    });
  });

  it("drops an invalid permission_mode and omits runPolicy when nothing is set", async () => {
    const bad = await executeTool("schedule", {
      action: "cron",
      prompt: "cron with junk mode",
      cron: "0 9 * * 1",
      permission_mode: "not-a-mode",
    });
    // Invalid mode dropped; no other policy field → no runPolicy at all.
    expect(bad.scheduled.runPolicy).toBeUndefined();

    const plain = await executeTool("schedule", {
      action: "wakeup",
      prompt: "plain wakeup",
    });
    expect(plain.scheduled.runPolicy).toBeUndefined();
  });
});

describe("notify tool dispatch (no channels configured)", () => {
  it("returns the no-op note when no channels are set", async () => {
    const saved = {};
    for (const k of [
      "TELEGRAM_BOT_TOKEN",
      "WECOM_WEBHOOK_URL",
      "DINGTALK_WEBHOOK_URL",
      "FEISHU_WEBHOOK_URL",
    ]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const res = await executeTool("notify", { title: "hello" });
      expect(res.channels).toBe(0);
      expect(res.note).toMatch(/No notification channels/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v !== undefined) process.env[k] = v;
      }
    }
  });

  it("errors without a title", async () => {
    const res = await executeTool("notify", { body: "no title" });
    expect(res.error).toMatch(/title/);
  });
});

describe("formatToolArgs for schedule/notify", () => {
  it("summarizes notify and schedule actions", () => {
    expect(formatToolArgs("notify", { level: "success", title: "Done" })).toBe(
      "success: Done",
    );
    expect(
      formatToolArgs("schedule", { action: "cron", cron: "0 9 * * 1" }),
    ).toBe("cron 0 9 * * 1");
    expect(formatToolArgs("schedule", { action: "wakeup", delay: "5m" })).toBe(
      "wakeup +5m",
    );
  });
});
