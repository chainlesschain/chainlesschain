/**
 * Sessions Workbench core (gap #3 跨端 Remote/Cloud Session 入口) — pure
 * aggregation / dedup / sort / filter / relative-time / action-derivation /
 * HTML rendering (escaping!) over the four session surfaces the panel joins:
 * `cc session list --json`, the shared IDE session index, the background-agent
 * supervisor state, and `cc remote-control status --json`. Headless (no
 * `vscode`); the webview glue lives in ui/sessions-view.js.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildWorkbenchArgs,
  toEpoch,
  formatRelativeTime,
  deriveActions,
  aggregateSessions,
  sortRows,
  filterRows,
  escapeHtml,
  renderWorkbenchHtml,
} from "../../../vscode-extension/src/sessions-workbench.js";

const NOW = Date.parse("2026-07-11T12:00:00Z");

describe("buildWorkbenchArgs", () => {
  it("returns the exact cc argv arrays the panel spawns", () => {
    expect(buildWorkbenchArgs()).toEqual({
      sessionList: ["session", "list", "--json", "-n", "100"],
      remoteControlStatus: ["remote-control", "status", "--json"],
    });
  });

  it("honours a custom session-list limit", () => {
    expect(buildWorkbenchArgs({ limit: 7 }).sessionList).toEqual([
      "session",
      "list",
      "--json",
      "-n",
      "7",
    ]);
  });
});

describe("toEpoch / formatRelativeTime", () => {
  it("accepts epoch numbers, numeric strings and ISO strings", () => {
    expect(toEpoch(NOW)).toBe(NOW);
    expect(toEpoch(String(NOW))).toBe(NOW);
    expect(toEpoch("2026-07-11T12:00:00Z")).toBe(NOW);
    expect(toEpoch(null)).toBeNull();
    expect(toEpoch("")).toBeNull();
    expect(toEpoch("not a date")).toBeNull();
  });

  it("buckets relative time", () => {
    expect(formatRelativeTime(NOW - 10 * 1000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 5 * 60 * 1000, NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 3 * 3600 * 1000, NOW)).toBe("3h ago");
    expect(formatRelativeTime(NOW - 2 * 24 * 3600 * 1000, NOW)).toBe("2d ago");
    // beyond ~30d falls back to the date
    expect(formatRelativeTime(NOW - 40 * 24 * 3600 * 1000, NOW)).toBe(
      "2026-06-01",
    );
    expect(formatRelativeTime(null, NOW)).toBe("");
  });
});

describe("aggregateSessions", () => {
  const chat = (over = {}) => ({
    id: "s-chat",
    title: "chat title",
    updatedAt: "2026-07-11T10:00:00Z",
    store: "chat",
    ...over,
  });
  const ide = (over = {}) => ({
    id: "s-chat",
    title: "ide title",
    workspace: "C:/repo",
    status: "running",
    updatedAt: "2026-07-11T11:00:00Z",
    ...over,
  });

  it("merges an IDE-index record into the matching chat row (no duplicate)", () => {
    const rows = aggregateSessions({
      chatSessions: [chat()],
      ideIndex: [ide()],
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe("s-chat");
    expect(row.kind).toBe("chat");
    expect(row.title).toBe("ide title");
    expect(row.workspace).toBe("C:/repo");
    expect(row.status).toBe("running");
    // lastActivity = the newer of the two timestamps
    expect(row.lastActivity).toBe(Date.parse("2026-07-11T11:00:00Z"));
  });

  it("keeps IDE-only sessions as kind ide", () => {
    const rows = aggregateSessions({
      ideIndex: [ide({ id: "s-ide-only", status: "stopped" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("ide");
    expect(rows[0].status).toBe("stopped");
  });

  it("waiting_approval status raises the waitingApproval flag", () => {
    const rows = aggregateSessions({
      ideIndex: [ide({ status: "waiting_approval" })],
    });
    expect(rows[0].waitingApproval).toBe(true);
  });

  it("background agent referencing sessionId X replaces the chat row (bg wins, carries sessionId)", () => {
    const rows = aggregateSessions({
      chatSessions: [chat()],
      ideIndex: [ide()],
      backgroundAgents: [
        {
          id: "bg-1",
          status: "running",
          title: "",
          cwd: "",
          sessionId: "s-chat",
          startedAt: NOW - 1000,
          interactive: true,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe("background");
    expect(row.id).toBe("bg-1");
    expect(row.sessionId).toBe("s-chat");
    // annotation carried over from the linked row
    expect(row.title).toBe("ide title");
    expect(row.workspace).toBe("C:/repo");
  });

  it("unlinked background agents are standalone rows", () => {
    const rows = aggregateSessions({
      backgroundAgents: [
        {
          id: "bg-2",
          status: "completed",
          title: "nightly sweep",
          cwd: "C:/repo",
          sessionId: "sess-9",
          endedAt: NOW - 5000,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("background");
    expect(rows[0].lastActivity).toBe(NOW - 5000);
  });

  it("maps remote-control states to remote rows and annotates the linked session", () => {
    const rows = aggregateSessions({
      chatSessions: [chat({ id: "sess-r" })],
      remoteControl: [
        {
          port: 4444,
          pid: 999,
          mode: "direct",
          agentSessionId: "sess-r",
          alive: true,
        },
        { port: 5555, alive: false },
        { invalid: true, stateFile: "/tmp/bad.json", alive: false },
      ],
    });
    const remote = rows.filter((r) => r.kind === "remote");
    expect(remote).toHaveLength(3);
    const alive = remote.find((r) => r.id === "remote:4444");
    expect(alive.status).toBe("running");
    expect(alive.port).toBe(4444);
    expect(alive.title).toContain(":4444");
    expect(remote.find((r) => r.id === "remote:5555").status).toBe("stale");
    expect(remote.find((r) => r.status === "invalid")).toBeTruthy();
    const session = rows.find((r) => r.id === "sess-r");
    expect(session.remoteControlled).toBe(true);
  });

  it("shapes empty / missing sources as an empty list (failure tolerance)", () => {
    expect(aggregateSessions({})).toEqual([]);
    expect(aggregateSessions()).toEqual([]);
    expect(
      aggregateSessions({
        chatSessions: [{ notAnId: true }, null],
        ideIndex: "garbage",
        backgroundAgents: null,
        remoteControl: [null, 42],
      }),
    ).toEqual([]);
  });
});

describe("sortRows", () => {
  it("orders waitingApproval → running → lastActivity desc", () => {
    const rows = sortRows([
      {
        id: "old",
        status: "stored",
        waitingApproval: false,
        lastActivity: 100,
      },
      {
        id: "new",
        status: "stored",
        waitingApproval: false,
        lastActivity: 900,
      },
      { id: "run", status: "running", waitingApproval: false, lastActivity: 1 },
      { id: "wait", status: "running", waitingApproval: true, lastActivity: 2 },
      {
        id: "none",
        status: "stopped",
        waitingApproval: false,
        lastActivity: null,
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual([
      "wait",
      "run",
      "new",
      "old",
      "none",
    ]);
  });
});

describe("filterRows", () => {
  const rows = [
    { id: "abc-123", title: "Fix Login Bug", workspace: "C:/repo/app" },
    { id: "def-456", title: "写文档", workspace: "D:/docs" },
  ];

  it("matches case-insensitively on title, workspace and id", () => {
    expect(filterRows(rows, "LOGIN")).toHaveLength(1);
    expect(filterRows(rows, "d:/docs")).toHaveLength(1);
    expect(filterRows(rows, "ABC-123")).toHaveLength(1);
    expect(filterRows(rows, "写文档")).toHaveLength(1);
    expect(filterRows(rows, "nomatch")).toHaveLength(0);
  });

  it("empty / whitespace query returns everything", () => {
    expect(filterRows(rows, "")).toHaveLength(2);
    expect(filterRows(rows, "   ")).toHaveLength(2);
    expect(filterRows(rows, undefined)).toHaveLength(2);
  });
});

describe("deriveActions", () => {
  it("chat and ide rows resume / rename / delete", () => {
    expect(deriveActions({ kind: "chat", status: "stored" })).toEqual([
      "resume",
      "rename",
      "delete",
    ]);
    expect(deriveActions({ kind: "ide", status: "running" })).toEqual([
      "resume",
      "rename",
      "delete",
    ]);
  });

  it("running interactive background agents attach + stop + rename", () => {
    expect(
      deriveActions({
        kind: "background",
        status: "running",
        interactive: true,
      }),
    ).toEqual(["attach", "stop", "rename"]);
    expect(
      deriveActions({
        kind: "background",
        status: "running",
        interactive: false,
      }),
    ).toEqual(["stop", "rename"]);
  });

  it("finished background agents with a sessionId can continue", () => {
    expect(
      deriveActions({
        kind: "background",
        status: "completed",
        sessionId: "x",
      }),
    ).toEqual(["continue", "rename"]);
    expect(
      deriveActions({ kind: "background", status: "lost", sessionId: null }),
    ).toEqual(["rename"]);
  });

  it("remote rows only stop while alive", () => {
    expect(deriveActions({ kind: "remote", status: "running" })).toEqual([
      "stop",
    ]);
    expect(deriveActions({ kind: "remote", status: "stale" })).toEqual([]);
    expect(deriveActions({ kind: "remote", status: "invalid" })).toEqual([]);
  });

  it("tolerates junk", () => {
    expect(deriveActions(null)).toEqual([]);
    expect(deriveActions({ kind: "??" })).toEqual([]);
  });
});

describe("renderWorkbenchHtml (escaping!)", () => {
  it("escapes hostile titles / workspaces / ids everywhere they appear", () => {
    const rows = aggregateSessions({
      chatSessions: [
        {
          id: 'x"onmouseover="alert(1)',
          title: "<img src=x onerror=alert(1)>",
          updatedAt: "2026-07-11T11:59:00Z",
        },
      ],
      ideIndex: [
        {
          id: 'x"onmouseover="alert(1)',
          title: "<img src=x onerror=alert(1)>",
          workspace: "C:/repo/<script>evil</script>",
          status: "waiting_approval",
          updatedAt: "2026-07-11T11:59:00Z",
        },
      ],
    });
    const html = renderWorkbenchHtml(rows, { now: NOW });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>evil");
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;onmouseover=&quot;");
    // structural bits still present
    expect(html).toContain('class="badge"'); // waiting approval badge
    expect(html).toContain("waiting approval");
    expect(html).toContain("1m ago");
  });

  it("renders per-source warning rows (a failing source never blanks the panel)", () => {
    const html = renderWorkbenchHtml([], {
      now: NOW,
      errors: [
        { source: "cc session list", message: "spawn <b>ENOENT</b>" },
        { source: "cc remote-control status", message: "timed out" },
      ],
    });
    expect(html).toContain("cc session list");
    expect(html).toContain("&lt;b&gt;ENOENT&lt;/b&gt;");
    expect(html).not.toContain("<b>ENOENT");
    expect(html).toContain("timed out");
    expect(html).toContain("No sessions found");
  });

  it("emits action buttons with the derived action ids as data attributes", () => {
    const rows = aggregateSessions({
      backgroundAgents: [
        {
          id: "bg-run",
          status: "running",
          interactive: true,
          title: "worker",
          startedAt: NOW - 1000,
        },
      ],
      remoteControl: [{ port: 4444, alive: true, mode: "direct" }],
    });
    const html = renderWorkbenchHtml(rows, { now: NOW });
    expect(html).toContain('data-act="attach" data-id="bg-run"');
    expect(html).toContain('data-act="stop" data-id="bg-run"');
    expect(html).toContain('data-act="rename" data-id="bg-run"');
    expect(html).toContain('data-act="stop" data-id="remote:4444"');
    expect(html).toContain('data-port="4444"');
    expect(html).toContain(">Attach</button>");
    expect(html).toContain(">Stop</button>");
  });

  it("escapeHtml covers the full special-character set", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("manifest wiring", () => {
  const ext = (rel) =>
    fileURLToPath(new URL("../../../vscode-extension/" + rel, import.meta.url));
  const pkg = JSON.parse(readFileSync(ext("package.json"), "utf-8"));

  it("declares the chainlesschain.sessions.workbench command with an nls title", () => {
    const cmd = (pkg.contributes?.commands || []).find(
      (c) => c.command === "chainlesschain.sessions.workbench",
    );
    expect(cmd).toBeTruthy();
    expect(cmd.title).toBe("%cmd.sessions.workbench.title%");
  });

  it("has the title key in both nls files", () => {
    const en = JSON.parse(readFileSync(ext("package.nls.json"), "utf-8"));
    const zh = JSON.parse(readFileSync(ext("package.nls.zh-cn.json"), "utf-8"));
    expect(en["cmd.sessions.workbench.title"]).toContain("Sessions Workbench");
    expect(zh["cmd.sessions.workbench.title"]).toContain("会话工作台");
  });

  it("extension.js registers the command", () => {
    const src = readFileSync(ext("src/extension.js"), "utf-8");
    expect(src).toContain('"chainlesschain.sessions.workbench"');
    expect(src).toContain("openSessionsWorkbench");
  });
});
