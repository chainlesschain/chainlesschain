import { logger } from "../lib/logger.js";
import { SessionMessageFabric } from "../lib/session-message-fabric.js";

function output(value, options = {}) {
  if (options.json) {
    logger.log(JSON.stringify(value, null, 2));
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      logger.log("No session messages.");
      return;
    }
    for (const item of value) logger.log(JSON.stringify(item));
    return;
  }
  logger.log(JSON.stringify(value, null, 2));
}

function numericOption(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : value;
}

function fabric() {
  return new SessionMessageFabric();
}

export function registerSessionMessageCommands(session) {
  const message = session
    .command("message")
    .description(
      "Durable cross-session inbox, addressing, policy and receipts",
    );

  message
    .command("register <session-id>")
    .description("Register or reconnect a uniquely named session endpoint")
    .option("--name <name>", "Unique @name (defaults to session id)")
    .option("--machine <id>", "Stable machine identity", "local")
    .option(
      "--policy <policy>",
      "Inbound policy: accept | hold | refuse",
      "accept",
    )
    .option("--busy", "Register as busy instead of idle")
    .option("--json", "Output as JSON")
    .action((sessionId, options) => {
      output(
        fabric().register({
          sessionId,
          name: options.name || sessionId,
          machineId: options.machine,
          policy: options.policy,
          idle: options.busy !== true,
        }),
        options,
      );
    });

  message
    .command("unregister <endpoint>")
    .description("Retire an endpoint epoch without leaking its inbox to reuse")
    .option("--json", "Output as JSON")
    .action((endpoint, options) => {
      output(
        { unregistered: fabric().unregister(endpoint), endpoint },
        options,
      );
    });

  message
    .command("send <from> <to> <body...>")
    .description("Send one bounded, idempotent message and print its receipt")
    .option("--subject <text>", "Optional bounded subject")
    .option("--message-id <id>", "Stable idempotency key")
    .option("--sequence <n>", "Per sender/recipient ordering sequence")
    .option("--ttl-ms <n>", "Message expiry in milliseconds")
    .option(
      "--notify-when-idle",
      "Emit one receipt update when target becomes idle",
    )
    .option("--json", "Output as JSON")
    .action((from, to, body, options) => {
      output(
        fabric().send({
          from,
          to,
          body: body.join(" "),
          subject: options.subject,
          messageId: options.messageId,
          sequence: numericOption(options.sequence),
          ttlMs: numericOption(options.ttlMs),
          notifyWhenIdle: options.notifyWhenIdle === true,
        }),
        options,
      );
    });

  message
    .command("inbox <endpoint>")
    .description("Read an endpoint inbox in sender sequence order")
    .option("--ack", "Acknowledge and release returned live message bodies")
    .option("--json", "Output as JSON")
    .action((endpoint, options) => {
      output(fabric().inbox(endpoint, { acknowledge: options.ack }), options);
    });

  message
    .command("receipts <endpoint>")
    .description("List durable delivered/refused/full/expired receipts")
    .option("--json", "Output as JSON")
    .action((endpoint, options) => {
      output(fabric().receipts(endpoint), options);
    });

  message
    .command("policy <endpoint> <policy>")
    .description("Set accept, hold or refuse with optional revision CAS")
    .option("--expected-revision <n>", "Reject a stale rendered policy action")
    .option("--json", "Output as JSON")
    .action((endpoint, policy, options) => {
      output(
        fabric().setPolicy(endpoint, policy, {
          expectedRevision: numericOption(options.expectedRevision),
        }),
        options,
      );
    });

  message
    .command("idle <endpoint> <state>")
    .description("Set idle/busy and deliver notify_when_idle exactly once")
    .option("--expected-revision <n>", "Reject a stale rendered idle action")
    .option("--json", "Output as JSON")
    .action((endpoint, state, options) => {
      const normalized = String(state).trim().toLowerCase();
      if (!["idle", "busy", "true", "false"].includes(normalized)) {
        const error = new Error("state must be idle, busy, true or false");
        error.code = "SESSION_MESSAGE_INVALID_ARGUMENT";
        throw error;
      }
      output(
        fabric().setIdle(endpoint, ["idle", "true"].includes(normalized), {
          expectedRevision: numericOption(options.expectedRevision),
        }),
        options,
      );
    });

  for (const action of ["disconnect", "reconnect"]) {
    message
      .command(`${action} <endpoint>`)
      .description(
        action === "disconnect"
          ? "Mark transport offline while retaining its durable inbox"
          : "Mark a durable endpoint transport online again",
      )
      .option("--json", "Output as JSON")
      .action((endpoint, options) => {
        output({ endpoint, [action]: fabric()[action](endpoint) }, options);
      });
  }

  message
    .command("status")
    .description("Emit the bounded CLI-owned message projection")
    .option("--json", "Output as JSON")
    .action((options) => output(fabric().projection(), options));
}
