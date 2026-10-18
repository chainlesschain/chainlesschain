"use strict";
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { createBoardTaskUpdateHost } = require("../board-task-update-host");
const [file, stage, recordFile, kind] = process.argv.slice(2);
const native =
  process.env.CC_BOARD_TEST_SQLITE === "better-sqlite3"
    ? new (require("better-sqlite3"))(file)
    : new DatabaseSync(file);
native.exec(
  "PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL",
);
function kill() {
  fs.writeFileSync(file + ".stage", stage);
  process.kill(process.pid, "SIGKILL");
}
const db = {
  get inTransaction() {
    return native.isTransaction ?? native.inTransaction;
  },
  exec: (sql) => native.exec(sql),
  prepare(sql) {
    const statement = native.prepare(sql);
    return {
      get: (...a) => statement.get(...a),
      all: (...a) => statement.all(...a),
      run(...a) {
        const r = statement.run(...a);
        if (
          stage === "before-success-commit" &&
          sql.startsWith("UPDATE task_board_update_runs SET") &&
          a[0] === "succeeded"
        )
          kill();
        return r;
      },
    };
  },
  transaction(fn) {
    const run = () => {
      native.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        native.exec("COMMIT");
        return result;
      } catch (error) {
        native.exec("ROLLBACK");
        throw error;
      }
    };
    run.immediate = run;
    return run;
  },
};
const event = {
    sender: { isDestroyed: () => false },
    senderFrame: { url: "file:///app/index.html" },
  },
  window = { isDestroyed: () => false };
let confirmations = 0;
const host = createBoardTaskUpdateHost({
  database: { getDatabase: () => db },
  getActor: () => "did:owner",
  getGeneration: () => 1,
  validateSender: () => ({ trusted: true }),
  electron: {
    BrowserWindow: { fromWebContents: () => window },
    dialog: {
      showMessageBox: async () => {
        confirmations++;
        if (stage === "running") kill();
        return { response: 1 };
      },
    },
  },
});
async function main() {
  if (stage === "recover") {
    const prepared = JSON.parse(fs.readFileSync(recordFile, "utf8"));
    const result = await host.executeBoardUpdate(event, {
      request: prepared.request,
    });
    process.stdout.write(JSON.stringify({ result, confirmations }));
    native.close();
    return;
  }
  const prepared = host.previewBoardUpdate(event, {
    taskId: "task-1",
    updates:
      kind === "move"
        ? { columnId: "done-1", position: 42 }
        : {
            title: "Crash verified title",
            priority: "critical",
            assigneeDid: "did:member",
            dueDate: 1792281600123,
            estimatedHours: 1.25,
            actualHours: 0,
          },
    idempotencyKey: require("node:crypto").randomUUID(),
  });
  if (!prepared.success) throw new Error(JSON.stringify(prepared));
  fs.writeFileSync(recordFile, JSON.stringify(prepared));
  if (stage === "queued") kill();
  const result = await host.executeBoardUpdate(event, {
    request: prepared.request,
  });
  if (result.run?.status !== "succeeded")
    throw new Error(JSON.stringify(result));
  kill();
}
main().catch((error) => {
  process.stderr.write(error.stack);
  process.exitCode = 1;
});
