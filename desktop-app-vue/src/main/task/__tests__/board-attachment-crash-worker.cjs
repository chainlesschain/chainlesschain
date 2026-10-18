"use strict";
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { mutateBoardAttachment } = require("../board-attachment-host");
const [file, selected, action, stage, id] = process.argv.slice(2);
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
    const s = native.prepare(sql);
    return {
      all: (...a) => s.all(...a),
      get: (...a) => s.get(...a),
      run(...a) {
        const r = s.run(...a);
        if (
          stage === "before-commit" &&
          /INSERT INTO task_activity_log/.test(sql)
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
        const r = fn();
        native.exec("COMMIT");
        return r;
      } catch (e) {
        native.exec("ROLLBACK");
        throw e;
      }
    };
    run.immediate = run;
    return run;
  },
};
const window = { isDestroyed: () => false };
mutateBoardAttachment(
  { getDatabase: () => db },
  {
    sender: { isDestroyed: () => false },
    senderFrame: { url: "file:///app/index.html" },
  },
  action,
  action === "upload-attachment" ? { taskId: "task-1" } : { attachmentId: id },
  {
    getActor: () => "did:owner",
    getGeneration: () => 1,
    validateSender: () => ({ trusted: true }),
    electron: {
      BrowserWindow: { fromWebContents: () => window },
      dialog: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [selected],
        }),
      },
    },
  },
)
  .then(() => kill())
  .catch((error) => {
    process.stderr.write(error.stack);
    process.exitCode = 1;
  });
