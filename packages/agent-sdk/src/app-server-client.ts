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
  storageBackend?: "jsonl" | "sqlite";
  stateDirectory?: string;
  statePath?: string;
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
  private failed = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: AppServerClientOptions = {}) {
    super();
    this.options = options;
  }

  get running(): boolean {
    return this.child !== null && !this.closing && !this.failed;
  }

  get pendingRequestCount(): number {
    return this.pending.size;
  }

  async start(): Promise<unknown> {
    if (this.closePromise) await this.closePromise;
    if (this.child && this.failed) await this.close();
    if (this.child) throw new Error("AppServerClient already started");
    const args = ["serve", "--app-server"];
    if (this.options.stateDirectory && this.options.statePath) {
      throw new Error("stateDirectory and statePath are mutually exclusive");
    }
    if (this.options.storageBackend) {
      args.push("--app-server-store", this.options.storageBackend);
    }
    if (this.options.stateDirectory) {
      args.push("--app-server-state-dir", this.options.stateDirectory);
    }
    if (this.options.statePath) {
      args.push("--app-server-state-path", this.options.statePath);
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
    const child = (this.options.spawn ?? nodeSpawn)(
      command,
      fullArgs,
      spawnOptions,
    );
    this.child = child;
    this.closing = false;
    this.failed = false;
    const decode = createNdjsonDecoder<unknown>(
      (message) => {
        if (this.child === child) this.dispatch(message);
      },
      {
        maxLineLength: this.options.maxLineLength,
        onError: (error) => {
          if (this.child === child) this.fail(error);
        },
      },
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      if (this.child === child) decode(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (this.child === child) this.emit("stderr", chunk.toString("utf8"));
    });
    const failCurrent = (error: Error) => {
      if (this.child === child) this.fail(error);
    };
    child.on("error", failCurrent);
    child.stdin?.on("error", failCurrent);
    child.on("exit", (code) => {
      // A delayed exit from a previously closed process must not clear the
      // replacement connection or reject its in-flight requests.
      if (this.child !== child) return;
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
    if (!child || this.closing || this.failed || !child.stdin) {
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
    const writeController = new AbortController();
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
    // Observe the response immediately. Waiting for pipe drain first would
    // strand the caller (and leave a rejected response unhandled) when the
    // server stops consuming stdin. Response settlement cancels that wait.
    void this.write(
      { jsonrpc: "2.0", id, method, params },
      child,
      writeController.signal,
    ).catch((error) => {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error as Error);
      }
    });
    return response.finally(() => writeController.abort());
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const child = this.child;
    if (!child) return;
    this.closing = true;
    this.rejectPending(new Error("App Server connection closed"));
    const closing = (async () => {
      child.stdin?.end();
      if (child.exitCode == null && child.signalCode == null) {
        await new Promise<void>((resolve) => {
          const finished = () => {
            clearTimeout(timer);
            child.removeListener("exit", finished);
            resolve();
          };
          const timer = setTimeout(finished, 5_000);
          child.once("exit", finished);
        });
      }
      if (child.exitCode == null && child.signalCode == null) child.kill();
      if (this.child === child) this.child = null;
    })();
    this.closePromise = closing;
    try {
      await closing;
    } finally {
      if (this.closePromise === closing) this.closePromise = null;
    }
  }

  private async write(
    message: RpcEnvelope,
    child = this.child,
    signal?: AbortSignal,
  ): Promise<void> {
    const stdin = child?.stdin;
    if (child !== this.child || this.closing || this.failed || signal?.aborted)
      throw new Error("App Server connection closed");
    if (!stdin || stdin.destroyed)
      throw new Error("App Server stdin is closed");
    if (!stdin.write(encodeNdjson(message), "utf8")) {
      await once(stdin, "drain", { signal });
    }
  }

  private dispatch(value: unknown): void {
    if (this.failed || this.closing) return;
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
    const child = this.child;
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
      await this.write({ jsonrpc: "2.0", id: request.id, result }, child);
    } catch (error) {
      await this.write(
        {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32603,
            message:
              error instanceof Error ? error.message : "Client handler failed",
          },
        },
        child,
      ).catch((writeError) => {
        if (this.child === child) this.fail(writeError as Error);
      });
    }
  }

  private fail(error: Error): void {
    this.failed = true;
    this.rejectPending(error);
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
