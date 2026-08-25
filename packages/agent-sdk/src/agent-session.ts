/**
 * AgentSession — duplex client for `cc agent` over stream-json stdio.
 *
 * Spawns the CLI once per session and speaks the NDJSON protocol from
 * ./protocol.ts both directions. This replaces per-consumer argv assembly
 * (VS Code agent-session.js / JetBrains AgentChatSession.java) with one
 * typed transport:
 *
 *   const session = new AgentSession({ onApproval: async (req) => ... });
 *   await session.start();
 *   session.on("text", (t) => render(t));
 *   session.send("refactor foo.ts");
 *
 * Approval callback contract: providing `onApproval` implies
 * --interactive-approvals; the SDK answers each approval_request with the
 * callback's verdict and fails CLOSED (deny) if the callback throws.
 * Question callback contract: providing `onQuestion` sets
 * CC_INTERACTIVE_QUESTIONS=1; a null return cancels the question.
 * Session resume contract: pass `resume` to continue a transcript; the
 * live session id (new or resumed) always arrives via the "init" event
 * and `sessionId`.
 */

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";

import { createNdjsonDecoder, encodeNdjson } from "./ndjson.js";
import {
  isApprovalDecision,
  type ApprovalDecision,
} from "./generated/app-protocol.js";
import {
  type AgentInputEvent,
  type AgentStreamEvent,
  type ApprovalRequestEvent,
  type ElicitationCompleteEvent,
  type ElicitationDeferredEvent,
  type LlmHint,
  type QuestionRequestEvent,
  type ResultEvent,
  type SystemInitEvent,
  contentDelta,
  isAgentEvent,
  isApprovalRequest,
  isMcpElicitationRequest,
  isQuestionRequest,
  isResult,
  isSystemInit,
} from "./protocol.js";

export type PermissionMode =
  "default" | "plan" | "acceptEdits" | "bypassPermissions" | "auto";

export type ApprovalVerdict = ApprovalDecision | boolean;

function normalizeApprovalVerdict(
  verdict: unknown,
  invalidReason = "Invalid approval callback decision",
): ApprovalDecision {
  if (verdict === true) return { kind: "acceptOnce" };
  if (verdict === false) return { kind: "decline" };
  if (isApprovalDecision(verdict)) return verdict;
  return { kind: "decline", reason: invalidReason };
}

function approvalBoolean(decision: ApprovalDecision): boolean {
  return ["acceptOnce", "acceptForTurn", "acceptForSession"].includes(
    decision.kind,
  );
}

export interface AgentSessionEvents {
  /** Every protocol event, before specialized dispatch. */
  event: (event: AgentStreamEvent) => void;
  init: (event: SystemInitEvent) => void;
  text: (delta: string) => void;
  thinking: (delta: string) => void;
  tool_use: (event: Extract<AgentStreamEvent, { type: "tool_use" }>) => void;
  tool_result: (
    event: Extract<AgentStreamEvent, { type: "tool_result" }>,
  ) => void;
  approval_request: (event: ApprovalRequestEvent) => void;
  question_request: (event: QuestionRequestEvent) => void;
  elicitation_request: (event: QuestionRequestEvent) => void;
  elicitation_deferred: (event: ElicitationDeferredEvent) => void;
  elicitation_complete: (event: ElicitationCompleteEvent) => void;
  result: (event: ResultEvent) => void;
  stderr: (chunk: string) => void;
  /** Child exited. Fires exactly once. */
  exit: (code: number | null) => void;
  error: (error: Error) => void;
}

export interface AgentSessionOptions {
  /** CLI binary; default "cc". A user-configured path always wins. */
  cliPath?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Session id to resume (`--resume <id>`). */
  resume?: string;
  /**
   * Explicit session id for a NEW session (`--session <id>`). IMPORTANT:
   * anonymous stream sessions are persistence-free by CLI design — without
   * an explicit id (this or `resume`) the transcript is never written and a
   * later `resume` of the id reported by system/init silently starts empty.
   * Pass one whenever the session should be resumable.
   */
  sessionId?: string;
  /** Fork the resumed session instead of appending (`--fork-session`). */
  forkSession?: boolean;
  permissionMode?: PermissionMode;
  model?: string;
  provider?: string;
  /** Emit text/thinking deltas (default true). */
  includePartialMessages?: boolean;
  /** Extra raw argv appended after the SDK-owned flags. */
  extraArgs?: string[];
  /**
   * Approval callback — resolves each approval_request. Implies
   * --interactive-approvals. Throwing or rejecting denies (fail closed).
   */
  onApproval?: (
    request: ApprovalRequestEvent,
  ) => Promise<ApprovalVerdict> | ApprovalVerdict;
  /**
   * Question callback for ask_user_question round-trips. Implies
   * CC_INTERACTIVE_QUESTIONS=1. Return null to cancel.
   */
  onQuestion?: (
    request: QuestionRequestEvent,
  ) => Promise<string | string[] | null> | string | string[] | null;
  /** MCP elicitation callback. Returning `{ action: "accept", content }` accepts; anything else cancels. */
  onElicitation?: (
    request: QuestionRequestEvent,
  ) =>
    | Promise<{ action: "accept" | "decline" | "cancel"; content?: unknown }>
    | { action: "accept" | "decline" | "cancel"; content?: unknown };
  /** DI seam for tests. */
  spawn?: typeof nodeSpawn;
}

export interface SendOptions {
  images?: string[];
  llm?: LlmHint;
}

type Listener = (...args: never[]) => void;

/**
 * On Windows `cc` is an npm `.cmd` shim, so the child must go through
 * `cmd.exe /c`. NoDefaultCurrentDirectoryInExePath stops cmd.exe from
 * executing a repo-local `cc.bat` planted in the workspace — the same
 * P0 fix both IDE plugins ship (VS Code hardened-env.js / JetBrains
 * CliLauncher.augmentPath).
 */
export function buildSpawnCommand(
  cliPath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  // A .js entrypoint (e.g. a repo checkout's bin/chainlesschain.js) is not
  // directly spawnable — run it through the current Node.
  if (/\.(m?js|cjs)$/i.test(cliPath)) {
    return { command: process.execPath, args: [cliPath, ...args] };
  }
  if (platform === "win32") {
    return { command: "cmd.exe", args: ["/c", cliPath, ...args] };
  }
  return { command: cliPath, args };
}

export function buildAgentArgs(options: AgentSessionOptions): string[] {
  const args = [
    "agent",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
  ];
  if (options.includePartialMessages !== false) {
    args.push("--include-partial-messages");
  }
  if (options.onApproval) args.push("--interactive-approvals");
  if (options.resume) args.push("--resume", options.resume);
  else if (options.sessionId) args.push("--session", options.sessionId);
  if (options.forkSession) args.push("--fork-session");
  if (options.permissionMode && options.permissionMode !== "default") {
    args.push("--permission-mode", options.permissionMode);
  }
  if (options.model) args.push("--model", options.model);
  if (options.provider) args.push("--provider", options.provider);
  if (options.extraArgs?.length) args.push(...options.extraArgs);
  return args;
}

export class AgentSession {
  readonly options: AgentSessionOptions;
  private child: ChildProcess | null = null;
  private listeners = new Map<keyof AgentSessionEvents, Set<Listener>>();
  private exited = false;
  private _sessionId: string | null = null;

  constructor(options: AgentSessionOptions = {}) {
    this.options = options;
  }

  /** Live session id — set once the system/init event arrives. */
  get sessionId(): string | null {
    return this._sessionId;
  }

  get running(): boolean {
    return this.child !== null && !this.exited;
  }

  on<K extends keyof AgentSessionEvents>(
    event: K,
    listener: AgentSessionEvents[K],
  ): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener);
    return this;
  }

  off<K extends keyof AgentSessionEvents>(
    event: K,
    listener: AgentSessionEvents[K],
  ): this {
    this.listeners.get(event)?.delete(listener as Listener);
    return this;
  }

  private emit<K extends keyof AgentSessionEvents>(
    event: K,
    ...args: Parameters<AgentSessionEvents[K]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch {
        // A misbehaving listener must never break the protocol pump.
      }
    }
  }

  /** Spawn the CLI child. Resolves once the process is started. */
  start(): void {
    if (this.child) throw new Error("AgentSession already started");
    const cliPath = this.options.cliPath || "cc";
    const args = buildAgentArgs(this.options);
    const { command, args: fullArgs } = buildSpawnCommand(cliPath, args);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.options.env,
    };
    if (process.platform === "win32") {
      env.NoDefaultCurrentDirectoryInExePath = "1";
    }
    if (this.options.onQuestion) env.CC_INTERACTIVE_QUESTIONS = "1";

    const spawnImpl = this.options.spawn ?? nodeSpawn;
    const spawnOptions: SpawnOptions = {
      cwd: this.options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = spawnImpl(command, fullArgs, spawnOptions);
    this.child = child;

    const decode = createNdjsonDecoder<unknown>(
      (message) => this.dispatch(message),
      { onError: () => {} },
    );
    child.stdout?.on("data", (chunk: Buffer) => decode(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) =>
      this.emit("stderr", chunk.toString("utf8")),
    );
    child.on("error", (error) => this.emit("error", error));
    child.on("exit", (code) => {
      if (this.exited) return;
      this.exited = true;
      // A final unterminated line (error output often lacks the trailing
      // \n) must not be dropped silently.
      try {
        decode.flush();
      } catch {
        /* flush is best-effort */
      }
      this.emit("exit", code);
    });
  }

  private dispatch(message: unknown): void {
    if (!isAgentEvent(message)) return;
    const event = message;
    this.emit("event", event);

    if (isSystemInit(event)) {
      this._sessionId = event.session_id;
      this.emit("init", event);
      return;
    }
    const delta = contentDelta(event);
    if (delta) {
      this.emit(delta.kind === "thinking" ? "thinking" : "text", delta.text);
      return;
    }
    if (event.type === "tool_use") {
      this.emit(
        "tool_use",
        event as Extract<AgentStreamEvent, { type: "tool_use" }>,
      );
      return;
    }
    if (event.type === "tool_result") {
      this.emit(
        "tool_result",
        event as Extract<AgentStreamEvent, { type: "tool_result" }>,
      );
      return;
    }
    if (isApprovalRequest(event)) {
      this.emit("approval_request", event);
      this.autoRespondApproval(event);
      return;
    }
    if (isMcpElicitationRequest(event)) {
      this.emit("elicitation_request", event);
      this.autoRespondElicitation(event);
      return;
    }
    if (event.type === "elicitation_deferred") {
      this.emit("elicitation_deferred", event as ElicitationDeferredEvent);
      return;
    }
    if (event.type === "elicitation_complete") {
      this.emit("elicitation_complete", event as ElicitationCompleteEvent);
      return;
    }
    if (isQuestionRequest(event)) {
      this.emit("question_request", event);
      this.autoRespondQuestion(event);
      return;
    }
    if (isResult(event)) {
      this.emit("result", event);
      return;
    }
  }

  private autoRespondApproval(request: ApprovalRequestEvent): void {
    const callback = this.options.onApproval;
    if (!callback) return;
    void (async () => {
      let decision: ApprovalDecision = {
        kind: "decline",
        reason: "Approval callback failed",
      };
      try {
        decision = normalizeApprovalVerdict(await callback(request));
      } catch {
        // Fail closed, mirroring the CLI's own timeout path.
      }
      this.respondApproval(request.id, decision, request.binding);
    })();
  }

  private autoRespondQuestion(request: QuestionRequestEvent): void {
    const callback = this.options.onQuestion;
    if (!callback) return;
    void (async () => {
      let answer: string | string[] | null = null;
      try {
        answer = await callback(request);
      } catch {
        answer = null; // cancel — the CLI resolves it as user_timeout
      }
      this.answerQuestion(request.id, answer, request.binding);
    })();
  }

  private autoRespondElicitation(request: QuestionRequestEvent): void {
    const callback = this.options.onElicitation;
    if (!callback) return;
    void (async () => {
      try {
        const response = await callback(request);
        if (response?.action === "accept") {
          this.answerQuestion(
            request.id,
            response.content ?? {},
            request.binding,
          );
        } else {
          this.answerQuestion(request.id, null, request.binding);
        }
      } catch {
        this.answerQuestion(request.id, null, request.binding);
      }
    })();
  }

  /** Write one protocol input event to the child's stdin. */
  write(event: AgentInputEvent): boolean {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return false;
    try {
      return stdin.write(encodeNdjson(event));
    } catch {
      return false;
    }
  }

  /** Queue one user turn. */
  send(text: string, options: SendOptions = {}): boolean {
    const event: AgentInputEvent = { type: "user", text };
    if (options.images?.length) event.images = options.images;
    if (options.llm) event.llm = options.llm;
    return this.write(event);
  }

  /** Abort the in-flight turn without ending the session. */
  interrupt(): boolean {
    return this.write({ type: "interrupt" });
  }

  /** Trim conversation history in place between turns. */
  compact(): boolean {
    return this.write({ type: "compact" });
  }

  respondApproval(
    id: string,
    verdict: ApprovalVerdict,
    binding?: string,
  ): boolean {
    // Preserve the N-1 public method contract exactly. A boolean response must
    // remain a legacy wire event; turning it into a structured decision would
    // make a new CLI require a binding that old callers never received/passed.
    if (typeof verdict === "boolean") {
      return this.write({
        type: "approval",
        id,
        approve: verdict,
        ...(binding ? { binding } : {}),
      });
    }
    const decision = normalizeApprovalVerdict(
      verdict,
      "Invalid approval response",
    );
    return this.write({
      type: "approval",
      id,
      decision,
      approve: approvalBoolean(decision),
      ...(binding ? { binding } : {}),
    });
  }

  answerQuestion(
    id: string,
    answer: unknown,
    binding?: QuestionRequestEvent["binding"],
  ): boolean {
    return this.write({
      type: "answer",
      id,
      answer,
      ...(binding ? { binding } : {}),
    });
  }

  planControl(action: "enter" | "approve" | "reject"): boolean {
    return this.write({ type: "plan", action });
  }

  /**
   * Resolves with the next result event — convenience for
   * send-one-prompt / await-one-turn usage.
   */
  nextResult(): Promise<ResultEvent> {
    return new Promise((resolve, reject) => {
      const onResult = (event: ResultEvent) => {
        cleanup();
        resolve(event);
      };
      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`agent exited (code ${code}) before a result`));
      };
      const cleanup = () => {
        this.off("result", onResult);
        this.off("exit", onExit);
      };
      this.on("result", onResult);
      this.on("exit", onExit);
    });
  }

  /** Graceful shutdown: close stdin so the CLI ends after the current turn. */
  end(): void {
    try {
      this.child?.stdin?.end();
    } catch {
      /* already closed */
    }
  }

  /** Hard kill of the child process tree. */
  kill(): void {
    const child = this.child;
    if (!child || this.exited) return;
    try {
      if (process.platform === "win32" && child.pid) {
        // taskkill /T reaps the cmd.exe → node grandchild, which a plain
        // child.kill() would orphan (same fix as both IDE plugins).
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      /* process already gone */
    }
  }
}
