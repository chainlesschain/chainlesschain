import process from "node:process";
import { WorkspaceTransactionManager } from "../../src/lib/process-execution-broker/workspace-transaction.js";

const [workspaceRoot, stateDir] = process.argv.slice(2);
const manager = new WorkspaceTransactionManager({ stateDir });
const transaction = manager.begin({
  runId: "multiprocess-holder",
  taskKey: "holder-task",
  workspaceRoot,
});
transaction.markRunning();
process.stdout.write(
  `${JSON.stringify({ ready: true, id: transaction.id, pid: process.pid })}\n`,
);
process.stdin.setEncoding("utf8");
process.stdin.once("data", () => {
  try {
    transaction.rollback({ reason: "fixture shutdown" });
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
  }
});
