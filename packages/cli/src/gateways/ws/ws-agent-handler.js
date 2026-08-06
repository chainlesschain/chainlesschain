/**
 * WebSocket Agent Handler
 *
 * Canonical location (Phase 6b of the CLI Runtime Convergence roadmap,
 * 2026-04-09). Previously lived at `../../lib/ws-agent-handler.js`; that
 * path is retained as an `@deprecated` re-export shim for backwards
 * compatibility.
 *
 * Handles agent session messages over WebSocket. Consumes agent-core's
 * agentLoop generator and routes events to the client via the interaction
 * adapter.
 */

import { agentLoop, formatToolArgs } from "../../runtime/agent-core.js";
import { classifyToolSideEffect } from "../../lib/side-effect-ledger.js";
import { DiffReviewFollowUpTracker } from "../../lib/diff-review-follow-up.js";
import {
  loadSideEffectLedger,
  persistSideEffectLedger,
} from "../../lib/side-effect-ledger-store.js";
import { operationIdempotencyKey } from "../../lib/idempotency.js";
import {
  detectTaskType,
  selectModelForTask,
} from "../../lib/task-model-selector.js";
import { runnableTaskModel } from "../../lib/runnable-provider.js";
import { PlanState } from "../../lib/plan-mode.js";
import { CLISlotFiller } from "../../lib/slot-filler.js";
import { createAbortError, isAbortError } from "../../lib/abort-utils.js";
import {
  resolveRegisteredHostHooksV2Workspace,
  runWithHostHooksV2Workspace,
} from "../../lib/hooks-v2-workspace-context.js";
import { createWsApprovalGate } from "./ws-approval-gate.js";
import { createSessionMcpLedgerSink } from "../../lib/mcp-call-ledger-store.js";
import { createMcpHostRecoveryRuntime } from "../../lib/mcp-host-recovery-runtime.js";
import {
  claimWsTurnIfHead,
  computeWsTurnInputDigest,
  createWsTurnClaimId,
  normalizeWsTurnRequestId,
  readVerifiedWsTurnState,
  settleWsTurnClaim,
} from "../../harness/jsonl-session-store.js";

const CANONICAL_WS_TURN_QUEUES = new Map();
const CANONICAL_WS_CLAIM_CAS_ATTEMPTS = 4;

function runCanonicalWsTurnExclusive(sessionId, task) {
  const previous = CANONICAL_WS_TURN_QUEUES.get(sessionId) || Promise.resolve();
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => barrier);
  CANONICAL_WS_TURN_QUEUES.set(sessionId, tail);
  return previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      release();
      if (CANONICAL_WS_TURN_QUEUES.get(sessionId) === tail) {
        CANONICAL_WS_TURN_QUEUES.delete(sessionId);
      }
    });
}

export class WSAgentHandler {
  /**
   * @param {object} options
   * @param {import("./ws-session-gateway.js").Session} options.session
   * @param {import("../../lib/interaction-adapter.js").WebSocketInteractionAdapter} options.interaction
   * @param {object} [options.db]
   */
  constructor({
    session,
    interaction,
    db,
    approvalGate,
    agentLoop: runAgentLoop,
    canonicalSessionStore,
    sessionHostLease = null,
  }) {
    this.session = session;
    this.interaction = interaction;
    this.db = db || null;
    this._processing = false;
    this._abortController = null;
    this._activeRequestId = null;
    this._sessionHostLease = sessionHostLease;
    this._onSessionHostLeaseAbort = null;
    if (sessionHostLease?.signal) {
      this._onSessionHostLeaseAbort = () => {
        const reason =
          sessionHostLease.signal.reason ||
          createAbortError("Session host lease was lost");
        if (this._abortController && !this._abortController.signal.aborted) {
          this._abortController.abort(reason);
        }
        this.interaction?.rejectAllPending?.(reason);
      };
      sessionHostLease.signal.addEventListener(
        "abort",
        this._onSessionHostLeaseAbort,
        { once: true },
      );
      if (sessionHostLease.signal.aborted) this._onSessionHostLeaseAbort();
    }
    // P0-2: monotonic sequence for crash-safe side-effect ledger op ids. The
    // session id + a per-op nonce keep ids unique across turns and processes.
    this._sideEffectSeq = 0;
    // P0 authority: permission-gate-over-WS. An explicitly injected gate wins
    // (tests / embedders); otherwise one is built lazily on the first turn
    // when CC_WS_APPROVAL_GATE=1 — its confirmer raises confirm questions
    // over the interaction adapter WITH an approval binding the client must
    // echo back on approve (mismatch → deny). Default (env unset, nothing
    // injected): approvalGate stays null and loopOptions are byte-identical.
    this._approvalGate = approvalGate || null;
    this._approvalGateInit = Boolean(approvalGate);
    this._mcpRecoveryRuntime = null;
    this._mcpRecoverySink = null;
    this._mcpRecoveryRevision = null;
    this._mcpRecoveryClient = null;
    this._agentLoop = runAgentLoop || agentLoop;
    this._canonicalSessionStore = {
      claimWsTurnIfHead,
      computeWsTurnInputDigest,
      createWsTurnClaimId,
      normalizeWsTurnRequestId,
      readVerifiedWsTurnState,
      settleWsTurnClaim,
      ...(canonicalSessionStore || {}),
    };
    const explicitHostPrefix = Array.isArray(
      session?._canonicalHostSystemPrefix,
    )
      ? session._canonicalHostSystemPrefix
      : null;
    const hostSystemPrefix = explicitHostPrefix || [];
    if (!explicitHostPrefix) {
      for (const message of Array.isArray(session?.messages)
        ? session.messages
        : []) {
        if (message?.role !== "system") break;
        hostSystemPrefix.push(Object.freeze({ ...message }));
      }
    }
    this._canonicalHostSystemPrefix = explicitHostPrefix
      ? explicitHostPrefix
      : Object.freeze(hostSystemPrefix);
  }

  _applyCanonicalMessages(messages) {
    const canonicalMessages = Array.isArray(messages) ? messages : [];
    this.session.messages = [
      ...this._canonicalHostSystemPrefix,
      ...canonicalMessages,
    ];

    // Resume recovery notices are host-owned runtime context rather than
    // canonical transcript content. Preserve the current notice separately,
    // after the leading system block, on every authoritative refresh.
    const recoveryNotice = this.session._resumeRecoveryNoticeMessage || null;
    if (recoveryNotice) {
      let insertionIndex = 0;
      while (this.session.messages[insertionIndex]?.role === "system") {
        insertionIndex += 1;
      }
      this.session.messages.splice(insertionIndex, 0, recoveryNotice);
    }
    return this.session.messages;
  }

  _canonicalTurnFromAuthority(state, requestId, userMessage, inputDigest) {
    const status = state?.status || (state?.turn ? "completed" : "none");
    this._applyCanonicalMessages(state?.messages || []);
    if (status === "completed" && state.turn) {
      return {
        requestId,
        userMessage,
        inputDigest,
        status,
        settled: true,
        replayed: true,
        response: state.turn.assistant.content,
      };
    }
    if (status === "failed") {
      return {
        requestId,
        userMessage,
        inputDigest,
        status,
        settled: true,
        replayed: true,
        failureCode: state.settlement?.failure?.code || "CC_WS_TURN_FAILED",
      };
    }
    if (status === "pending") {
      return {
        requestId,
        userMessage,
        inputDigest,
        status,
        settled: false,
        pending: true,
        replayed: true,
      };
    }
    return null;
  }

  _claimCanonicalTurn(userMessage, requestId) {
    const inputDigest =
      this._canonicalSessionStore.computeWsTurnInputDigest(userMessage);
    let state = this._canonicalSessionStore.readVerifiedWsTurnState(
      this.session.id,
      requestId,
      { inputDigest },
    );
    let terminal = this._canonicalTurnFromAuthority(
      state,
      requestId,
      userMessage,
      inputDigest,
    );
    if (terminal) return terminal;

    const opaqueClaimId = this._canonicalSessionStore.createWsTurnClaimId();
    let lastConflict = null;
    for (
      let attempt = 1;
      attempt <= CANONICAL_WS_CLAIM_CAS_ATTEMPTS;
      attempt++
    ) {
      try {
        const claimed = this._canonicalSessionStore.claimWsTurnIfHead(
          this.session.id,
          { requestId, user: userMessage, inputDigest, opaqueClaimId },
          state.headHash,
        );
        if (!claimed?.acquired) {
          terminal = this._canonicalTurnFromAuthority(
            claimed,
            requestId,
            userMessage,
            inputDigest,
          );
          if (terminal) return terminal;
          throw Object.assign(
            new Error("Canonical WebSocket request claim was not acquired"),
            { code: "CC_WS_TURN_CLAIM_NOT_ACQUIRED" },
          );
        }
        this._applyCanonicalMessages(claimed.messages);
        const baseMessages = [...this.session.messages];
        this.session.messages.push({ role: "user", content: userMessage });
        return {
          requestId,
          userMessage,
          inputDigest,
          opaqueClaimId,
          status: "pending",
          claimAcquired: true,
          settled: false,
          settlementAttempted: false,
          failureSettlementAttempted: false,
          replayed: false,
          response: null,
          baseMessages,
        };
      } catch (error) {
        if (error?.code !== "SESSION_REVISION_STALE") throw error;
        lastConflict = error;
        state = this._canonicalSessionStore.readVerifiedWsTurnState(
          this.session.id,
          requestId,
          { inputDigest },
        );
        terminal = this._canonicalTurnFromAuthority(
          state,
          requestId,
          userMessage,
          inputDigest,
        );
        if (terminal) return terminal;
      }
    }
    const error = new Error(
      "Canonical WebSocket claim could not settle after revision conflicts",
      { cause: lastConflict },
    );
    error.code = "CC_WS_TURN_CLAIM_CAS_RETRY_EXHAUSTED";
    throw error;
  }

  _settleCanonicalSuccess(turn, assistantContent) {
    if (typeof assistantContent !== "string" || !assistantContent.trim()) {
      const error = new Error(
        "Canonical WebSocket turn produced no assistant response",
      );
      error.code = "CC_WS_EMPTY_ASSISTANT_RESPONSE";
      throw error;
    }
    turn.settlementAttempted = true;
    const settled = this._canonicalSessionStore.settleWsTurnClaim(
      this.session.id,
      {
        requestId: turn.requestId,
        inputDigest: turn.inputDigest,
        opaqueClaimId: turn.opaqueClaimId,
        outcome: "completed",
        user: turn.userMessage,
        assistant: assistantContent,
      },
    );
    if (settled?.status !== "completed" || !settled.turn) {
      const error = new Error("Canonical WebSocket success was not settled");
      error.code = "CC_WS_TURN_SETTLEMENT_UNKNOWN";
      error.commitState = "unknown";
      throw error;
    }
    this._applyCanonicalMessages(settled.messages);
    turn.settled = true;
    turn.status = "completed";
    turn.response = settled.turn.assistant.content;
    turn.replayed = settled.deduplicated === true;
    return { content: turn.response, replayed: turn.replayed };
  }

  _settleCanonicalFailure(turn, failureCode) {
    if (
      !turn?.claimAcquired ||
      turn.settled ||
      turn.settlementAttempted ||
      turn.failureSettlementAttempted
    ) {
      return false;
    }
    turn.failureSettlementAttempted = true;
    const settled = this._canonicalSessionStore.settleWsTurnClaim(
      this.session.id,
      {
        requestId: turn.requestId,
        inputDigest: turn.inputDigest,
        opaqueClaimId: turn.opaqueClaimId,
        outcome: "failed",
        failureCode,
      },
    );
    if (settled?.status !== "failed") {
      const error = new Error("Canonical WebSocket failure was not settled");
      error.code = "CC_WS_TURN_SETTLEMENT_UNKNOWN";
      error.commitState = "unknown";
      throw error;
    }
    turn.settled = true;
    turn.status = "failed";
    this._applyCanonicalMessages(settled.messages);
    return true;
  }

  _ensureMcpRecoveryRuntime() {
    const { session } = this;
    const revision = Number(session.mcpLedgerRecoveryRevision || 0);
    const rawClient = session.mcpClient || null;
    if (!this._mcpRecoveryRuntime || this._mcpRecoveryClient !== rawClient) {
      const controller = this._mcpRecoveryRuntime?.controller || null;
      // Only a newly verified resume revision may lower an existing runtime
      // latch. A transport/client replacement by itself preserves settlement
      // outcome-unknown authority across the new wrapper.
      if (
        controller &&
        this._mcpRecoveryRevision !== revision &&
        typeof controller.replaceVerifiedRecovery === "function"
      ) {
        controller.replaceVerifiedRecovery(
          session.mcpLedgerRecovery || {
            incidents: [],
            unsettled: [],
            replayDenied: [],
          },
        );
      }
      this._mcpRecoverySink = createSessionMcpLedgerSink(session.id, {
        recovery: session.mcpLedgerRecovery || null,
      });
      this._mcpRecoveryRuntime = createMcpHostRecoveryRuntime({
        bundle: {
          mcpClient: rawClient,
          externalToolDescriptors: session.externalToolDescriptors || {},
          externalToolExecutors: session.externalToolExecutors || {},
        },
        rawClient,
        sessionId: session.id,
        sink: this._mcpRecoverySink,
        recovery: session.mcpLedgerRecovery || null,
        controller,
      });
      this._mcpRecoveryClient = rawClient;
      this._mcpRecoveryRevision = revision;
    } else if (this._mcpRecoveryRevision !== revision) {
      this._mcpRecoveryRuntime.controller.replaceVerifiedRecovery(
        session.mcpLedgerRecovery || {
          incidents: [],
          unsettled: [],
          replayDenied: [],
        },
      );
      this._mcpRecoverySink?.replaceRecoveryFence?.(
        session.mcpLedgerRecovery || null,
      );
      this._mcpRecoveryRevision = revision;
    }
    return this._mcpRecoveryRuntime;
  }

  refreshMcpRecoveryRuntime() {
    try {
      return this._ensureMcpRecoveryRuntime();
    } catch (cause) {
      const error = new Error("WS MCP recovery runtime refresh failed", {
        cause,
      });
      try {
        error.code = cause?.code || "CC_MCP_RECOVERY_REFRESH_FAILED";
      } catch {
        error.code = "CC_MCP_RECOVERY_REFRESH_FAILED";
      }
      // If an earlier runtime exists, make it unusable immediately. The
      // session protocol also attaches an ALL-blocking projection so a future
      // runtime cannot silently recover as clean.
      this._mcpRecoveryRuntime?.controller?.latchAll?.(error.code);
      throw error;
    }
  }

  _recordSessionState(type, payload = {}) {
    if (typeof this.session?._recordSessionStateEvent !== "function") return;
    try {
      this.session._recordSessionStateEvent(type, payload);
    } catch (_err) {
      // Recovery persistence is best-effort for the live turn. A persisted
      // running marker is reconciled fail-closed when the session resumes.
    }
  }

  /** Resolve the session's approval gate (lazy, opt-in; null when disabled). */
  async _ensureApprovalGate() {
    if (this._approvalGateInit) return this._approvalGate;
    this._approvalGateInit = true;
    if (process.env.CC_WS_APPROVAL_GATE === "1") {
      this._approvalGate = await createWsApprovalGate({
        sessionId: this.session.id,
        interaction: this.interaction,
      });
    }
    return this._approvalGate;
  }

  /**
   * Handle a user message — one turn of the agentic loop.
   *
   * @param {string} userMessage
   * @param {string} [requestId] - id from ws message for response correlation
   */
  async handleMessage(userMessage, requestId) {
    if (this.session?.canonicalJsonlSession === true) {
      let canonicalRequestId;
      try {
        canonicalRequestId =
          this._canonicalSessionStore.normalizeWsTurnRequestId(requestId);
      } catch (error) {
        this.interaction.emit("error", {
          requestId: null,
          code: error?.code || "CC_WS_REQUEST_ID_INVALID",
          message: error?.message || "WebSocket request id is invalid",
        });
        return;
      }
      return runCanonicalWsTurnExclusive(this.session.id, () =>
        this._handleMessage(userMessage, canonicalRequestId),
      );
    }
    return this._handleMessage(userMessage, requestId);
  }

  async _handleMessage(userMessage, requestId) {
    if (this._processing) {
      this.interaction.emit("error", {
        requestId,
        code: "BUSY",
        message: "Session is currently processing a message",
      });
      return;
    }

    this._processing = true;
    const abortController = new AbortController();
    this._abortController = abortController;
    this._activeRequestId = requestId || null;
    let sideEffectLedger = null;
    let diffReviewFollowUps = null;
    let runRecorded = false;
    let canonicalTurn = null;

    try {
      const { session } = this;
      this._sessionHostLease?.assert?.();

      if (session.canonicalJsonlSession === true) {
        canonicalTurn = this._claimCanonicalTurn(userMessage, requestId);
        if (canonicalTurn.status === "completed") {
          this.interaction.emit("response-complete", {
            requestId,
            content: canonicalTurn.response,
            replayed: true,
          });
          return;
        }
        if (canonicalTurn.status === "failed") {
          this.interaction.emit("error", {
            requestId,
            code: canonicalTurn.failureCode,
            message: "WebSocket request previously settled as failed",
            replayed: true,
          });
          return;
        }
        if (canonicalTurn.pending) {
          this.interaction.emit("response-pending", {
            requestId,
            status: "pending",
            code: "CC_WS_TURN_PENDING",
            remediation: "adjudicate_or_use_new_request_id",
          });
          return;
        }
      } else {
        session.messages.push({ role: "user", content: userMessage });
      }
      this._recordSessionState("run.started", {
        requestId: requestId || null,
        startedAt: new Date().toISOString(),
      });
      runRecorded = true;

      // Auto-select model based on task type — runnable-first: never switch
      // onto a provider with no usable key (you'd just 401). Keep the
      // configured model in that case.
      let activeModel = session.model;
      const taskDetection = detectTaskType(userMessage);
      if (taskDetection.confidence > 0.3) {
        const recommended = selectModelForTask(
          session.provider,
          taskDetection.taskType,
        );
        const switchTo = runnableTaskModel({
          provider: session.provider,
          currentModel: activeModel,
          recommended,
          apiKey: session.apiKey,
        });
        if (switchTo) {
          activeModel = switchTo;
          this.interaction.emit("model-switch", {
            requestId,
            from: session.model,
            to: activeModel,
            reason: taskDetection.name,
          });
        }
      }

      // Create slot filler for interactive parameter collection
      const slotFiller = new CLISlotFiller({
        interaction: this.interaction,
        db: this.db,
      });
      const mcpRecoveryRuntime = this._ensureMcpRecoveryRuntime();

      // Run agent loop
      const loopOptions = {
        provider: session.provider,
        model: activeModel,
        baseUrl: session.baseUrl || "http://localhost:11434",
        apiKey: session.apiKey,
        contextEngine: session.contextEngine,
        hookDb: this.db,
        cwd: session.projectRoot,
        sessionId: session.id,
        planManager: session.planManager,
        enabledToolNames: session.enabledToolNames || null,
        hostManagedToolPolicy: session.hostManagedToolPolicy || null,
        extraToolDefinitions: session.externalToolDefinitions || [],
        externalToolDescriptors: session.externalToolDescriptors || {},
        externalToolExecutors: session.externalToolExecutors || {},
        mcpClient: session.mcpClient || null,
        mcpHostClient: mcpRecoveryRuntime.client || session.mcpClient || null,
        // MCP calls must use the same durable prewrite/settlement contract as
        // headless and REPL sessions. For unknown/write/destructive effects a
        // failed prewrite blocks the network call inside agent-core.
        mcpCallLedger: mcpRecoveryRuntime.ledger,
        shellPolicyOverrides: session.shellPolicyOverrides || null,
        slotFiller,
        interaction: this.interaction,
        signal: abortController.signal,
        // P0 authority: null unless opted in (byte-identical default — agent
        // core already defaults `options.approvalGate || null`).
        approvalGate: await this._ensureApprovalGate(),
      };

      // P0-2: crash-safe side-effect ledger for the IDE/bridge path — mirrors
      // the headless runner. A dangerous tool is recorded prepare→start (snapshot
      // persisted BEFORE it settles) and commit/fail on its result, so a bridge
      // worker killed mid-flight is surfaced for verification on resume (see
      // handleSessionResume) instead of being blindly replayed.
      sideEffectLedger = loadSideEffectLedger(session.id);
      diffReviewFollowUps = new DiffReviewFollowUpTracker(sideEffectLedger);
      let currentSideEffectOpId = null;
      let currentTodoWrite = null;

      const executeAgentTurn = async () => {
        for await (const event of this._agentLoop(
          session.messages,
          loopOptions,
        )) {
          switch (event.type) {
            case "slot-filling":
              this.interaction.emit("slot-filling", {
                requestId,
                slot: event.slot,
                question: event.question,
              });
              break;

            case "tool-executing":
              this.interaction.emit("tool-executing", {
                requestId,
                tool: event.tool,
                args: event.args,
                display: formatToolArgs(event.tool, event.args),
              });
              currentSideEffectOpId = null;
              currentTodoWrite =
                event.tool === "todo_write" && Array.isArray(event.args?.todos)
                  ? event.args.todos.map((todo) => ({
                      id: todo.id,
                      content: todo.content,
                      status: todo.status,
                    }))
                  : null;
              {
                const se = classifyToolSideEffect(event.tool, event.args);
                if (se) {
                  const opId = `ws:${session.id}:${Date.now()}:${this._sideEffectSeq++}`;
                  currentSideEffectOpId = opId;
                  sideEffectLedger
                    .prepare(opId, {
                      kind: se.kind,
                      key: se.key,
                      meta: {
                        tool: event.tool,
                        idempotencyKey: operationIdempotencyKey({
                          tool: event.tool,
                          args: event.args,
                        }),
                      },
                    })
                    .start(opId);
                  persistSideEffectLedger(session.id, sideEffectLedger);
                  this._sessionHostLease?.assert?.();
                }
              }
              break;

            case "tool-result":
              this.interaction.emit("tool-result", {
                requestId,
                tool: event.tool,
                result: event.result,
                error: event.error,
              });
              if (
                event.tool === "todo_write" &&
                currentTodoWrite &&
                !event.error &&
                !event.result?.error &&
                event.result?.success === true &&
                Number.isSafeInteger(event.result.revision)
              ) {
                this._recordSessionState("todo.snapshot", {
                  todo: {
                    sessionId: session.id,
                    revision: event.result.revision,
                    todos: currentTodoWrite,
                  },
                });
              }
              currentTodoWrite = null;
              if (currentSideEffectOpId) {
                const err = event.error || event.result?.error || null;
                if (event.result?._diffReviewAudit) {
                  diffReviewFollowUps.observe(
                    sideEffectLedger,
                    currentSideEffectOpId,
                    event.result._diffReviewAudit,
                  );
                }
                if (err)
                  sideEffectLedger.fail(
                    currentSideEffectOpId,
                    String(err).slice(0, 200),
                  );
                else sideEffectLedger.commit(currentSideEffectOpId);
                persistSideEffectLedger(session.id, sideEffectLedger);
                currentSideEffectOpId = null;
              }
              break;

            case "response-complete":
              if (session.canonicalJsonlSession === true) {
                const settled = this._settleCanonicalSuccess(
                  canonicalTurn,
                  event.content,
                );
                this.interaction.emit("response-complete", {
                  requestId,
                  content: settled.content,
                  replayed: settled.replayed,
                });
              } else {
                if (event.content) {
                  session.messages.push({
                    role: "assistant",
                    content: event.content,
                  });
                }
                this.interaction.emit("response-complete", {
                  requestId,
                  content: event.content,
                });
              }
              break;
          }
        }
      };
      const hooksWorkspaceBinding = resolveRegisteredHostHooksV2Workspace(
        session.hooksV2WorkspaceBindingId,
      );
      const runAgentTurn = () =>
        hooksWorkspaceBinding
          ? runWithHostHooksV2Workspace(
              hooksWorkspaceBinding.workspaceRoot,
              executeAgentTurn,
            )
          : executeAgentTurn();

      if (session.mcpClient?.withElicitationContext) {
        await session.mcpClient.withElicitationContext(
          session.id,
          runAgentTurn,
        );
      } else {
        await runAgentTurn();
      }
      if (session.canonicalJsonlSession === true && !canonicalTurn?.settled) {
        const error = new Error(
          "Canonical WebSocket turn completed without an assistant response",
        );
        error.code = "CC_WS_EMPTY_ASSISTANT_RESPONSE";
        throw error;
      }
      if (
        diffReviewFollowUps.complete(sideEffectLedger, {
          status: "completed-without-reproposal",
        }).length > 0
      ) {
        persistSideEffectLedger(session.id, sideEffectLedger);
      }

      // Update last activity
      session.lastActivity = new Date().toISOString();
    } catch (err) {
      let surfacedError = err;
      if (
        canonicalTurn?.claimAcquired &&
        !canonicalTurn.settled &&
        !canonicalTurn.settlementAttempted
      ) {
        const failureCode = isAbortError(err)
          ? "CC_WS_TURN_INTERRUPTED"
          : err?.code === "CC_WS_EMPTY_ASSISTANT_RESPONSE"
            ? "CC_WS_EMPTY_ASSISTANT_RESPONSE"
            : "CC_WS_TURN_FAILED";
        try {
          this._settleCanonicalFailure(canonicalTurn, failureCode);
        } catch (settlementError) {
          surfacedError = new Error(
            "WebSocket turn settlement is outcome-unknown; explicit adjudication or a new request id is required",
            { cause: settlementError },
          );
          surfacedError.code = "CC_WS_TURN_SETTLEMENT_UNKNOWN";
        }
      } else if (
        canonicalTurn?.claimAcquired &&
        canonicalTurn.settlementAttempted &&
        !canonicalTurn.settled
      ) {
        surfacedError = new Error(
          "WebSocket turn settlement is outcome-unknown; explicit adjudication or a new request id is required",
          { cause: err },
        );
        surfacedError.code = "CC_WS_TURN_SETTLEMENT_UNKNOWN";
      }
      if (canonicalTurn?.baseMessages && canonicalTurn.status !== "completed") {
        this.session.messages = [...canonicalTurn.baseMessages];
      }
      if (
        sideEffectLedger &&
        diffReviewFollowUps?.complete(sideEffectLedger, {
          status: "interrupted",
          reason: isAbortError(err) ? "aborted" : err.message,
        }).length > 0
      ) {
        persistSideEffectLedger(this.session.id, sideEffectLedger);
      }
      if (isAbortError(err) || abortController.signal.aborted) {
        return;
      }

      this.interaction.emit("error", {
        requestId,
        code: surfacedError?.code || "AGENT_ERROR",
        message: surfacedError.message,
      });

      // Record error in context engine
      if (this.session.contextEngine) {
        this.session.contextEngine.recordError({
          step: "ws-agent-loop",
          message: surfacedError.message,
        });
      }
    } finally {
      if (canonicalTurn?.baseMessages && canonicalTurn.status !== "completed") {
        this.session.messages = [...canonicalTurn.baseMessages];
      }
      if (runRecorded) {
        this._recordSessionState("run.settled", {
          requestId: requestId || null,
          settledAt: new Date().toISOString(),
        });
      }
      this._processing = false;
      if (this._abortController === abortController) {
        this._abortController = null;
      }
      if (this._activeRequestId === requestId) {
        this._activeRequestId = null;
      }
    }
  }

  async interrupt() {
    const wasProcessing = this._processing;
    const interruptedRequestId = this._activeRequestId || null;
    const reason = createAbortError("Session interrupted by client");

    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(reason);
    }

    if (typeof this.interaction?.rejectAllPending === "function") {
      this.interaction.rejectAllPending(reason);
    }

    this._recordSessionState("run.interrupted", {
      requestId: interruptedRequestId,
      interruptedAt: new Date().toISOString(),
      reason: "client_interrupt",
    });

    return {
      sessionId: this.session?.id || null,
      interrupted: true,
      wasProcessing,
      interruptedRequestId,
    };
  }

  destroy() {
    const wasProcessing = this._processing;
    const interruptedRequestId = this._activeRequestId || null;
    const reason = createAbortError("Session closed");
    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(reason);
    }
    if (typeof this.interaction?.rejectAllPending === "function") {
      this.interaction.rejectAllPending(reason);
    }
    if (wasProcessing) {
      this._recordSessionState("run.interrupted", {
        requestId: interruptedRequestId,
        interruptedAt: new Date().toISOString(),
        reason: "session_closed",
      });
    }
    if (this._sessionHostLease?.signal && this._onSessionHostLeaseAbort) {
      this._sessionHostLease.signal.removeEventListener(
        "abort",
        this._onSessionHostLeaseAbort,
      );
    }
    this._onSessionHostLeaseAbort = null;
    this._sessionHostLease?.release?.();
    this._sessionHostLease = null;
  }

  /**
   * Handle slash commands within the session.
   *
   * @param {string} command - e.g. "/plan enter", "/model qwen2:7b"
   * @param {string} [requestId]
   */
  async handleSlashCommand(command, requestId) {
    const [cmd, ...args] = command.trim().split(/\s+/);
    const arg = args.join(" ").trim();
    const { session } = this;

    switch (cmd) {
      case "/model":
        if (arg) {
          session.model = arg;
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { model: arg },
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { model: session.model },
          });
        }
        break;

      case "/provider": {
        const supported = [
          "ollama",
          "anthropic",
          "openai",
          "deepseek",
          "dashscope",
          "mistral",
          "gemini",
          "volcengine",
        ];
        if (arg && supported.includes(arg)) {
          session.provider = arg;
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { provider: arg },
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { provider: session.provider, available: supported },
          });
        }
        break;
      }

      case "/clear":
        session.messages.length = 1; // Keep system prompt
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { cleared: true },
        });
        break;

      case "/compact":
        if (session.contextEngine && session.messages.length > 5) {
          const compacted = session.contextEngine.smartCompact(
            session.messages,
          );
          session.messages.length = 0;
          session.messages.push(...compacted);
        } else if (session.messages.length > 5) {
          const systemMsg = session.messages[0];
          const recent = session.messages.slice(-4);
          session.messages.length = 0;
          session.messages.push(systemMsg, ...recent);
        }
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { messageCount: session.messages.length },
        });
        break;

      case "/task":
        if (arg === "clear") {
          if (session.contextEngine) session.contextEngine.clearTask();
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { cleared: true },
          });
        } else if (arg) {
          if (session.contextEngine) session.contextEngine.setTask(arg);
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { task: arg },
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: {
              task: session.contextEngine?.taskContext?.objective || null,
            },
          });
        }
        break;

      case "/stats":
        if (session.contextEngine) {
          const stats = session.contextEngine.getStats();
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: stats,
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { error: "Context engine not available" },
          });
        }
        break;

      case "/session":
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: {
            id: session.id,
            type: session.type,
            provider: session.provider,
            model: session.model,
            messageCount: session.messages.length,
            projectRoot: session.projectRoot,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
          },
        });
        break;

      case "/plan":
        this._handlePlanCommand(arg, requestId);
        break;

      default:
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { error: `Unknown command: ${cmd}` },
        });
    }
  }

  /**
   * Handle /plan sub-commands.
   */
  _handlePlanCommand(subCmd, requestId) {
    const planManager = this.session.planManager;

    if (!subCmd || subCmd === "enter") {
      if (planManager.isActive()) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan",
          result: { error: "Already in plan mode" },
        });
      } else {
        planManager.enterPlanMode({ title: "Agent Plan" });
        this.session.messages.push({
          role: "system",
          content:
            "[PLAN MODE ACTIVE] You are now in plan mode. You can read files, search, and analyze — but write/execute tools are blocked. Any blocked tool calls will be recorded as plan items. Analyze the task thoroughly, then the user will approve your plan.",
        });
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan",
          result: { state: "analyzing", message: "Entered plan mode" },
        });
      }
    } else if (subCmd === "show") {
      if (!planManager.isActive()) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan show",
          result: { error: "Not in plan mode" },
        });
      } else {
        this.interaction.emit("plan-ready", {
          requestId,
          summary: planManager.generatePlanSummary(),
          risk: planManager.getRiskAssessment(),
          items: planManager.currentPlan?.items || [],
        });
      }
    } else if (subCmd === "approve" || subCmd === "yes") {
      if (!planManager.isActive()) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan approve",
          result: { error: "No plan to approve" },
        });
      } else if (
        !planManager.currentPlan ||
        planManager.currentPlan.items.length === 0
      ) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan approve",
          result: { error: "Plan has no items" },
        });
      } else {
        planManager.approvePlan();
        this.session.messages.push({
          role: "system",
          content: `[PLAN APPROVED] The user has approved your plan with ${planManager.currentPlan.items.length} items. You can now use all tools including write_file, edit_file, run_shell, git, and run_skill. Execute the plan items in order.`,
        });
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan approve",
          result: {
            state: PlanState.APPROVED,
            itemCount: planManager.currentPlan.items.length,
          },
        });
      }
    } else if (subCmd === "reject" || subCmd === "no") {
      if (planManager.isActive()) {
        planManager.rejectPlan("User rejected");
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan reject",
          result: { state: PlanState.REJECTED },
        });
      } else {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan reject",
          result: { error: "No plan to reject" },
        });
      }
    } else if (subCmd === "exit") {
      if (planManager.isActive()) {
        planManager.exitPlanMode({ savePlan: true });
      }
      this.interaction.emit("command-response", {
        requestId,
        command: "/plan exit",
        result: { state: PlanState.INACTIVE },
      });
    } else {
      this.interaction.emit("command-response", {
        requestId,
        command: "/plan",
        result: {
          error: `Unknown /plan subcommand: ${subCmd}`,
          available: ["enter", "show", "approve", "reject", "exit"],
        },
      });
    }
  }
}
