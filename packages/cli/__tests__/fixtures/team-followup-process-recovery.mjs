import fs from "node:fs";

import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamMailbox } from "../../src/lib/agent-team/team-mailbox.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";

const [, , phase, statePath, markerPath, resultPath] = process.argv;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function persist(stateFile, registry, mailbox, runner) {
  writeJson(stateFile, {
    registry: registry.snapshot(),
    mailbox: mailbox.snapshot(),
    members: runner.members(),
  });
}

async function prepareCrashCut() {
  const registry = new TaskLeaseRegistry();
  registry.addTask({ key: "receiver", title: "receiver" });
  const sourceClaim = registry.acquire("receiver", {
    holder: "teammate-1",
  });
  registry.complete("receiver", {
    holder: "teammate-1",
    leaseId: sourceClaim.lease.leaseId,
    result: "source-complete",
  });
  const mailbox = new TeamMailbox({ recipients: ["teammate-1"] });
  mailbox.send({
    from: "coordinator",
    to: "teammate-1",
    body: { operation: "write-once" },
    mode: "followup",
    idempotencyKey: "cross-process-followup-v1",
  });

  let runner;
  runner = new TeamRunner(registry, {
    teammates: 1,
    mailbox,
    realtimeMessaging: true,
    onFollowupMutation: () => persist(statePath, registry, mailbox, runner),
    afterTask: async () => {
      // This is the durable cut: the business effect and task settlement are
      // both on disk, but the message has deliberately not been ACKed.
      persist(statePath, registry, mailbox, runner);
      process.exit(73);
    },
    runTask: async ({ task }) => {
      if (!task.metadata?.teamFollowup) {
        throw new Error("only the recovered follow-up turn may execute");
      }
      const prior = fs.existsSync(markerPath)
        ? readJson(markerPath)
        : { count: 0 };
      writeJson(markerPath, { count: prior.count + 1 });
      return { effectCommitted: true };
    },
  });
  runner.seedMembers([
    {
      holder: "teammate-1",
      state: "shutdown",
      completed: 1,
      failed: 0,
      lastTaskKey: "receiver",
      sessionTaskKey: "receiver",
    },
  ]);
  await runner.run();
  throw new Error("crash cut did not terminate the process");
}

async function resumeAfterCrash() {
  const saved = readJson(statePath);
  const registry = TaskLeaseRegistry.restore(saved.registry);
  const mailbox = TeamMailbox.restore(saved.mailbox);
  const executions = [];
  let runner;
  runner = new TeamRunner(registry, {
    teammates: 1,
    mailbox,
    realtimeMessaging: true,
    onFollowupMutation: () => persist(statePath, registry, mailbox, runner),
    afterTask: async () => persist(statePath, registry, mailbox, runner),
    runTask: async (context) => {
      const followup = context.task.metadata?.teamFollowup;
      if (!followup) throw new Error("resume executed a non-follow-up task");
      const marker = readJson(markerPath);
      if (marker.count !== 1) {
        throw new Error(
          "the committed effect was repeated before reconciliation",
        );
      }
      executions.push({
        key: context.key,
        holder: context.holder,
        wakeAttempt: followup.wakeAttempt,
        reconciledExistingEffect: true,
      });
      mailbox.acknowledge(context.holder, {
        messageIds: [followup.messageId],
        consumerKey: "cross-process-consumer-v1",
        status: "processed",
        recipientAttempt: context.messageAuthority(),
      });
      return { reconciledExistingEffect: true };
    },
  });
  runner.seedMembers(saved.members);
  const summary = await runner.run();
  persist(statePath, registry, mailbox, runner);
  writeJson(resultPath, {
    summary,
    executions,
    marker: readJson(markerPath),
    pendingMessages: mailbox.peek("teammate-1").length,
    receipts: mailbox.snapshot().receipts.map((entry) => entry[1]),
  });
}

if (phase === "prepare-crash") {
  await prepareCrashCut();
} else if (phase === "resume") {
  await resumeAfterCrash();
} else {
  throw new Error(`unknown fixture phase: ${String(phase)}`);
}
