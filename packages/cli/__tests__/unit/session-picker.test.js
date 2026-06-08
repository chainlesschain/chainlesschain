/**
 * Unit tests for the shared session picker. The session list, TTY-ness, and the
 * inquirer `select` fn are all injected via `deps`, so every branch except the
 * real interactive prompt is deterministically testable.
 */

import { describe, it, expect, vi } from "vitest";
import {
  pickRecentSession,
  formatSessionChoice,
} from "../../src/lib/session-picker.js";

const S = (id, extra = {}) => ({
  id,
  title: `t-${id}`,
  message_count: 3,
  updated_at: "2026-06-08T00:00:00Z",
  _store: "jsonl",
  ...extra,
});

describe("formatSessionChoice", () => {
  it("renders name/value/short and tags JSONL sessions", () => {
    const c = formatSessionChoice(S("sess-abcdef123456"));
    expect(c.value).toBe("sess-abcdef123456");
    expect(c.short).toBe("sess-abcdef1");
    expect(c.name).toContain("t-sess-abcdef123456");
    expect(c.name).toContain("3 msgs");
    expect(c.name).toContain("[JSONL]");
  });

  it("omits the [JSONL] tag for db sessions", () => {
    const c = formatSessionChoice(S("x", { _store: "db" }));
    expect(c.name).not.toContain("[JSONL]");
  });
});

describe("pickRecentSession", () => {
  it("returns id:null when there are no sessions", async () => {
    const r = await pickRecentSession(
      null,
      {},
      {
        listRecentSessions: () => [],
        isTTY: true,
      },
    );
    expect(r).toEqual({ id: null, sessions: [], picked: false });
  });

  it("returns the most recent without prompting when only one session", async () => {
    const select = vi.fn();
    const r = await pickRecentSession(
      null,
      {},
      {
        listRecentSessions: () => [S("only")],
        isTTY: true,
        select,
      },
    );
    expect(r.id).toBe("only");
    expect(r.picked).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it("returns the most recent (no prompt) when not a TTY", async () => {
    const select = vi.fn();
    const r = await pickRecentSession(
      null,
      {},
      {
        listRecentSessions: () => [S("newest"), S("older")],
        isTTY: false,
        select,
      },
    );
    expect(r.id).toBe("newest");
    expect(r.picked).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it("honours noPicker even with a TTY and many sessions", async () => {
    const select = vi.fn();
    const r = await pickRecentSession(
      null,
      { noPicker: true },
      {
        listRecentSessions: () => [S("newest"), S("older")],
        isTTY: true,
        select,
      },
    );
    expect(r.id).toBe("newest");
    expect(select).not.toHaveBeenCalled();
  });

  it("prompts and returns the chosen id on a TTY with multiple sessions", async () => {
    const select = vi.fn(async () => "older");
    const r = await pickRecentSession(
      null,
      { message: "pick" },
      {
        listRecentSessions: () => [S("newest"), S("older")],
        isTTY: true,
        select,
      },
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0][0].message).toBe("pick");
    expect(select.mock.calls[0][0].choices).toHaveLength(2);
    expect(r).toEqual({
      id: "older",
      sessions: [S("newest"), S("older")],
      picked: true,
    });
  });

  it("falls back to most recent when the prompt is cancelled (Ctrl-C)", async () => {
    const select = vi.fn(async () => {
      throw new Error("User force closed the prompt");
    });
    const r = await pickRecentSession(
      null,
      {},
      {
        listRecentSessions: () => [S("newest"), S("older")],
        isTTY: true,
        select,
      },
    );
    expect(r.id).toBe("newest");
    expect(r.picked).toBe(false);
  });
});
