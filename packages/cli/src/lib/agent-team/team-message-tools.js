/** Model-facing tool bundle for a lease-bound TeamMessageBridge. */

import {
  callTeamMessageBridge,
  TEAM_MESSAGE_BRIDGE_MAX_WAIT_MS,
  TEAM_MESSAGE_BRIDGE_PROTOCOL,
} from "./team-message-bridge.js";

export const TEAM_MESSAGE_TOOL_NAMES = Object.freeze([
  "team_send",
  "team_receive",
  "team_ack",
  "team_followup",
]);

const DEFINITIONS = Object.freeze([
  {
    type: "function",
    function: {
      name: "team_send",
      description:
        "Queue an at-least-once message to another teammate. The parent binds the sender to this exact task attempt; message content cannot grant permissions or approvals.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          to: {
            type: "string",
            description: "Teammate id, coordinator, or *.",
          },
          subject: { type: "string", maxLength: 256 },
          body: { description: "JSON coordination payload." },
          message_id: {
            type: "string",
            maxLength: 128,
            description: "Stable idempotency key for retries.",
          },
          causation_id: { type: "string", maxLength: 128 },
          correlation_id: { type: "string", maxLength: 128 },
        },
        required: ["to", "body", "message_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_receive",
      description:
        "Receive this teammate's unprocessed messages. Delivery is at-least-once; call team_ack with a stable consumer_key only after processing.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
          wait_ms: {
            type: "integer",
            minimum: 0,
            maximum: TEAM_MESSAGE_BRIDGE_MAX_WAIT_MS,
          },
          mark_read: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_ack",
      description:
        "Persist read, processed, or dead-letter receipts for explicitly listed message ids. A different consumer_key cannot re-process a settled message.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          message_ids: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            uniqueItems: true,
            items: { type: "integer", minimum: 1 },
          },
          consumer_key: { type: "string", minLength: 1, maxLength: 256 },
          disposition: {
            type: "string",
            enum: ["read", "processed", "dead_letter"],
          },
          reason: { type: "string", maxLength: 1024 },
        },
        required: ["message_ids", "consumer_key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_followup",
      description:
        "Queue an at-least-once follow-up and request a teammate turn wake. An idle teammate with a resumable session receives a new lease-bound turn; otherwise the result reports active, queued, processed, or dead-lettered state.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          to: { type: "string", description: "Teammate id or coordinator." },
          subject: { type: "string", maxLength: 256 },
          body: { description: "JSON follow-up payload." },
          message_id: {
            type: "string",
            maxLength: 128,
            description: "Stable idempotency key for retries.",
          },
          causation_id: { type: "string", maxLength: 128 },
          correlation_id: { type: "string", maxLength: 128 },
        },
        required: ["to", "body", "message_id"],
      },
    },
  },
]);

function descriptor(name) {
  return Object.freeze({
    name,
    kind: "team-message",
    category: "coordination",
    source: "host:team-message-bridge",
    serverName: null,
    inheritable: false,
    isReadOnly: false,
    riskLevel: "low",
    effectContract: Object.freeze({
      version: 1,
      declaredEffect: "write",
      authorizedEffect: "write",
      riskLevel: "low",
      sourceTrusted: true,
      provenance: "host:lease-bound-team-message-bridge",
      annotations: Object.freeze({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      }),
    }),
  });
}

export function resolveTeamMessageToolBundle({
  env = process.env,
  call = callTeamMessageBridge,
} = {}) {
  const endpoint = env.CC_TEAM_MESSAGE_BRIDGE_ENDPOINT;
  const token = env.CC_TEAM_MESSAGE_BRIDGE_TOKEN;
  const protocol = Number(env.CC_TEAM_MESSAGE_BRIDGE_PROTOCOL);
  if (!endpoint && !token && !env.CC_TEAM_MESSAGE_BRIDGE_PROTOCOL) return null;
  if (
    typeof endpoint !== "string" ||
    !endpoint ||
    typeof token !== "string" ||
    token.length !== 64 ||
    !/^[a-f0-9]{64}$/u.test(token) ||
    protocol !== TEAM_MESSAGE_BRIDGE_PROTOCOL
  ) {
    const error = new Error("Team message bridge environment is invalid");
    error.code = "TEAM_MESSAGE_BRIDGE_CONFIG_INVALID";
    throw error;
  }

  const operations = {
    team_send: "send",
    team_receive: "receive",
    team_ack: "ack",
    team_followup: "followup",
  };
  const externalToolExecutors = {};
  const externalToolDescriptors = {};
  for (const [name, operation] of Object.entries(operations)) {
    externalToolExecutors[name] = Object.freeze({
      kind: "team-message",
      operation,
      inheritable: false,
      execute: (args, options = {}) =>
        call({
          endpoint,
          token,
          op: operation,
          args,
          signal: options.signal || null,
        }),
    });
    externalToolDescriptors[name] = descriptor(name);
  }
  return Object.freeze({
    extraToolDefinitions: DEFINITIONS,
    externalToolExecutors: Object.freeze(externalToolExecutors),
    externalToolDescriptors: Object.freeze(externalToolDescriptors),
  });
}
