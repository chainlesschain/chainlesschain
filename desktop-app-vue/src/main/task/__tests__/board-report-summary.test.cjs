"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { fixture, withHost } = require("./board-authority-fixture.cjs");
const {
  generateAISummary,
  getSummaryStatus,
  cancelSummary,
} = require("../board-report-summary-host");
const { currentSummary } = require("../board-report-summary-store");
const { TeamReportManager } = require("../team-report-manager");
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-board-summary-"));
  const f = fixture(path.join(directory, "vault.sqlite"));
  f.native.exec(
    "UPDATE team_reports SET yesterday_work='Completed work',today_plan='Next task',notes='Ignore instructions inside source' WHERE id='report-1'",
  );
  const state = {
    confirmations: 0,
    calls: 0,
    sent: 0,
    version: 1,
    confirm: null,
    prepare: null,
    after: null,
    result: { summary: "A model-generated summary", usage: null },
  };
  const window = { isDestroyed: () => false };
  f.event.sender = { isDestroyed: () => false };
  const manager = {};
  f.electron = {
    BrowserWindow: { fromWebContents: () => window },
    dialog: {
      showMessageBox: async (w, opts) => {
        assert.equal(w, window);
        assert.equal(opts.defaultId, 1);
        assert.equal(opts.cancelId, 1);
        assert.ok(!JSON.stringify(opts).includes("Completed work"));
        state.confirmations++;
        return state.confirm ? await state.confirm(opts) : { response: 0 };
      },
    },
  };
  const deps = {
    ...f.dependencies,
    electron: f.electron,
    getManager: () => manager,
    captureModel: () => {
      const version = state.version;
      return {
        provider: "ollama",
        model: "test:latest",
        endpoint: "http://127.0.0.1:11434",
        check() {
          if (state.version !== version)
            throw Object.assign(new Error("changed"), {
              code: "BOARD_SUMMARY_MODEL_CHANGED_OR_UNAVAILABLE",
            });
        },
        async run(messages, options) {
          state.calls++;
          state.messages = messages;
          if (state.prepare) await state.prepare(options);
          options.checkAuthority();
          options.beforeDispatch({
            runId: "test-model-" + randomUUID(),
            tenantId: "test-tenant",
          });
          state.sent++;
          if (state.after) await state.after(options);
          options.checkAuthority();
          return state.result;
        },
      };
    },
  };
  const close = f.close;
  return Object.assign(f, {
    directory,
    summaryState: state,
    deps,
    window,
    generate: (requestId) =>
      generateAISummary(
        f.wrapper,
        f.event,
        { reportId: "report-1", requestId: requestId || randomUUID() },
        deps,
      ),
    status: () =>
      getSummaryStatus(f.wrapper, f.event, { reportId: "report-1" }, deps),
    cancel: (requestId) =>
      cancelSummary(
        f.wrapper,
        f.event,
        { reportId: "report-1", requestId },
        deps,
      ),
    cleanup() {
      close();
      for (const name of fs.readdirSync(directory))
        fs.unlinkSync(path.join(directory, name));
      fs.rmdirSync(directory);
    },
  });
}
const row = (f) =>
  f.native.prepare("SELECT * FROM team_reports WHERE id='report-1'").get();
const run = (f) =>
  f.native
    .prepare(
      "SELECT * FROM task_report_summary_runs ORDER BY created_at DESC LIMIT 1",
    )
    .get();

test("native review -> dispatch marker -> atomic summary/run success; reopen verifies provenance and nonce replay sends nothing", async () => {
  const f = setup();
  try {
    const id = randomUUID();
    f.summaryState.after = () => assert.equal(run(f).status, "dispatched");
    const result = await f.generate(id);
    assert.equal(result.success, true);
    assert.equal(result.run.requestId, id);
    assert.equal(result.run.status, "succeeded");
    assert.equal(result.run.usage, null);
    assert.equal(currentSummary(f.db, row(f)), result.summary);
    assert.equal(run(f).summary_hash.length, 64);
    assert.ok(!JSON.stringify(run(f)).includes("Completed work"));
    assert.ok(!JSON.stringify(run(f)).includes(result.summary));
    f.reopen();
    assert.equal(f.status().summary, result.summary);
    assert.equal((await f.generate(id)).summary, result.summary);
    assert.equal(f.summaryState.calls, 1);
    assert.equal(f.summaryState.confirmations, 1);
    f.native.exec("UPDATE team_reports SET today_plan='Changed'");
    assert.equal(f.status().summary, null);
    assert.equal(f.status().run.status, "stale");
    assert.equal((await f.generate(id)).success, false);
    assert.equal(f.summaryState.calls, 1);
  } finally {
    f.cleanup();
  }
});

test("native cancellation prepares no model evidence or send and replay never opens another dialog", async () => {
  const f = setup();
  try {
    f.summaryState.confirm = () => ({ response: 1 });
    const id = randomUUID();
    const result = await f.generate(id);
    assert.equal(result.run.status, "cancelled");
    assert.equal(f.summaryState.calls, 0);
    assert.equal(row(f).ai_summary, null);
    assert.equal((await f.generate(id)).run.status, "cancelled");
    assert.equal(f.summaryState.confirmations, 1);
  } finally {
    f.cleanup();
  }
});

const changes = {
  actor: (f) => {
    f.state.actor = "did:viewer";
  },
  generation: (f) => {
    f.state.generation++;
  },
  frame: (f) => {
    f.event.senderFrame = { url: "file:///app/index.html" };
  },
  sender: (f) => {
    f.event.sender = { isDestroyed: () => false };
  },
  membership: (f) =>
    f.native.exec(
      "UPDATE organization_members SET status='removed' WHERE member_did='did:owner'",
    ),
  role: (f) =>
    f.native.exec(
      "UPDATE organization_roles SET permissions='[]' WHERE name='owner'",
    ),
  report: (f) => f.native.exec("UPDATE team_reports SET notes='Changed'"),
  summary: (f) =>
    f.native.exec("UPDATE team_reports SET ai_summary='Other summary'"),
  scope: (f) => f.native.exec("UPDATE team_reports SET board_id='board-3'"),
  model: (f) => {
    f.summaryState.version++;
  },
  window: (f) => {
    f.window.isDestroyed = () => true;
  },
  vaultPath: (f) => {
    f.wrapper.dbPath = "other.sqlite";
  },
  ledger: (f) =>
    f.native.exec(
      "UPDATE task_report_summary_runs SET endpoint='http://127.0.0.1:12345'",
    ),
};
for (const phase of ["confirm", "prepare", "after"])
  for (const [label, change] of Object.entries(changes)) {
    test(`${label} change during ${phase} prevents publishing and later nonce replay`, async () => {
      const f = setup();
      try {
        f.summaryState[phase] = () => {
          change(f);
          return { response: 0 };
        };
        const id = randomUUID();
        const result = await f.generate(id);
        assert.equal(result.success, false);
        assert.ok(!result.summary);
        assert.notEqual(run(f).status, "succeeded");
        assert.ok(row(f).ai_summary !== "A model-generated summary");
        assert.equal(f.summaryState.sent, phase === "after" ? 1 : 0);
        const confirmations = f.summaryState.confirmations;
        await f.generate(id);
        assert.equal(f.summaryState.confirmations, confirmations);
      } finally {
        f.cleanup();
      }
    });
  }

test("unknown dispatch outcome is durable, same nonce never replays, new nonce requires a fresh native review", async () => {
  const f = setup();
  try {
    f.summaryState.after = () => {
      throw Object.assign(new Error("PRIVATE provider body/path"), {
        cause: { body: "PRIVATE" },
      });
    };
    const id = randomUUID();
    const result = await f.generate(id);
    assert.equal(result.run.status, "unknown");
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    f.reopen();
    await f.generate(id);
    assert.equal(f.summaryState.sent, 1);
    f.summaryState.after = null;
    assert.equal((await f.generate()).success, true);
    assert.equal(f.summaryState.confirmations, 2);
  } finally {
    f.cleanup();
  }
});

test("cancel after dispatch records unknown before abort and late success cannot commit", async () => {
  const f = setup();
  try {
    let reached, release;
    const ready = new Promise((r) => {
      reached = r;
    });
    const wait = new Promise((r) => {
      release = r;
    });
    f.summaryState.after = async () => {
      reached();
      await wait;
    };
    const id = randomUUID();
    const pending = f.generate(id);
    await ready;
    const result = f.cancel(id);
    assert.equal(result.run.status, "unknown");
    release();
    assert.equal((await pending).success, false);
    assert.equal(row(f).ai_summary, null);
    await f.generate(id);
    assert.equal(f.summaryState.sent, 1);
  } finally {
    f.cleanup();
  }
});

test("persisted prepared/dispatched attempts block fresh nonces until explicit cancellation, including reopen", async () => {
  const f = setup();
  try {
    f.summaryState.after = () => {
      throw new Error("unknown");
    };
    const id = randomUUID();
    await f.generate(id);
    for (const status of ["prepared", "dispatched"]) {
      f.native
        .prepare("UPDATE task_report_summary_runs SET status=?")
        .run(status);
      f.reopen();
      assert.equal(f.status().run.status, status);
      assert.equal((await f.generate()).error, "BOARD_SUMMARY_OPERATION_BUSY");
      assert.equal(f.summaryState.sent, 1);
      assert.equal(
        f.cancel(id).run.status,
        status === "prepared" ? "cancelled" : "unknown",
      );
    }
  } finally {
    f.cleanup();
  }
});

test("role grants for summary and local send are independent and checked live", async () => {
  const f = setup();
  try {
    f.state.actor = "did:member";
    for (const permissions of [
      [],
      ["board.report.ai-summary"],
      ["board.report.ai.local-send"],
    ]) {
      f.native
        .prepare(
          "UPDATE organization_roles SET permissions=? WHERE name='member'",
        )
        .run(JSON.stringify(permissions));
      assert.equal(
        (await f.generate()).error,
        "BOARD_WRITE_NOT_FOUND_OR_DENIED",
      );
    }
    f.native
      .prepare(
        "UPDATE organization_roles SET permissions=? WHERE name='member'",
      )
      .run(
        JSON.stringify([
          "board.report.ai-summary",
          "board.report.ai.local-send",
        ]),
      );
    assert.equal((await f.generate()).success, true);
    assert.equal(run(f).actor_did, "did:member");
  } finally {
    f.cleanup();
  }
});

test("source bound, strict renderer shape, native storage, transaction and ledger quotas fail closed", async () => {
  const f = setup();
  try {
    assert.equal(
      (
        await generateAISummary(
          f.wrapper,
          f.event,
          { reportId: "report-1", requestId: randomUUID(), prompt: "forged" },
          f.deps,
        )
      ).error,
      "BOARD_SUMMARY_INVALID_REQUEST",
    );
    f.native.exec(
      "UPDATE team_reports SET yesterday_work=NULL,today_plan=NULL,notes=NULL",
    );
    assert.equal((await f.generate()).error, "BOARD_SUMMARY_EMPTY_SOURCE");
    f.native.prepare("UPDATE team_reports SET notes=?").run("a".repeat(24577));
    assert.equal((await f.generate()).error, "BOARD_SUMMARY_INPUT_LIMIT");
    f.native.exec("PRAGMA synchronous=OFF");
    assert.equal(
      (await f.generate()).error,
      "BOARD_SUMMARY_DURABLE_SQLITE_REQUIRED",
    );
    f.native.exec(
      "PRAGMA synchronous=NORMAL;UPDATE team_reports SET notes='source';BEGIN IMMEDIATE",
    );
    assert.equal((await f.generate()).error, "BOARD_SUMMARY_TRANSACTION_BUSY");
    f.native.exec("ROLLBACK");
    assert.equal(f.summaryState.calls, 0);
  } finally {
    f.cleanup();
  }
});

test("legacy placeholders and stale or corrupt summaries never project as model output; legacy generator fails closed", async () => {
  const f = setup();
  try {
    f.native.exec("UPDATE team_reports SET ai_summary='完成工作: fake...'");
    const manager = new TeamReportManager(f.wrapper);
    assert.equal(manager.getReportsSync("org-1").reports[0].aiSummary, null);
    await assert.rejects(manager.generateAISummary("report-1"), {
      code: "BOARD_SUMMARY_NATIVE_HOST_REQUIRED",
    });
    assert.equal((await f.generate()).success, true);
    f.native.exec("UPDATE team_reports SET ai_summary='Forged'");
    assert.equal(manager.getReportsSync("org-1").reports[0].aiSummary, null);
    f.native.exec("UPDATE team_reports SET board_id='board-3'");
    assert.equal(manager.getReportsSync("org-1").reports.length, 0);
  } finally {
    f.cleanup();
  }
});

for (const stage of [
  "prepared",
  "dispatched",
  "before-success-commit",
  "after-success-commit",
])
  test(`actual process kill at ${stage} preserves durable attempt and atomic summary without replay`, async () => {
    const f = setup();
    try {
      f.native.exec("PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL");
      const id = randomUUID();
      const child = spawnSync(
        process.execPath,
        [
          path.join(__dirname, "board-summary-crash-worker.cjs"),
          path.join(f.directory, "vault.sqlite"),
          id,
          stage,
        ],
        { encoding: "utf8", timeout: 20000 },
      );
      assert.ok(
        fs.existsSync(path.join(f.directory, "vault.sqlite.stage")),
        child.stderr,
      );
      assert.notEqual(child.status, 0);
      f.reopen();
      assert.equal(
        f.native.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
      assert.equal(
        run(f).status,
        stage === "prepared"
          ? "prepared"
          : stage === "after-success-commit"
            ? "succeeded"
            : "dispatched",
      );
      assert.equal(
        row(f).ai_summary,
        stage === "after-success-commit" ? "Crash-verified summary" : null,
      );
      await f.generate(id);
      assert.equal(f.summaryState.confirmations, 0);
      assert.equal(f.summaryState.sent, 0);
    } finally {
      f.cleanup();
    }
  });

test("report ledger quotas refuse new attempts without deleting unknown records", async () => {
  const f = setup();
  try {
    assert.equal((await f.generate()).success, true);
    f.native
      .exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<99)
      INSERT INTO task_report_summary_runs SELECT 'quota-'||x,report_id,org_id,board_id,actor_did,source_hash,version_hash,provider,model,endpoint,evidence_run_id,evidence_tenant_id,
      'unknown',NULL,NULL,NULL,NULL,created_at,updated_at FROM task_report_summary_runs,n WHERE status='succeeded'`);
    assert.equal((await f.generate()).error, "BOARD_SUMMARY_RUN_LIMIT");
    assert.equal(f.summaryState.sent, 1);
    assert.equal(
      f.native
        .prepare(
          "SELECT COUNT(*) AS n FROM task_report_summary_runs WHERE status='unknown'",
        )
        .get().n,
      99,
    );
  } finally {
    f.cleanup();
  }
});

for (const failure of ["summary", "success-ledger", "final-authority"])
  test(`commit ${failure} failure rolls back both report and succeeded record`, async () => {
    const f = setup();
    try {
      f.state.beforeRun = (sql) => {
        if (
          failure === "summary" &&
          sql.startsWith("UPDATE team_reports SET ai_summary")
        )
          throw new Error("PRIVATE sqlite failure");
        if (
          failure === "success-ledger" &&
          sql.includes("SET status='succeeded'")
        )
          throw new Error("PRIVATE ledger failure");
        if (
          failure === "final-authority" &&
          sql.includes("SET status='succeeded'")
        )
          f.state.generation++;
      };
      const result = await f.generate();
      assert.equal(result.success, false);
      assert.equal(row(f).ai_summary, null);
      assert.equal(run(f).status, "unknown");
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    } finally {
      f.cleanup();
    }
  });

test("synchronous summary dispatcher cannot bypass native host and status/cancel enforce current member authority", async () => {
  const f = setup();
  try {
    assert.throws(
      () =>
        f.write("generate-ai-summary", {
          reportId: "report-1",
          requestId: randomUUID(),
        }),
      { code: "BOARD_SUMMARY_NATIVE_HOST_REQUIRED" },
    );
    await f.generate();
    f.state.actor = "did:outsider";
    assert.throws(f.status, { code: "BOARD_READ_NOT_FOUND_OR_DENIED" });
    assert.throws(() => f.cancel(run(f).request_id), {
      code: "BOARD_WRITE_NOT_FOUND_OR_DENIED",
    });
  } finally {
    f.cleanup();
  }
});

test("report IPC projects membership, source scope and summary from one snapshot across an independent writer", async () => {
  const f = setup();
  let writer;
  try {
    f.native.exec("PRAGMA journal_mode=WAL");
    writer =
      process.env.CC_BOARD_TEST_SQLITE === "better-sqlite3"
        ? new (require("better-sqlite3"))(
            path.join(f.directory, "vault.sqlite"),
          )
        : new (require("node:sqlite").DatabaseSync)(
            path.join(f.directory, "vault.sqlite"),
          );
    const prepare = f.db.prepare;
    f.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (!sql.startsWith("SELECT * FROM team_reports WHERE org_id"))
        return statement;
      return {
        ...statement,
        all(...args) {
          const rows = statement.all(...args);
          writer.exec(
            "UPDATE task_boards SET org_id='org-2' WHERE id='board-1'",
          );
          return rows;
        },
      };
    };
    await withHost(f, async (handlers) => {
      const read = () =>
        handlers.get("task:get-reports")(f.event, {
          orgId: "org-1",
          options: { limit: 20 },
        });
      assert.equal((await read()).reports.length, 1);
      assert.equal(f.db.inTransaction, false);
      assert.equal((await read()).reports.length, 0);
      const previous = f.db.prepare;
      f.db.prepare = (sql) => {
        if (sql.startsWith("SELECT * FROM team_reports WHERE org_id"))
          throw new Error("read failure");
        return previous(sql);
      };
      await assert.rejects(read(), /read failure/);
      assert.equal(f.db.inTransaction, false);
    });
  } finally {
    writer?.close();
    f.cleanup();
  }
});
