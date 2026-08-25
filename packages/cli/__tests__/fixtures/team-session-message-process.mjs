import { TeamSessionMessageAdapter } from "../../src/lib/agent-team/team-session-message-adapter.js";

const [action, statePath, teamId] = process.argv.slice(2);
const adapter = new TeamSessionMessageAdapter({
  statePath,
  teamId,
  recipients: ["teammate-1", "teammate-2"],
  maxMessagesPerSenderWindow: 2,
  senderRateWindowMs: 60_000,
});

if (action === "recover") {
  adapter.setRecipientState("teammate-2", "running");
  const messages = adapter.receive("teammate-2", { markRead: true });
  adapter.acknowledge("teammate-2", {
    messageIds: messages.map((message) => message.id),
    consumerKey: "recovery-process",
    status: "processed",
    recipientAttempt: { taskKey: "recovery", fencingToken: 4 },
  });
  process.stdout.write(
    JSON.stringify({
      messages: messages.map((message) => message.id),
      pending: adapter.pendingCount("teammate-2"),
    }),
  );
} else if (action === "rate") {
  try {
    adapter.send({
      from: "teammate-1",
      to: "teammate-2",
      body: "third process",
      idempotencyKey: "process-rate-3",
      senderAttempt: { taskKey: "rate-task" },
    });
    process.stdout.write(JSON.stringify({ admitted: true }));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        admitted: false,
        code: error.code,
        retryAfterMs: error.retryAfterMs,
      }),
    );
  }
} else {
  throw new Error(`unknown action: ${action}`);
}
