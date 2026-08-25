import fs from "node:fs";

import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";

const [, , phase, statePath, markerPath, resultPath] = process.argv;
const revisionDigest = `sha256:${"a".repeat(64)}`;
const authorityDigest = `sha256:${"b".repeat(64)}`;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function prepareCommittedCut() {
  const registry = new TaskLeaseRegistry({ defaultTtlMs: 100 });
  registry.addTask({ key: "source", title: "source" });
  const source = registry.acquire("source", { holder: "teammate-1" });
  registry.offerHandoff("source", {
    handoffId: "cross-process-handoff",
    holder: "teammate-1",
    leaseId: source.lease.leaseId,
    toHolder: "teammate-2",
    revisionDigest,
    authorityDigest,
    summary: { operation: "write-once" },
    ttlMs: 60_000,
  });
  registry.acceptHandoff("cross-process-handoff", {
    holder: "teammate-2",
    recipientAttempt: { taskKey: "acceptance-turn" },
  });
  const committed = registry.commitHandoff("cross-process-handoff", {
    holder: "teammate-1",
    leaseId: source.lease.leaseId,
    ttlMs: 100,
  });
  writeJson(statePath, {
    registry: registry.snapshot(),
    committedLeaseId: committed.lease.leaseId,
  });
  process.exit(73);
}

async function resumeCommittedCut() {
  const saved = readJson(statePath);
  const registry = TaskLeaseRegistry.restore(saved.registry);
  const mutations = [];
  let startedBeforeEffect = false;
  let recoveredAuthority = null;
  const persist = (event) => {
    mutations.push(event);
    writeJson(statePath, {
      registry: registry.snapshot(),
      committedLeaseId: saved.committedLeaseId,
    });
  };
  const runner = new TeamRunner(registry, {
    teammates: 2,
    ttlMs: 1000,
    graphRevisionDigest: revisionDigest,
    graphAuthorityDigest: authorityDigest,
    onHandoffMutation: persist,
    runTask: async (context) => {
      const durable = TaskLeaseRegistry.restore(readJson(statePath).registry);
      startedBeforeEffect =
        durable.findHandoff("cross-process-handoff").handoff.targetStartedAt !=
        null;
      recoveredAuthority = context.messageAuthority();
      const prior = fs.existsSync(markerPath)
        ? readJson(markerPath)
        : { count: 0 };
      writeJson(markerPath, { count: prior.count + 1 });
      return { effectCommitted: true };
    },
  });
  const summary = await runner.run();
  persist({ type: "run:complete" });
  writeJson(resultPath, {
    summary,
    marker: readJson(markerPath),
    startedBeforeEffect,
    oldLeaseId: saved.committedLeaseId,
    recoveredAuthority,
    mutations,
    handoff: registry.findHandoff("cross-process-handoff").handoff,
  });
}

if (phase === "prepare-crash") {
  prepareCommittedCut();
} else if (phase === "resume") {
  await resumeCommittedCut();
} else {
  throw new Error(`unknown fixture phase: ${String(phase)}`);
}
