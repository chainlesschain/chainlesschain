import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  freezeGoalForProject,
  restoreTransferredGoal,
} from "../../src/lib/goal-store.js";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const {
  ProjectGoalTransferService,
} = require("@chainlesschain/session-core/project-goal-transfer");
const [root, mode, id] = process.argv.slice(2);
const target = JSON.parse(
  fs.readFileSync(path.join(root, "target.json"), "utf8"),
);
const output = path.join(root, "transfer.json"),
  marker = path.join(root, `${id}.json.transfer`);
function barrier(value) {
  fs.writeFileSync(
    path.join(root, `barrier-${process.pid}`),
    JSON.stringify(value),
  );
  // Synchronous injection in the actual fs/native operation: parent verifies
  // authoritative state through another handle before forcibly terminating us.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
try {
  if (mode === "freeze-journal") {
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (to === marker) barrier({ phase: "frozen-journal" });
    };
    freezeGoalForProject(id, { target, output, expectedRevision: 1 }, { root });
  } else {
    const db = new Database(path.join(root, "project.db"));
    const native = new ProjectGoalTransferService({
      db,
      getActor: () => "did:chainless:owner",
    });
    const packet = JSON.parse(fs.readFileSync(output, "utf8"));
    if (mode === "import" || mode === "import-once") {
      const result = native.importTransfer(packet);
      if (mode === "import-once") {
        db.close();
        process.stdout.write(JSON.stringify(result));
      } else barrier({ phase: "imported", goalId: result.goal.id });
    } else if (mode === "cancel") {
      const result = native.cancel({ targetId: target.id });
      barrier({ phase: "cancelled", cancellation: result.cancellation });
    } else if (mode === "restore") {
      const receipt = native.status({ targetId: target.id }).cancellation;
      db.close();
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        rename(from, to);
        if (to === path.join(root, `${id}.json`))
          barrier({ phase: "restored-bytes" });
      };
      restoreTransferredGoal(id, receipt, { root });
    } else throw new Error("Unknown phase");
  }
} catch (error) {
  process.stderr.write(error.stack);
  process.exitCode = 1;
}
