import { canonicalDigest } from "@chainlesschain/context-memory-kernel";
import { createHash } from "node:crypto";
import { SESSION_GENERATION_AUTHORITY_FIELD } from "../harness/session-list-index.js";
import {
  encodePersistedMessage,
  projectCanonicalResumeMessages,
} from "./session-message-provenance.js";

export const BRANCH_HISTORY_SCHEMA = "chainlesschain.session-branch-history/v1";
export const BRANCH_HISTORY_MESSAGE = "session_history_message";
export const BRANCH_HISTORY_ORIGIN = "session_history_origin";
const capabilities = new WeakMap();

export const branchContextDigest = (messages) =>
  canonicalDigest(
    projectCanonicalResumeMessages(messages, { strict: true }).map(
      encodePersistedMessage,
    ),
    "chainlesschain.branch-history-context/v1",
  );
export const branchMessageDigest = (message) =>
  canonicalDigest(message, "chainlesschain.branch-history-message/v1");

// A caller cannot smuggle JSON-shaped history into a new authority chain. The
// capability exists only inside a verified source projection's synchronous lock.
export function withSessionBranchHistory(plan, task) {
  if (typeof task !== "function" || task.constructor?.name === "AsyncFunction")
    throw new TypeError("Branch history consumer must be synchronous");
  const capability = Object.freeze({});
  capabilities.set(capability, plan);
  try {
    const result = task(capability);
    if (result && typeof result.then === "function")
      throw new TypeError("Branch history consumer must be synchronous");
    return result;
  } finally {
    capabilities.delete(capability);
  }
}

export function resolveSessionBranchHistory(
  capability,
  parentSessionId,
  messages,
) {
  if (capability == null) return null;
  const plan = capabilities.get(capability);
  if (
    !plan ||
    plan.parentSessionId !== parentSessionId ||
    plan.contextDigest !== branchContextDigest(messages)
  ) {
    throw new Error(
      "Branch history capability is expired or does not match the branch",
    );
  }
  return plan;
}

export function createBranchHistoryImport() {
  let start = null;
  let index = 0;
  let active = null;
  const hash = (value) =>
    typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const invalid = () => {
    const error = new Error(
      "Branch display history is incomplete or inconsistent",
    );
    error.code = "SESSION_BRANCH_HISTORY_INVALID";
    throw error;
  };
  const require = (condition) => {
    if (!condition) invalid();
  };
  return {
    accept(event) {
      index += 1;
      if (index === 1 && event.type === "session_start") {
        const data = { ...event.data };
        delete data[SESSION_GENERATION_AUTHORITY_FIELD];
        start = { type: event.type, data };
      }
      if (event.type === "session_branch" && event.data?.history != null) {
        const descriptor = event.data.history;
        require(
          index === 2 &&
            start &&
            !active &&
            descriptor.schema === BRANCH_HISTORY_SCHEMA &&
            hash(descriptor.sourceGeneration) &&
            integer(descriptor.totalMessages) &&
            integer(descriptor.contextMessageCount) &&
            descriptor.contextMessageCount <= 32768,
        );
        const coverage = descriptor.coverage;
        require(
          coverage?.kind === "from-origin"
            ? coverage.boundaryEvent === null && coverage.reason === null
            : coverage?.kind === "snapshot-boundary" &&
                hash(coverage.boundaryEvent) &&
                [
                  "timeline-replacement",
                  "context-snapshot",
                  "branch-snapshot",
                ].includes(coverage.reason),
        );
        const digest = createHash("sha256").update(
          `[${JSON.stringify(start)},${JSON.stringify({ type: event.type, data: event.data })}`,
        );
        active = {
          descriptor,
          digest,
          rows: 0,
          contexts: 0,
          pending: null,
          textParts: [],
          textBytes: 0,
          textIdentity: null,
          contextStarted: false,
        };
        return { kind: "start", coverage };
      }
      if (!active) {
        if (
          [BRANCH_HISTORY_MESSAGE, BRANCH_HISTORY_ORIGIN].includes(
            event.type,
          ) ||
          (event.type === "session_branch_complete" &&
            event.data?.schemaVersion === 2)
        )
          invalid();
        return null;
      }
      const state = active;
      if (event.type === "session_branch_complete") {
        require(
          !state.pending &&
            state.textParts.length === 0 &&
            state.rows === state.descriptor.totalMessages &&
            state.contexts === state.descriptor.contextMessageCount &&
            event.data?.schemaVersion === 2 &&
            event.data.messageCount === state.contexts &&
            event.data.inputDigest ===
              `sha256:${state.digest.update("]").digest("hex")}`,
        );
        active = null;
        return { kind: "complete" };
      }
      state.digest.update(
        `,${JSON.stringify({ type: event.type, data: event.data })}`,
      );
      if (event.type === BRANCH_HISTORY_MESSAGE) {
        const row = event.data;
        require(
          !state.contextStarted &&
            state.rows < state.descriptor.totalMessages &&
            ["user", "assistant", "tool"].includes(row?.role) &&
            typeof row.text === "string" &&
            row.text.length <= 128 * 1024 &&
            row.part === state.textParts.length &&
            typeof row.last === "boolean" &&
            hash(row.sourceEventId) &&
            integer(row.sourceItemIndex),
        );
        const identity = `${row.role}:${row.sourceEventId}:${row.sourceItemIndex}`;
        require(state.textIdentity === null || state.textIdentity === identity);
        state.textIdentity = identity;
        state.textBytes += Buffer.byteLength(row.text);
        require(
          state.textBytes <= 16 * 1024 * 1024 && state.textParts.length < 256,
        );
        state.textParts.push(row.text);
        if (!row.last) return { kind: "archive-part" };
        const message = { role: row.role, content: state.textParts.join("") };
        state.textParts = [];
        state.textBytes = 0;
        state.textIdentity = null;
        state.rows += 1;
        return { kind: "archive", message };
      }
      if (
        ["user_message", "assistant_message", "system"].includes(event.type)
      ) {
        require(
          !state.pending &&
            state.textParts.length === 0 &&
            state.rows === state.descriptor.totalMessages &&
            state.contexts < state.descriptor.contextMessageCount &&
            event.data?.role ===
              {
                user_message: "user",
                assistant_message: "assistant",
                system: "system",
              }[event.type],
        );
        state.contextStarted = true;
        state.pending = event.data;
        return { kind: "context" };
      }
      if (event.type === BRANCH_HISTORY_ORIGIN) {
        const message = state.pending;
        const origin = event.data?.origin;
        require(
          message && event.data.messageDigest === branchMessageDigest(message),
        );
        require(
          message.role === "system"
            ? origin === null
            : origin &&
                integer(origin.first) &&
                integer(origin.last) &&
                origin.first <= origin.last &&
                origin.last < state.rows,
        );
        state.contexts += 1;
        state.pending = null;
        return { kind: "origin", message, origin };
      }
      invalid();
    },
    finish() {
      if (active) invalid();
    },
  };
}
