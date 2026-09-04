import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  assertSandboxAvailable,
  normalizeAgentSandboxMode,
} from "../agent-sandbox.js";

const PERMISSION_MODES = new Set(["default", "manual", "dontAsk", "plan"]);

function adapterError(code, message) {
  const error = new Error(message);
  error.name = "CliAgentKernelAdapterError";
  error.code = code;
  return error;
}

function writeLine(input, value) {
  if (input.destroyed || input.writableEnded) {
    throw adapterError(
      "CC_APP_SERVER_AGENT_SESSION_CLOSED",
      "Agent Kernel input stream is closed",
    );
  }
  input.write(`${JSON.stringify(value)}\n`);
}

function approvalBoolean(decision) {
  return ["acceptOnce", "acceptForTurn", "acceptForSession"].includes(
    decision?.kind,
  );
}

function outputCollector(onEvent, onStderr) {
  let stdout = "";
  let stderr = "";
  return {
    writeOut(chunk) {
      stdout += String(chunk);
      for (;;) {
        const index = stdout.indexOf("\n");
        if (index < 0) break;
        const line = stdout.slice(0, index).trim();
        stdout = stdout.slice(index + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          event = { type: "raw", subtype: "invalid_json", text: line };
        }
        onEvent(event);
      }
      return true;
    },
    writeErr(chunk) {
      stderr += String(chunk);
      for (;;) {
        const index = stderr.indexOf("\n");
        if (index < 0) break;
        const line = stderr.slice(0, index).trim();
        stderr = stderr.slice(index + 1);
        if (line) onStderr(line);
      }
      return true;
    },
    flush() {
      if (stdout.trim()) {
        try {
          onEvent(JSON.parse(stdout.trim()));
        } catch {
          onEvent({
            type: "raw",
            subtype: "invalid_json",
            text: stdout.trim(),
          });
        }
      }
      if (stderr.trim()) onStderr(stderr.trim());
      stdout = "";
      stderr = "";
    },
  };
}

export class CliAgentKernelAdapter {
  constructor({
    cwd = process.cwd(),
    sandboxMode = "workspace-write",
    sandboxEngine = null,
    allowedPermissionModes = PERMISSION_MODES,
    sessionOptions = {},
    dependencies = {},
  } = {}) {
    this.cwd = cwd;
    this.sandboxMode = sandboxMode;
    this.sandboxEngine = sandboxEngine;
    this.allowedPermissionModes = new Set(allowedPermissionModes);
    this.sessionOptions = { ...sessionOptions };
    this.dependencies = dependencies;
    this.sessions = new Map();
  }

  async _createSession(threadId, turnOptions = {}) {
    const { runAgentHeadlessStream } =
      await import("../../runtime/headless-stream.js");
    const permissionMode = String(
      turnOptions.permissionMode ||
        this.sessionOptions.permissionMode ||
        "default",
    );
    if (!this.allowedPermissionModes.has(permissionMode)) {
      throw adapterError(
        "CC_APP_SERVER_PERMISSION_MODE_DENIED",
        `permission mode is not allowed by the App Server: ${permissionMode}`,
      );
    }
    const sandbox = normalizeAgentSandboxMode(
      this.sandboxMode,
      this.sandboxEngine || true,
      {
        cwd: this.cwd,
        network: false,
        settings: {
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
        },
      },
    );
    assertSandboxAvailable(sandbox);

    const input = new PassThrough();
    const session = {
      threadId,
      input,
      current: null,
      eventChain: Promise.resolve(),
      closed: false,
      failure: null,
      runPromise: null,
      collector: null,
    };
    const queueEvent = (event) => {
      const current = session.current;
      session.eventChain = session.eventChain.then(async () => {
        if (!current) return;
        await current.emit(event);
        if (event.type === "approval_request") {
          let decision = {
            kind: "decline",
            reason: "approval host unavailable",
          };
          try {
            decision = await current.requestApproval(event);
          } catch (error) {
            decision = {
              kind: "decline",
              reason: String(error?.message || error).slice(0, 2048),
            };
          }
          writeLine(input, {
            type: "approval",
            id: event.id,
            approve: approvalBoolean(decision),
            decision,
            binding: event.binding,
          });
        }
        if (event.type === "result") {
          session.current = null;
          current.resolve(event);
        }
      });
      session.eventChain.catch((error) => {
        if (session.current === current) session.current = null;
        current?.reject(error);
      });
    };
    const collector = outputCollector(queueEvent, (line) => {
      const current = session.current;
      if (!current) return;
      queueEvent({ type: "raw", subtype: "stderr", text: line });
    });
    session.collector = collector;
    session.runPromise = runAgentHeadlessStream(
      {
        ...this.sessionOptions,
        model: turnOptions.model || this.sessionOptions.model,
        provider: turnOptions.provider || this.sessionOptions.provider,
        baseUrl: this.sessionOptions.baseUrl,
        apiKey: this.sessionOptions.apiKey,
        sessionId: threadId,
        cwd: this.cwd,
        permissionMode,
        sandbox,
        interactiveApprovals: true,
        includePartialMessages: true,
        ephemeral: false,
        evolutionIngress:
          turnOptions.evolutionIngress ??
          this.sessionOptions.evolutionIngress ??
          null,
        skillOutcomeIndex:
          turnOptions.skillOutcomeIndex ??
          this.sessionOptions.skillOutcomeIndex ??
          null,
        skillVectorAuthority:
          turnOptions.skillVectorAuthority ??
          this.sessionOptions.skillVectorAuthority ??
          null,
        skillRetrievalRevocationReader:
          turnOptions.skillRetrievalRevocationReader ??
          this.sessionOptions.skillRetrievalRevocationReader ??
          null,
      },
      {
        ...this.dependencies,
        input,
        writeOut: collector.writeOut,
        writeErr: collector.writeErr,
      },
    )
      .then(async (outcome) => {
        collector.flush();
        await session.eventChain;
        session.closed = true;
        if (session.current) {
          session.current.reject(
            adapterError(
              "CC_APP_SERVER_AGENT_SESSION_CLOSED",
              "Agent Kernel session closed before the turn completed",
            ),
          );
          session.current = null;
        }
        return outcome;
      })
      .catch((error) => {
        session.failure = error;
        session.closed = true;
        if (session.current) {
          session.current.reject(error);
          session.current = null;
        }
        throw error;
      });
    session.runPromise.catch(() => {});
    this.sessions.set(threadId, session);
    return session;
  }

  async _session(threadId, options) {
    const existing = this.sessions.get(threadId);
    if (existing && !existing.closed) return existing;
    if (existing?.failure) throw existing.failure;
    return this._createSession(threadId, options);
  }

  async startTurn({
    threadId,
    turnId,
    input,
    options = {},
    emit,
    requestApproval,
  }) {
    const session = await this._session(threadId, options);
    if (session.current) {
      throw adapterError(
        "CC_APP_SERVER_TURN_ACTIVE",
        `thread already has an active turn: ${threadId}`,
      );
    }
    const prompt = String(input || "").trim();
    if (!prompt) {
      throw adapterError(
        "CC_APP_SERVER_INVALID_INPUT",
        "turn input must contain non-empty text",
      );
    }
    const terminal = new Promise((resolve, reject) => {
      session.current = {
        turnId,
        emit,
        requestApproval,
        resolve,
        reject,
      };
    });
    writeLine(session.input, {
      type: "user",
      text: prompt,
      images: Array.isArray(options.images) ? options.images : undefined,
    });
    return terminal;
  }

  async interruptTurn(threadId, turnId) {
    const session = this.sessions.get(threadId);
    if (!session?.current || session.current.turnId !== turnId) return false;
    writeLine(session.input, { type: "interrupt" });
    return true;
  }

  async forkThread(sourceThreadId, requestId = randomUUID()) {
    const { forkSession, sessionExists } =
      await import("../../harness/jsonl-session-store.js");
    if (!sessionExists(sourceThreadId)) return null;
    return forkSession(sourceThreadId, { requestId });
  }

  async closeThread(threadId) {
    const session = this.sessions.get(threadId);
    if (!session) return false;
    session.input.end();
    await session.runPromise.catch(() => {});
    this.sessions.delete(threadId);
    return true;
  }

  async close() {
    await Promise.all(
      [...this.sessions.keys()].map((threadId) => this.closeThread(threadId)),
    );
  }
}
