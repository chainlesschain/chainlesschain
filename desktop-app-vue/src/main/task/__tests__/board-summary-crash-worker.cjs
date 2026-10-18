"use strict";
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { generateAISummary } = require("../board-report-summary-host");
const [file, requestId, stage] = process.argv.slice(2);
const native =
  process.env.CC_BOARD_TEST_SQLITE === "better-sqlite3"
    ? new (require("better-sqlite3"))(file)
    : new DatabaseSync(file);
native.exec(
  "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL",
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
        const result = statement.run(...a);
        if (
          stage === "before-success-commit" &&
          sql.includes("SET status='succeeded'")
        )
          kill();
        return result;
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
const window = { isDestroyed: () => false },
  manager = {};
generateAISummary(
  { getDatabase: () => db },
  {
    sender: { isDestroyed: () => false },
    senderFrame: { url: "file:///app/index.html" },
  },
  { reportId: "report-1", requestId },
  {
    getActor: () => "did:owner",
    getGeneration: () => 1,
    validateSender: () => ({ trusted: true }),
    getManager: () => manager,
    electron: {
      BrowserWindow: { fromWebContents: () => window },
      dialog: {
        showMessageBox: async () => {
          if (stage === "prepared") kill();
          return { response: 0 };
        },
      },
    },
    captureModel: () => ({
      provider: "ollama",
      model: "test:latest",
      endpoint: "http://127.0.0.1:11434",
      check() {},
      async run(messages, options) {
        options.checkAuthority();
        options.beforeDispatch({
          runId: "crash-model-" + requestId,
          tenantId: "test-tenant",
        });
        if (stage === "dispatched") kill();
        return { summary: "Crash-verified summary", usage: null };
      },
    }),
  },
)
  .then((result) => {
    if (!result.success) throw new Error(JSON.stringify(result));
    kill();
  })
  .catch((error) => {
    process.stderr.write(error.stack);
    process.exitCode = 1;
  });
