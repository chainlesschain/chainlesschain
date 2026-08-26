import { EventEmitter } from "node:events";
import { once } from "node:events";
import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";

import { buildSpawnCommand } from "./agent-session.js";
import {
  CC_AGENT_PROTOCOL_FEATURES,
  CC_AGENT_PROTOCOL_MIN_VERSION,
  CC_AGENT_PROTOCOL_VERSION,
  assertProtocolMessage,
  type ApprovalDecision,
  type JsonValue,
  type ServerNotification,
  type ServerRequest,
} from "./generated/app-protocol.js";
import { createNdjsonDecoder, encodeNdjson } from "./ndjson.js";

export interface AppServerClientOptions {
  cliPath?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  clientName?: string;
  clientVersion?: string;
  features?: string[];
  stateDirectory?: string;
  serverQueueCap?: number;
  maxPendingRequests?: number;
  maxLineLength?: number;
  requestTimeoutMs?: number;
  spawn?: typeof nodeSpawn;
  onServerRequest?: (request: ServerRequest) => Promise<JsonValue> | JsonValue;
}

export interface AppServerRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

export class AppServerRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(error: AppServerRpcErrorShape) {
    super(error.message);
    this.name = "AppServerRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type RpcEnvelope = {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: JsonValue;
  result?: unknown;
  error?: AppServerRpcErrorShape;
};

const APP_SERVER_ERROR_CODE = Object.freeze({
  OVERLOADED: -32001,
  INTERRUPTED: -32010,
});

/**
 * Typed, bounded stdio client for `cc serve --app-server`.
 *
 * Consumers share the generated protocol contract and this transport instead
 * of maintaining their own argv, framing, approval, and timeout behavior.
 */
export class AppServerClient extends EventEmitter {
  readonly options: AppServerClientOptions;
  private child: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private nextRequestId = 0;
  private closing = false;

  constructor(options: AppServerClientOptions = {}) {
    super();
    this.options = options;
  }

  get running(): boolean {
    return this.child !== null && !this.closing;
  }

  get pendingRequestCount(): number {
    return this.pending.size;
  }

  async start(): Promise<unknown> {
    if (this.child) throw new Error("AppServerClient already started");
    const args = ["serve", "--app-server"];
    if (this.options.stateDirectory) {
      args.push("--app-server-state-dir", this.options.stateDirectory);
    }
    if (this.options.serverQueueCap != null) {
      args.push("--app-server-queue-cap", String(this.options.serverQueueCap));
    }
    const { command, args: fullArgs } = buildSpawnCommand(
      this.options.cliPath || "cc",
      args,
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.options.env,
    };
    if (process.platform === "win32") {
      env.NoDefaultCurrentDirectoryInExePath = "1";
    }
    const spawnOptions: SpawnOptions = {
      cwd: this.options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    };
    this.child = (this.options.spawn ?? nodeSpawn)(
      command,
      fullArgs,
      spawnOptions,
    );
    this.closing = false;
    const decode = createNdjsonDecoder<unknown>(
      (message) => this.dispatch(message),
      {
        maxLineLength: this.options.maxLineLength,
        onError: (error) => this.fail(error),
      },
    );
    this.child.stdout?.on("data", (chunk: Buffer) => decode(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString("utf8"));
    });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => {
      try {
        decode.flush();
      } catch (error) {
        this.fail(error as Error);
      }
      const expected = this.closing;
      this.closing = true;
      this.rejectPending(
        new Error(
          expected
            ? "App Server connection closed"
            : `App Server exited unexpectedly (${code ?? "signal"})`,
        ),
      );
      this.child = null;
      this.emit("exit", code);
    });

    return this.request("initialize", {
      protocolVersion: CC_AGENT_PROTOCOL_VERSION,
      minimumProtocolVersion: CC_AGENT_PROTOCOL_MIN_VERSION,
      client: {
        name: this.options.clientName || "chainlesschain-agent-sdk",
        version: this.options.clientVersion || "1",
      },
      features: this.options.features || [...CC_AGENT_PROTOCOL_FEATURES],
    });
  }

  async request(method: string, params: JsonValue = {}): Promise<unknown> {
    const child = this.child;
    if (!child || this.closing || !child.stdin) {
      throw new Error("AppServerClient is not running");
    }
    const limit = Math.max(1, this.options.maxPendingRequests ?? 256);
    if (this.pending.size >= limit) {
      const error = new AppServerRpcError({
        code: APP_SERVER_ERROR_CODE.OVERLOADED,
        message: "App Server client request queue is overloaded",
        data: { retry_after_ms: 100, max_pending_requests: limit },
      });
      this.emit("overloaded", error);
      throw error;
    }
    const id = String(++this.nextRequestId);
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(
            new AppServerRpcError({
              code: APP_SERVER_ERROR_CODE.INTERRUPTED,
              message: `App Server request timed out: ${method}`,
            }),
          );
        },
        Math.max(1, this.options.requestTimeoutMs ?? 120_000),
      );
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      await this.write({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error as Error);
      }
    }
    return response;
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child || this.closing) return;
    this.closing = true;
    child.stdin?.end();
    if (child.exitCode == null && child.signalCode == null) {
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    if (child.exitCode == null && child.signalCode == null) child.kill();
    this.rejectPending(new Error("App Server connection closed"));
    this.child = null;
  }

  private async write(message: RpcEnvelope): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed)
      throw new Error("App Server stdin is closed");
    if (!stdin.write(encodeNdjson(message), "utf8")) {
      await once(stdin, "drain");
    }
  }

  private dispatch(value: unknown): void {
    try {
      assertProtocolMessage(value);
    } catch (error) {
      this.fail(error as Error);
      return;
    }
    const message = value as RpcEnvelope;
    if (message.method && message.id != null) {
      void this.answerServerRequest(message as ServerRequest);
      return;
    }
    if (message.method) {
      this.emit("notification", message as ServerNotification);
      this.emit(message.method, message.params);
      return;
    }
    if (message.id == null) return;
    const id = String(message.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new AppServerRpcError(message.error));
    else pending.resolve(message.result);
  }

  private async answerServerRequest(request: ServerRequest): Promise<void> {
    let result: JsonValue;
    try {
      if (this.options.onServerRequest) {
        result = await this.options.onServerRequest(request);
      } else {
        const decline: ApprovalDecision = {
          kind: "decline",
          reason: "No App Server request handler is configured",
        };
        result = decline;
      }
      await this.write({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      await this.write({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message:
            error instanceof Error ? error.message : "Client handler failed",
        },
      }).catch((writeError) => this.fail(writeError as Error));
    }
  }

  private fail(error: Error): void {
    this.emit("error", error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
