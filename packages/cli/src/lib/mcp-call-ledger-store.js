/**
 * Canonical session IO for the MCP call ledger.
 * Protocol validation and recovery reduction live in the pure projection module.
 */
import {
  appendAuthorityEvent as storeAppendAuthorityEvent,
  appendAuthorityEventWithVerifiedProjection as storeAppendAuthorityEventWithVerifiedProjection,
  readVerifiedEvents as storeReadVerifiedEvents,
  readVerifiedProjection as storeReadVerifiedProjection,
} from "../harness/jsonl-session-store.js";
import {
  MCP_CALL_LEDGER_PROTOCOL_LIMITS,
  snapshotMcpJsonRpcInput,
} from "./mcp-call-ledger.js";
import {
  MCP_CALL_LEDGER_EVENT,
  MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION,
  McpCallLedgerStoreError,
  canonicalRecord,
  isCanonicalProtocolText,
  phaseMatchesRecord,
  invalidRecoveryProjection,
  computeMcpRecoveryFenceDigest,
  createMcpLedgerEventReducer,
  assertMcpVerifiedProjectionAuthority,
  snapshotMcpLedgerRecoveryProjection,
  reduceMcpLedgerEvents,
} from "./mcp-call-ledger-projection.js";

// Preserve the existing public import path and class identity.
export * from "./mcp-call-ledger-projection.js";

/** Create the async sink accepted by `McpCallLedger`. */
export function createSessionMcpLedgerSink(sessionId, options = {}) {
  const appendEvent = options.appendEvent || storeAppendAuthorityEvent;
  const appendFencedEvent =
    options.appendFencedEvent ||
    storeAppendAuthorityEventWithVerifiedProjection;
  let recoveryFenceDigest = Object.prototype.hasOwnProperty.call(
    options,
    "recovery",
  )
    ? computeMcpRecoveryFenceDigest({
        ...(options.recovery || {}),
        sessionId,
      })
    : null;
  if (
    !isCanonicalProtocolText(
      sessionId,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    )
  ) {
    throw new TypeError("MCP ledger session sink requires sessionId");
  }
  if (typeof appendEvent !== "function") {
    throw new TypeError("MCP ledger session sink requires appendEvent");
  }
  if (typeof appendFencedEvent !== "function") {
    throw new TypeError("MCP ledger session sink requires appendFencedEvent");
  }

  const sink = async (record, metadata = {}) => {
    const canonical = canonicalRecord(record);
    if (!canonical) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_RECORD_INVALID",
        "MCP ledger refused to persist an invalid record",
        { sessionId, ledgerId: record?.ledgerId || null },
      );
    }
    if (canonical.sessionId !== sessionId) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_SESSION_MISMATCH",
        "MCP ledger record session does not match its durable transcript",
        { sessionId, ledgerId: canonical.ledgerId },
      );
    }
    const phase = String(metadata.phase || "");
    if (phase !== "started" && phase !== "settled") {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_PHASE_INVALID",
        `MCP ledger event phase is invalid: ${phase || "(missing)"}`,
        { sessionId, ledgerId: canonical.ledgerId },
      );
    }
    if (!phaseMatchesRecord(phase, canonical)) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_PHASE_STATUS_MISMATCH",
        `MCP ledger event phase ${phase} does not match status ${canonical.status}`,
        { sessionId, ledgerId: canonical.ledgerId },
      );
    }
    try {
      const eventData = {
        schemaVersion: MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION,
        phase,
        record: canonical,
      };
      const written = recoveryFenceDigest
        ? await appendFencedEvent(sessionId, MCP_CALL_LEDGER_EVENT, eventData, {
            createProjection: () => {
              const reducer = createMcpLedgerEventReducer({
                sessionId,
                verified: true,
              });
              let acceptedCount = 0;
              return Object.freeze({
                accept: (event) => {
                  acceptedCount += 1;
                  return reducer.accept(event);
                },
                finish: (authority) => {
                  const recovery = reducer.finish();
                  assertMcpVerifiedProjectionAuthority(authority, {
                    acceptedCount,
                    headHash: recovery.headHash,
                  });
                  return recovery;
                },
              });
            },
            validateProjection: (recovery) => {
              const currentFence = computeMcpRecoveryFenceDigest(recovery);
              if (currentFence !== recoveryFenceDigest) {
                throw new McpCallLedgerStoreError(
                  "CC_MCP_LEDGER_HOST_FENCE_STALE",
                  "MCP host recovery authority changed; restart or resume before executing MCP calls",
                  { sessionId, ledgerId: canonical.ledgerId },
                );
              }
            },
          })
        : await appendEvent(sessionId, MCP_CALL_LEDGER_EVENT, eventData);
      if (written === false) {
        throw new Error("canonical session store rejected the event");
      }
      return true;
    } catch (cause) {
      if (
        cause instanceof McpCallLedgerStoreError &&
        cause.code === "CC_MCP_LEDGER_HOST_FENCE_STALE"
      ) {
        throw cause;
      }
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_EVENT_PERSIST_FAILED",
        `MCP ledger event persistence failed for ${sessionId}: ${cause.message}`,
        { sessionId, ledgerId: canonical.ledgerId, cause },
      );
    }
  };
  sink.replaceRecoveryFence = (recovery) => {
    recoveryFenceDigest = computeMcpRecoveryFenceDigest({
      ...(recovery || {}),
      sessionId,
    });
    return recoveryFenceDigest;
  };
  sink.getRecoveryFenceDigest = () => recoveryFenceDigest;
  return sink;
}

export function loadMcpLedgerRecovery(sessionId, options = {}) {
  const hasInjectedProjection = Object.prototype.hasOwnProperty.call(
    options,
    "readVerifiedProjection",
  );
  const hasInjectedLegacyReader = Object.prototype.hasOwnProperty.call(
    options,
    "readVerifiedEvents",
  );
  if (
    (hasInjectedProjection &&
      typeof options.readVerifiedProjection !== "function") ||
    (hasInjectedLegacyReader &&
      typeof options.readVerifiedEvents !== "function")
  ) {
    throw new McpCallLedgerStoreError(
      "CC_MCP_LEDGER_EVENT_READ_FAILED",
      `MCP ledger recovery failed for ${sessionId}: verified reader is invalid`,
      {
        sessionId,
        cause: invalidRecoveryProjection("reader-not-callable"),
      },
    );
  }
  const hasCustomLegacyReader =
    hasInjectedLegacyReader &&
    options.readVerifiedEvents !== storeReadVerifiedEvents;
  const readVerifiedProjection = hasInjectedProjection
    ? options.readVerifiedProjection
    : hasCustomLegacyReader
      ? null
      : storeReadVerifiedProjection;
  const readVerifiedEvents =
    options.readVerifiedEvents || storeReadVerifiedEvents;
  try {
    if (typeof readVerifiedProjection === "function") {
      let projectionCreated = false;
      let finishedProjection;
      const returnedProjection = readVerifiedProjection(sessionId, () => {
        if (projectionCreated) {
          throw invalidRecoveryProjection("factory-reused");
        }
        projectionCreated = true;
        let acceptedCount = 0;
        let finished = false;
        const reducer = createMcpLedgerEventReducer({
          sessionId,
          verified: true,
        });
        return Object.freeze({
          accept(event) {
            if (finished) {
              throw invalidRecoveryProjection("accept-after-finish");
            }
            acceptedCount += 1;
            reducer.accept(event);
          },
          finish(authority) {
            if (finished) {
              throw invalidRecoveryProjection("finish-reused");
            }
            finished = true;
            const recovery = reducer.finish();
            assertMcpVerifiedProjectionAuthority(authority, {
              acceptedCount,
              headHash: recovery.headHash,
            });
            finishedProjection = recovery;
            return recovery;
          },
        });
      });
      if (
        !projectionCreated ||
        finishedProjection === undefined ||
        returnedProjection !== finishedProjection
      ) {
        throw invalidRecoveryProjection("reader-bypassed-factory");
      }
      return snapshotMcpLedgerRecoveryProjection(sessionId, returnedProjection);
    }
    const verifiedEvents = snapshotMcpJsonRpcInput(
      readVerifiedEvents(sessionId),
    );
    if (!Array.isArray(verifiedEvents)) {
      const invalid = new TypeError(
        "Verified MCP ledger events must be returned synchronously as an array",
      );
      invalid.code = "CC_MCP_LEDGER_VERIFIED_EVENTS_INVALID";
      throw invalid;
    }
    return snapshotMcpLedgerRecoveryProjection(
      sessionId,
      reduceMcpLedgerEvents(verifiedEvents, {
        sessionId,
        verified: true,
      }),
    );
  } catch (cause) {
    throw new McpCallLedgerStoreError(
      "CC_MCP_LEDGER_EVENT_READ_FAILED",
      `MCP ledger recovery failed for ${sessionId}: ${cause.message}`,
      { sessionId, cause },
    );
  }
}
