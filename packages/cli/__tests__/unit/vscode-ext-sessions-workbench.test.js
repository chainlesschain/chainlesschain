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
  WORKBENCH_SESSION_LIMIT,
  buildWorkbenchArgs,
  parseSessionProjection,
  canRunProjectionAction,
  previewProjectionAction,
  recheckProjectionAction,
  materializeActionPreview,
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
      sessionProjection: ["session", "projection", "--json", "-n", "256"],
    });
    expect(WORKBENCH_SESSION_LIMIT).toBeGreaterThanOrEqual(128);
  });

  it("honours a custom session-list limit", () => {
    expect(buildWorkbenchArgs({ limit: 7 }).sessionProjection).toEqual([
      "session",
      "projection",
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

  it("a blocked background agent (waiting_permission / pendingApprovals) raises waitingApproval", () => {
    const rows = aggregateSessions({
      backgroundAgents: [
        {
          id: "bg-blocked",
          status: "running",
          phase: "waiting_permission",
          startedAt: NOW - 1000,
        },
        {
          id: "bg-pending",
          status: "running",
          phase: "streaming",
          pendingApprovals: 2,
          startedAt: NOW - 2000,
        },
        {
          id: "bg-fine",
          status: "running",
          phase: "streaming",
          startedAt: NOW - 3000,
        },
        // an ended session never flags, whatever its last recorded phase
        {
          id: "bg-done",
          status: "completed",
          phase: "waiting_permission",
          endedAt: NOW - 4000,
        },
      ],
    });
    const flag = Object.fromEntries(rows.map((r) => [r.id, r.waitingApproval]));
    expect(flag).toEqual({
      "bg-blocked": true,
      "bg-pending": true,
      "bg-fine": false,
      "bg-done": false,
    });
    // and the sort puts the blocked ones first
    expect(rows[0].waitingApproval).toBe(true);
    expect(rows[1].waitingApproval).toBe(true);
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
  it("renders and locally filters a 128-session workbench", () => {
    const rows = Array.from({ length: 128 }, (_, index) => ({
      id: `session-${index}`,
      kind: "local",
      title: `Scale session ${index}`,
      workspace: `C:/workspace/${index}`,
      status: "working",
      lastActivity: NOW - index,
      actions: ["dispatch"],
    }));

    expect(filterRows(rows, "scale session 127")).toHaveLength(1);
    const html = renderWorkbenchHtml(rows, { now: NOW });
    expect(html.match(/<tr data-session-row>/gu)).toHaveLength(128);
    expect(html).toContain('aria-rowcount="128"');
    expect(html).toContain("Sessions (128)");
  });

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
    expect(html).toContain('aria-label="Attach worker"');
  });

  it("escapeHtml covers the full special-character set", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("canonical CLI projection parity and fail-closed dispatch", () => {
  const fixturePath = fileURLToPath(
    new URL("../fixtures/session-projection-v1.json", import.meta.url),
  );
  const fixtureText = readFileSync(fixturePath, "utf8");

  function v2Fixture() {
    const root = JSON.parse(fixtureText);
    root.schema = "chainlesschain.session-projection/v2";
    root.schemaVersion = 2;
    root.revision = `sha256:${"9".repeat(64)}`;
    root.sources.dynamicWorkflow = { ok: true, count: 1, error: null };
    for (const item of root.sessions) {
      item.workflow = null;
      for (const id of ["pause", "resume", "recover"]) {
        item.actions.push({
          id,
          available: false,
          reason: "unsupported for this row",
          preview: null,
        });
      }
    }
    const actions = [
      "dispatch",
      "peek",
      "reply",
      "attach",
      "detach",
      "stop",
      "checkpoint",
      "archive",
      "pause",
      "resume",
      "recover",
    ].map((id) => ({
      id,
      available: ["peek", "stop", "resume", "recover"].includes(id),
      reason: ["peek", "stop", "resume", "recover"].includes(id)
        ? null
        : "unsupported for this row",
      preview: ["peek", "stop", "resume", "recover"].includes(id)
        ? {
            executor: "cli",
            argv:
              id === "peek"
                ? [
                    "cowork",
                    "workflow",
                    "runtime-status",
                    "wf-run",
                    "--cwd",
                    "C:/repo",
                    "--json",
                  ]
                : [
                    "cowork",
                    "workflow",
                    `runtime-${id === "recover" ? "recover-checkpoints" : id}`,
                    "wf-run",
                    "--expected-revision",
                    "7",
                    "--cwd",
                    "C:/repo",
                    "--json",
                  ],
            mutates: id !== "peek",
            input: null,
          }
        : null,
    }));
    root.sessions.unshift({
      id: "dynamic_workflow:wf-run",
      sourceId: "wf-run",
      kind: "dynamic_workflow",
      state: "blocked",
      title: "Dynamic workflow release-review",
      capabilities: ["peek", "stop", "resume", "recover"],
      actions,
      linkedSessionId: "authority-session",
      owner: { type: "local-user", id: null },
      environment: { cwd: "C:/repo", host: null, port: null, mode: null },
      worktree: null,
      artifact: { count: 1, latest: null },
      approval: { pending: true, type: "recovery", count: 1 },
      pr: { count: 0, latest: null },
      workflow: {
        runtimeRevision: 7,
        phase: { status: "paused", transition: "run-paused" },
        agents: { requested: 2, settled: 2, pending: 0 },
        budget: { overall: "within" },
        recovery: { terminal: 1 },
        recoveryPolicy: {
          risk: "terminal_checkpoint_recovery",
          severity: "warning",
          recommendedAction: "recover",
          notification: {
            key: `sha256:${"7".repeat(64)}`,
            backoffMs: [15000, 60000, 300000, 900000],
          },
        },
        recent: { call: { name: "read_file", status: "completed" } },
      },
      lastEvent: { type: "state:blocked", at: "2026-08-01T00:10:00Z" },
      revision: `sha256:${"8".repeat(64)}`,
    });
    return root;
  }

  it("consumes the shared five-kind fixture without IDE-side joins", () => {
    const snapshot = parseSessionProjection(fixtureText);
    expect(snapshot.connected).toBe(true);
    expect(snapshot.revision).toBe(
      "sha256:a8e6e8f46d7d4467d994a5e67b97cfb49955446f74453e719ba510cbb573b4e5",
    );
    expect(snapshot.rows.map((row) => row.kind)).toEqual([
      "workflow",
      "background",
      "team",
      "remote",
      "local",
    ]);
    expect(snapshot.rows[1].actions).toEqual([
      "peek",
      "reply",
      "attach",
      "stop",
    ]);
    expect(snapshot.rows[4].actions).toEqual(["dispatch", "peek"]);
    expect(snapshot.rows[1].sourceId).toBe("bg-fixture");
    expect(snapshot.rows[3].port).toBe(18800);
    expect(snapshot.rows[2].actions).toEqual([]);
  });

  it("renders and revision-gates the v2 dynamic workflow controls", () => {
    const snapshot = parseSessionProjection(v2Fixture());
    expect(snapshot.connected).toBe(true);
    const row = snapshot.rows.find((item) => item.sourceId === "wf-run");
    expect(row.actions).toEqual(["peek", "stop", "resume", "recover"]);
    expect(row.workflow).toMatchObject({
      runtimeRevision: 7,
      phase: { status: "paused" },
      budget: { overall: "within" },
    });
    expect(
      previewProjectionAction(snapshot, {
        id: row.id,
        action: "resume",
        revision: snapshot.revision,
        itemRevision: row.revision,
      }),
    ).toMatchObject({
      ok: true,
      preview: {
        argv: expect.arrayContaining(["runtime-resume", "7", "C:/repo"]),
        mutates: true,
      },
    });
    const html = renderWorkbenchHtml([row], { now: NOW });
    expect(html).toContain("phase paused");
    expect(html).toContain("agents 2/2");
    expect(html).toContain("budget within");
    expect(html).toContain("recent tool read_file:completed");
    expect(html).toContain("recoverable checkpoints 1");
    expect(html).toContain(
      "recovery warning:terminal_checkpoint_recovery → recover",
    );
  });

  it("clears every row/action on disconnect, malformed data or stale revision", () => {
    const disconnected = JSON.parse(fixtureText);
    disconnected.connected = false;
    disconnected.reason = "socket closed";
    expect(parseSessionProjection(disconnected)).toMatchObject({
      connected: false,
      rows: [],
      error: "socket closed",
    });
    expect(parseSessionProjection("not-json")).toMatchObject({
      connected: false,
      rows: [],
    });
    expect(
      parseSessionProjection(fixtureText, {
        expectedRevision: "sha256:older",
      }),
    ).toMatchObject({ connected: false, stale: true, rows: [] });
  });

  it("requires the current projection revision and advertised action", () => {
    const snapshot = parseSessionProjection(fixtureText);
    expect(
      canRunProjectionAction(snapshot, {
        id: "background:bg-fixture",
        action: "reply",
        revision: snapshot.revision,
      }),
    ).toBe(true);
    expect(
      canRunProjectionAction(snapshot, {
        id: "background:bg-fixture",
        action: "checkpoint",
        revision: snapshot.revision,
      }),
    ).toBe(false);
    expect(
      canRunProjectionAction(snapshot, {
        id: "background:bg-fixture",
        action: "stop",
        revision: "sha256:stale",
      }),
    ).toBe(false);
    expect(
      canRunProjectionAction(
        { ...snapshot, connected: false },
        {
          id: "background:bg-fixture",
          action: "stop",
          revision: snapshot.revision,
        },
      ),
    ).toBe(false);
  });

  it("uses only CLI-authored local/background/remote routes and rejects stale targets", () => {
    const snapshot = parseSessionProjection(fixtureText);
    const local = snapshot.rows.find((row) => row.kind === "local");
    const background = snapshot.rows.find((row) => row.kind === "background");
    const remote = snapshot.rows.find((row) => row.kind === "remote");
    const localRequest = {
      id: local.id,
      action: "dispatch",
      revision: snapshot.revision,
      itemRevision: local.revision,
    };

    expect(previewProjectionAction(snapshot, localRequest)).toMatchObject({
      ok: true,
      preview: {
        executor: "host",
        argv: ["session", "resume", "local-fixture"],
      },
    });
    expect(
      previewProjectionAction(snapshot, {
        id: background.id,
        action: "reply",
        revision: snapshot.revision,
        itemRevision: background.revision,
      }).preview,
    ).toEqual({
      executor: "cli",
      argv: ["daemon", "reply", "bg-fixture", "$prompt", "--json"],
      mutates: true,
      input: "prompt",
    });
    expect(
      previewProjectionAction(snapshot, {
        id: background.id,
        action: "stop",
        revision: snapshot.revision,
        itemRevision: background.revision,
      }).preview.argv,
    ).toEqual(["daemon", "stop", "bg-fixture", "--json"]);
    expect(
      previewProjectionAction(snapshot, {
        id: remote.id,
        action: "stop",
        revision: snapshot.revision,
        itemRevision: remote.revision,
      }).preview.argv,
    ).toEqual(["remote-control", "stop", "--port", "18800", "--json"]);

    const changed = parseSessionProjection(fixtureText);
    changed.rows = changed.rows.map((row) =>
      row.id === local.id ? { ...row, revision: "sha256:changed" } : row,
    );
    expect(
      recheckProjectionAction(snapshot, changed, localRequest),
    ).toMatchObject({ ok: false, code: "SESSION_PROJECTION_STALE" });
    expect(
      recheckProjectionAction(
        snapshot,
        { ...changed, connected: false },
        localRequest,
      ),
    ).toMatchObject({
      ok: false,
      code: "SESSION_PROJECTION_DISCONNECTED",
    });
    expect(
      materializeActionPreview(
        {
          executor: "cli",
          argv: ["daemon", "resume", "done", "$prompt", "--json"],
          mutates: true,
          input: "prompt",
        },
        { prompt: "continue safely" },
      ).argv,
    ).toEqual(["daemon", "resume", "done", "continue safely", "--json"]);
  });

  it("binds canonical source ids and envelope revisions into action buttons", () => {
    const snapshot = parseSessionProjection(fixtureText);
    const html = renderWorkbenchHtml(snapshot.rows, { now: NOW });
    expect(html).toContain('data-source-id="bg-fixture"');
    expect(html).toContain(`data-revision="${snapshot.revision}"`);
    expect(html).toContain('data-act="reply"');
    expect(html).toContain('data-act="checkpoint"');
    expect(html).toContain("owner local-user:alice");
    expect(html).toContain("artifacts 1 · report.md");
    expect(html).toContain("PR #42 open");
    expect(html).not.toContain('data-act="detach"');
    expect(html).not.toContain('data-act="archive"');
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
    expect(src).toContain("sessionsView.isSessionsWorkbenchOpen()");
  });
});
