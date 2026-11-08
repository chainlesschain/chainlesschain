import { createHash } from "node:crypto";

// Acceptance is evidence for local inspection, never a provider message.
// A single settled event publishes the complete conversation pair.
export const SESSION_INPUT_ACCEPTED = "session_input_accepted";
export const SESSION_INPUT_SETTLED = "session_input_settled";
const SCHEMA_VERSION = 1;
const MAX_PENDING_INPUTS = 100_000;

function invalid(detail) {
  return Object.assign(
    new Error(`Invalid session input lifecycle: ${detail}`),
    {
      code: "CC_SESSION_INPUT_LIFECYCLE_INVALID",
    },
  );
}

function identity(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_:.-]{1,160}$/u.test(value))
    throw invalid(field);
  return value;
}

function text(value, field) {
  if (typeof value !== "string") throw invalid(field);
  return value;
}

function hash(value, field) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw invalid(field);
  return value;
}

export function sessionInputDigest(prompt) {
  return createHash("sha256")
    .update(JSON.stringify(text(prompt, "prompt")))
    .digest("hex");
}

export function createSessionInputAccepted({ inputId, turnId, prompt }) {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    inputId: identity(inputId, "inputId"),
    turnId: identity(turnId, "turnId"),
    prompt: text(prompt, "prompt"),
    inputDigest: sessionInputDigest(prompt),
  });
}

function acceptedData(value) {
  const canonical = createSessionInputAccepted(value || {});
  if (
    value?.schemaVersion !== SCHEMA_VERSION ||
    value.inputDigest !== canonical.inputDigest
  )
    throw invalid("acceptance schema or digest");
  return canonical;
}

export function createSessionInputSettled(accepted, acceptanceHash, response) {
  const data = acceptedData(accepted);
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    inputId: data.inputId,
    turnId: data.turnId,
    inputDigest: data.inputDigest,
    acceptanceHash: hash(acceptanceHash, "acceptanceHash"),
    user: Object.freeze({ role: "user", content: data.prompt }),
    assistant: Object.freeze({
      role: "assistant",
      content: text(response, "response"),
    }),
  });
}

export function projectSessionInputMessages(event) {
  if (event?.type !== SESSION_INPUT_SETTLED) return null;
  const data = event.data;
  const accepted = createSessionInputAccepted({
    inputId: data?.inputId,
    turnId: data?.turnId,
    prompt: data?.user?.content,
  });
  const settled = createSessionInputSettled(
    accepted,
    data?.acceptanceHash,
    data?.assistant?.content,
  );
  if (
    data?.schemaVersion !== SCHEMA_VERSION ||
    data?.user?.role !== "user" ||
    data?.assistant?.role !== "assistant" ||
    data?.inputDigest !== settled.inputDigest
  )
    throw invalid("settlement schema, roles or digest");
  return Object.freeze([settled.user, settled.assistant]);
}

/** Feed only events from the canonical verified chain. Private content must
 * never be attached to the public host snapshot or runtime event stream. */
export function createSessionInputLifecycleProjection() {
  const pending = new Map();
  return {
    accept(event) {
      if (event?.type === SESSION_INPUT_ACCEPTED) {
        const data = acceptedData(event.data);
        if (pending.has(data.inputId)) throw invalid("duplicate acceptance");
        if (pending.size >= MAX_PENDING_INPUTS)
          throw invalid("pending capacity");
        pending.set(
          data.inputId,
          Object.freeze({
            ...data,
            acceptanceHash: hash(event.hash, "acceptance event hash"),
          }),
        );
      } else if (event?.type === SESSION_INPUT_SETTLED) {
        projectSessionInputMessages(event);
        const prior = pending.get(event.data.inputId);
        if (
          !prior ||
          prior.turnId !== event.data.turnId ||
          prior.inputDigest !== event.data.inputDigest ||
          prior.acceptanceHash !== event.data.acceptanceHash
        )
          throw invalid("settlement does not match pending acceptance");
        pending.delete(event.data.inputId);
      }
    },
    finish() {
      const inputs = Object.freeze([...pending.values()]);
      return Object.freeze({
        pendingInputs: inputs,
        summary: Object.freeze({
          pendingCount: inputs.length,
          inputs: Object.freeze(
            inputs.map(({ inputId, turnId, inputDigest }) =>
              Object.freeze({ inputId, turnId, inputDigest }),
            ),
          ),
        }),
      });
    },
  };
}
