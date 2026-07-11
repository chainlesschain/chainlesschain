import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  groupKey,
  buildDashboardModel,
  renderDashboard,
  runBgDashboard,
  FILTERS,
  GROUP_TITLES,
} from "../../src/repl/bg-dashboard.js";

const NOW = 1_000_000;

function session(overrides = {}) {
  return {
    id: `bg-${Math.random().toString(16).slice(2, 8)}`,
    status: "running",
    phase: "turn",
    startedAt: NOW - 60_000,
    cwd: "C:/work/repo",
    title: "task",
    ...overrides,
  };
}

describe("bg-dashboard model", () => {
  it("groups sessions: running+idle → needs-input, lost → failed", () => {
    expect(groupKey({ status: "running", phase: "turn" })).toBe("working");
    expect(groupKey({ status: "running", phase: "idle" })).toBe("needs-input");
    expect(groupKey({ status: "completed" })).toBe("completed");
    expect(groupKey({ status: "failed" })).toBe("failed");
    expect(groupKey({ status: "lost" })).toBe("failed");
    expect(groupKey({ status: "stopped" })).toBe("stopped");
  });

  it("orders groups Needs input → Working → Completed → Failed → Stopped and drops empty groups", () => {
    const model = buildDashboardModel(
      [
        session({ id: "a", status: "completed", endedAt: NOW }),
        session({ id: "b", status: "running", phase: "idle" }),
        session({ id: "c", status: "running", phase: "turn" }),
      ],
      { now: NOW },
    );
    expect(model.groups.map((g) => g.key)).toEqual([
      "needs-input",
      "working",
      "completed",
    ]);
    expect(model.flat.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts pinned sessions first inside their group", () => {
    const model = buildDashboardModel(
      [
        session({ id: "new", startedAt: NOW - 10 }),
        session({ id: "old-pinned", startedAt: NOW - 99_000, pinned: true }),
      ],
      { now: NOW },
    );
    expect(model.flat.map((s) => s.id)).toEqual(["old-pinned", "new"]);
  });

  it("applies the active and needs-input filters", () => {
    const sessions = [
      session({ id: "run", status: "running", phase: "turn" }),
      session({ id: "idle", status: "running", phase: "idle" }),
      session({ id: "done", status: "completed", endedAt: NOW }),
    ];
    expect(
      buildDashboardModel(sessions, { now: NOW, filter: "active" }).flat.map(
        (s) => s.id,
      ),
    ).toEqual(["idle", "run"]);
    expect(
      buildDashboardModel(sessions, {
        now: NOW,
        filter: "needs-input",
      }).flat.map((s) => s.id),
    ).toEqual(["idle"]);
    expect(FILTERS).toContain("all");
  });
});

describe("bg-dashboard render", () => {
  it("renders group titles, selection marker, pins, PR link and workspace", () => {
    const model = buildDashboardModel(
      [
        session({
          id: "bg-one",
          status: "running",
          phase: "idle",
          pinned: true,
          worktree: "C:/work/repo-wt1",
          pr: { number: 123, state: "open" },
        }),
        session({ id: "bg-two", status: "completed", endedAt: NOW }),
      ],
      { now: NOW },
    );
    const out = renderDashboard(model, { selectedIndex: 0 });
    expect(out).toContain(GROUP_TITLES["needs-input"]);
    expect(out).toContain(GROUP_TITLES.completed);
    expect(out).toContain("bg-one");
    expect(out).toContain("❯"); // selection marker
    expect(out).toContain("★"); // pin
    expect(out).toContain("#123");
    expect(out).toContain("C:/work/repo-wt1");
    expect(out).toContain("q quit");
  });

  it("renders the peek panel with the log tail", () => {
    const model = buildDashboardModel([session({ id: "bg-peek" })], {
      now: NOW,
    });
    const out = renderDashboard(model, {
      selectedIndex: 0,
      peek: { id: "bg-peek", log: "line1\nline2\n" },
    });
    expect(out).toContain("Peek: bg-peek");
    expect(out).toContain("line1");
    expect(out).toContain("line2");
  });

  it("renders an empty-state hint", () => {
    const model = buildDashboardModel([], { now: NOW });
    const out = renderDashboard(model, { selectedIndex: 0 });
    expect(out).toContain("No background agents");
  });
});

describe("bg-dashboard controller", () => {
  function fakeIo() {
    let keyHandler = null;
    return {
      isTTY: true,
      writes: [],
      write(s) {
        this.writes.push(s);
      },
      enterAlt: vi.fn(),
      exitAlt: vi.fn(),
      clear: vi.fn(),
      setRaw: vi.fn(),
      async listenKeys(onKey) {
        keyHandler = onKey;
        return () => {
          keyHandler = null;
        };
      },
      promptLine: vi.fn(async () => ""),
      async press(name, extra = {}) {
        await keyHandler?.("", { name, ...extra });
      },
    };
  }

  it("navigates, stops the selected agent, and quits", async () => {
    const io = fakeIo();
    const stopAgent = vi.fn();
    const sessions = [
      session({ id: "bg-a", status: "running", phase: "idle" }),
      session({ id: "bg-b", status: "running", phase: "turn" }),
    ];
    const done = runBgDashboard({
      io,
      now: () => NOW,
      refreshMs: 60_000,
      listAgents: () => sessions,
      stopAgent,
    });
    await new Promise((r) => setTimeout(r, 20)); // let listenKeys register
    await io.press("down");
    await io.press("s");
    await io.press("q");
    await done;
    expect(stopAgent).toHaveBeenCalledWith("bg-b");
    expect(io.enterAlt).toHaveBeenCalled();
    expect(io.exitAlt).toHaveBeenCalled();
  });

  it("peeks with enter and replies via replyAgent", async () => {
    const io = fakeIo();
    io.promptLine = vi.fn(async () => "keep going");
    const replyAgent = vi.fn(async () => {});
    const readLog = vi.fn(() => "tail line");
    const sessions = [
      session({ id: "bg-a", status: "running", phase: "idle" }),
    ];
    const done = runBgDashboard({
      io,
      now: () => NOW,
      refreshMs: 60_000,
      listAgents: () => sessions,
      readLog,
      replyAgent,
    });
    await new Promise((r) => setTimeout(r, 20));
    await io.press("return");
    expect(readLog).toHaveBeenCalledWith("bg-a", 15);
    expect(io.writes.join("")).toContain("tail line");
    await io.press("r");
    await io.press("q");
    await done;
    expect(replyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bg-a" }),
      "keep going",
    );
  });

  it("pins, cycles filters, and dispatches a new task", async () => {
    const io = fakeIo();
    io.promptLine = vi.fn(async () => "build the report");
    const pinAgent = vi.fn();
    const dispatchAgent = vi.fn(async () => "bg-new");
    const sessions = [session({ id: "bg-a" })];
    const done = runBgDashboard({
      io,
      now: () => NOW,
      refreshMs: 60_000,
      listAgents: () => sessions,
      pinAgent,
      dispatchAgent,
    });
    await new Promise((r) => setTimeout(r, 20));
    await io.press("x");
    expect(pinAgent).toHaveBeenCalledWith("bg-a", true);
    await io.press("f"); // all → active
    await io.press("d");
    expect(dispatchAgent).toHaveBeenCalledWith("build the report");
    await io.press("q");
    await done;
  });

  it("ctrl-c quits and restores the terminal", async () => {
    const io = fakeIo();
    const done = runBgDashboard({
      io,
      now: () => NOW,
      refreshMs: 60_000,
      listAgents: () => [],
    });
    await new Promise((r) => setTimeout(r, 20));
    await io.press("c", { ctrl: true });
    await done;
    expect(io.setRaw).toHaveBeenLastCalledWith(false);
    expect(io.exitAlt).toHaveBeenCalled();
  });
});

describe("setBackgroundAgentPinned", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-bg-pin-"));
    process.env.CC_BACKGROUND_AGENTS_DIR = dir;
  });
  afterEach(() => {
    delete process.env.CC_BACKGROUND_AGENTS_DIR;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("persists the pinned flag on the session state", async () => {
    const {
      writeBackgroundAgentState,
      setBackgroundAgentPinned,
      readBackgroundAgentState,
    } = await import("../../src/lib/background-agent-supervisor.js");
    writeBackgroundAgentState({
      id: "bg-pin-1",
      status: "completed",
      startedAt: 1,
      endedAt: 2,
    });
    const pinned = setBackgroundAgentPinned("bg-pin-1", true);
    expect(pinned.pinned).toBe(true);
    expect(readBackgroundAgentState("bg-pin-1").pinned).toBe(true);
    const unpinned = setBackgroundAgentPinned("bg-pin-1", false);
    expect(unpinned.pinned).toBe(false);
  });

  it("throws for an unknown session", async () => {
    const { setBackgroundAgentPinned } =
      await import("../../src/lib/background-agent-supervisor.js");
    expect(() => setBackgroundAgentPinned("bg-nope", true)).toThrow(
      /not found/,
    );
  });
});
