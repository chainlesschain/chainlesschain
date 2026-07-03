import {
  SESSION_CORE_HANDLERS,
  SESSION_CORE_STREAMING_HANDLERS,
} from "./session-core-protocol.js";
import { VIDEO_HANDLERS, VIDEO_STREAMING_HANDLERS } from "./video-protocol.js";
import {
  PERSONAL_DATA_HUB_HANDLERS,
  PERSONAL_DATA_HUB_STREAMING_HANDLERS,
} from "./personal-data-hub-protocol.js";
import {
  handleRemoteSessionAudit,
  handleRemoteSessionCreate,
  handleRemoteSessionClose,
  handleRemoteSessionDevices,
  handleRemoteSessionJoin,
  handleRemoteSessionPairingToken,
  handleRemoteSessionPolicy,
  handleRemoteSessionPublish,
  handleRemoteSessionPushRegister,
  handleRemoteSessionRevoke,
} from "./remote-session-protocol.js";

export function createWsMessageDispatcher(server) {
  return {
    async dispatch(clientId, ws, message) {
      const { id, type } = message;

      if (!id) {
        server._send(ws, {
          type: "error",
          code: "MISSING_ID",
          message: 'Message must include an "id" field',
        });
        return;
      }

      const client = server.clients.get(clientId);
      // client may be undefined if it was removed mid-dispatch (heartbeat sweep
      // / disconnect); treat a missing client as unauthenticated rather than
      // throwing a TypeError (every sibling call site null-checks the client).
      if (server.token && !client?.authenticated && type !== "auth") {
        server._send(ws, {
          id,
          type: "error",
          code: "AUTH_REQUIRED",
          message: "Authentication required. Send an auth message first.",
        });
        return;
      }

      const routes = {
        auth: () => server._handleAuth(clientId, ws, message),
        ping: () =>
          server._send(ws, { id, type: "pong", serverTime: Date.now() }),
        execute: () => server._executeCommand(id, ws, message.command, false),
        stream: () => server._executeCommand(id, ws, message.command, true),
        cancel: () => server._cancelRequest(id, ws),
        "session-create": () => server._handleSessionCreate(id, ws, message),
        "session-resume": () => server._handleSessionResume(id, ws, message),
        "session-message": () => server._handleSessionMessage(id, ws, message),
        "session-policy-update": () =>
          server._handleSessionPolicyUpdate(id, ws, message),
        "session-list": () => server._handleSessionList(id, ws),
        "session-close": () => server._handleSessionClose(id, ws, message),
        "session-interrupt": () =>
          server._handleSessionInterrupt(id, ws, message),
        "slash-command": () => server._handleSlashCommand(id, ws, message),
        "session-answer": () => server._handleSessionAnswer(id, ws, message),
        "remote-session-create": () =>
          handleRemoteSessionCreate(server, clientId, ws, message),
        "remote-session-close": () =>
          handleRemoteSessionClose(server, clientId, ws, message),
        "remote-session-pairing-token": () =>
          handleRemoteSessionPairingToken(server, clientId, ws, message),
        "remote-session-join": () =>
          handleRemoteSessionJoin(server, clientId, ws, message),
        "remote-session-devices": () =>
          handleRemoteSessionDevices(server, clientId, ws, message),
        "remote-session-audit": () =>
          handleRemoteSessionAudit(server, clientId, ws, message),
        "remote-session-policy": () =>
          handleRemoteSessionPolicy(server, clientId, ws, message),
        "remote-session-push-register": () =>
          handleRemoteSessionPushRegister(server, clientId, ws, message),
        "remote-session-revoke": () =>
          handleRemoteSessionRevoke(server, clientId, ws, message),
        "remote-session-publish": () =>
          handleRemoteSessionPublish(server, clientId, ws, message),
        "host-tool-result": () => server._handleHostToolResult(id, ws, message),
        orchestrate: () => server._handleOrchestrate(id, ws, message),
        "cowork-task": () => server._handleCoworkTask(id, ws, message),
        "cowork-cancel": () => server._handleCoworkCancel(id, ws, message),
        "cowork-templates": () => server._handleCoworkTemplates(id, ws),
        "cowork-history": () => server._handleCoworkHistory(id, ws, message),
        "workflow-list": () => server._handleWorkflowList(id, ws),
        "workflow-get": () => server._handleWorkflowGet(id, ws, message),
        "workflow-save": () => server._handleWorkflowSave(id, ws, message),
        "workflow-remove": () => server._handleWorkflowRemove(id, ws, message),
        "workflow-run": () => server._handleWorkflowRun(id, ws, message),
        "tasks-list": () => server._handleTasksList(id, ws),
        "tasks-stop": () => server._handleTasksStop(id, ws, message),
        "tasks-detail": () => server._handleTaskDetail(id, ws, message),
        "tasks-history": () => server._handleTaskHistory(id, ws, message),
        "worktree-diff": () => server._handleWorktreeDiff(id, ws, message),
        "worktree-merge": () => server._handleWorktreeMerge(id, ws, message),
        "worktree-merge-preview": () =>
          server._handleWorktreeMergePreview(id, ws, message),
        "worktree-automation-apply": () =>
          server._handleWorktreeAutomationApply(id, ws, message),
        "worktree-list": () => server._handleWorktreeList(id, ws),
        "compression-stats": () =>
          server._handleCompressionStats(id, ws, message),
        "sub-agent-list": () => server._handleSubAgentList(id, ws, message),
        "sub-agent-get": () => server._handleSubAgentGet(id, ws, message),
        "review-enter": () => server._handleReviewEnter(id, ws, message),
        "review-submit": () => server._handleReviewSubmit(id, ws, message),
        "review-resolve": () => server._handleReviewResolve(id, ws, message),
        "review-status": () => server._handleReviewStatus(id, ws, message),
        "patch-propose": () => server._handlePatchPropose(id, ws, message),
        "patch-apply": () => server._handlePatchApply(id, ws, message),
        "patch-reject": () => server._handlePatchReject(id, ws, message),
        "patch-summary": () => server._handlePatchSummary(id, ws, message),
        "task-graph-create": () =>
          server._handleTaskGraphCreate(id, ws, message),
        "task-graph-add-node": () =>
          server._handleTaskGraphAddNode(id, ws, message),
        "task-graph-update-node": () =>
          server._handleTaskGraphUpdateNode(id, ws, message),
        "task-graph-advance": () =>
          server._handleTaskGraphAdvance(id, ws, message),
        "task-graph-state": () => server._handleTaskGraphState(id, ws, message),
        "chat.intent.understand": () =>
          server._handleChatIntentUnderstand(id, ws, message),
        "chat.intent.understand-stream": () =>
          server._handleChatIntentUnderstandStream(id, ws, message),
        "chat.intent.classify-followup": () =>
          server._handleChatIntentClassifyFollowup(id, ws, message),
        "llm.chat": () => server._handleLlmChat(id, ws, message),
      };

      // Static core routes take precedence and are dispatched directly. The
      // feature handler maps below are consulted ONLY when no static route
      // matches — so a feature topic can never shadow a core protocol route
      // (auth/cancel/ping/execute), and we no longer allocate a closure for all
      // ~79 feature keys on every message (the old per-message Object.keys loops
      // built the entire route table each dispatch). Only the matched handler
      // runs.
      const staticHandler = routes[type];
      if (staticHandler) {
        return staticHandler();
      }

      // Phase I — Hosted Session API streaming routes (stream.run). Each
      // intermediate event goes out as { id, type:"stream.event", event } and
      // the final response is sent by the normal ok/err wrapper.
      if (SESSION_CORE_STREAMING_HANDLERS[type]) {
        const controller = new AbortController();
        const client = server.clients.get(clientId);
        if (client) {
          client._streamAborts = client._streamAborts || new Map();
          client._streamAborts.set(id, controller);
        }
        const sender = (payload) => server._send(ws, { id, ...payload });
        const context = { server, ws, clientId };
        try {
          const result = await SESSION_CORE_STREAMING_HANDLERS[type](
            message,
            sender,
            controller.signal,
            context,
          );
          server._send(ws, { id, type: `${type}.end`, ...result });
        } catch (err) {
          server._send(ws, {
            id,
            type: "error",
            code: "STREAM_RUN_ERROR",
            message: err?.message || String(err),
          });
        } finally {
          if (client?._streamAborts) client._streamAborts.delete(id);
        }
        return;
      }

      // Video Editing streaming routes
      if (VIDEO_STREAMING_HANDLERS[type]) {
        const controller = new AbortController();
        const client = server.clients.get(clientId);
        if (client) {
          client._streamAborts = client._streamAborts || new Map();
          client._streamAborts.set(id, controller);
        }
        const sender = (payload) => server._send(ws, { id, ...payload });
        try {
          const result = await VIDEO_STREAMING_HANDLERS[type](
            message,
            sender,
            controller.signal,
          );
          server._send(ws, { id, type: `${type}.end`, ...result });
        } catch (err) {
          server._send(ws, {
            id,
            type: "error",
            code: "VIDEO_STREAM_ERROR",
            message: err?.message || String(err),
          });
        } finally {
          if (client?._streamAborts) client._streamAborts.delete(id);
        }
        return;
      }

      // Video Editing request/response routes
      if (VIDEO_HANDLERS[type]) {
        try {
          const result = await VIDEO_HANDLERS[type](message);
          server._send(ws, { id, type: `${type}.response`, ...result });
        } catch (err) {
          server._send(ws, {
            id,
            type: "error",
            code: "VIDEO_ERROR",
            message: err?.message || String(err),
          });
        }
        return;
      }

      // Personal Data Hub topics — same 10 surfaces as the Electron IPC
      // (see desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js). Each
      // handler returns { result } or { error }; we wrap with the standard
      // response envelope so renderer code is shell-agnostic.
      if (PERSONAL_DATA_HUB_HANDLERS[type]) {
        try {
          const out = await PERSONAL_DATA_HUB_HANDLERS[type](message);
          if (out && out.error) {
            server._send(ws, {
              id,
              type: "error",
              code: "PERSONAL_DATA_HUB_ERROR",
              message: out.error,
            });
          } else {
            server._send(ws, {
              id,
              type: `${type}.response`,
              result: out && out.result !== undefined ? out.result : out,
            });
          }
        } catch (err) {
          server._send(ws, {
            id,
            type: "error",
            code: "PERSONAL_DATA_HUB_ERROR",
            message: err?.message || String(err),
          });
        }
        return;
      }

      // Phase 5.7 — streaming sync routes. Adapter progress events are pushed
      // as `<topic>.event` messages tagged with the request id; the final
      // report comes as `<topic>.end`.
      if (PERSONAL_DATA_HUB_STREAMING_HANDLERS[type]) {
        const sender = (payload) => server._send(ws, { id, ...payload });
        try {
          const out = await PERSONAL_DATA_HUB_STREAMING_HANDLERS[type](
            message,
            sender,
          );
          server._send(ws, {
            id,
            type: `${type}.end`,
            ...(out && out.result !== undefined
              ? { result: out.result }
              : out || {}),
          });
        } catch (err) {
          server._send(ws, {
            id,
            type: "error",
            code: "PERSONAL_DATA_HUB_STREAM_ERROR",
            message: err?.message || String(err),
          });
        }
        return;
      }

      // Phase I — Hosted Session API (session-core, memory, beta, usage)
      if (SESSION_CORE_HANDLERS[type]) {
        try {
          const result = await SESSION_CORE_HANDLERS[type](message);
          server._send(ws, { id, type: `${type}.response`, ...result });
        } catch (err) {
          server._send(ws, {
            id,
            type: "error",
            code: "SESSION_CORE_ERROR",
            message: err?.message || String(err),
          });
        }
        return;
      }

      server._send(ws, {
        id,
        type: "error",
        code: "UNKNOWN_TYPE",
        message: `Unknown message type: ${type}`,
      });
      return;
    },
  };
}
