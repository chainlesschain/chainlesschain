import { EventEmitter } from "node:events";

import {
  AppServerClient,
  type AppServerClientOptions,
} from "./app-server-client.js";
import type {
  ClientRequest,
  JsonValue,
  ServerNotification,
} from "./generated/app-protocol.js";

type AppServerMethod = Exclude<
  NonNullable<ClientRequest["method"]>,
  "initialize"
>;

export interface AppServerPilotTransport extends EventEmitter {
  readonly running: boolean;
  readonly pendingRequestCount: number;
  start(): Promise<unknown>;
  request(method: AppServerMethod, params?: JsonValue): Promise<unknown>;
  close(): Promise<void>;
}

export interface AppServerPilotClientOptions extends AppServerClientOptions {
  /** Test/host injection seam. Production consumers normally omit this. */
  transport?: AppServerPilotTransport;
}

export interface AppServerPilotStatus {
  running: boolean;
  initialized: boolean;
  pendingRequestCount: number;
  capabilities: unknown;
  lastError: string | null;
}

/**
 * Capability-shaped App Server client for product pilots.
 *
 * Unlike AppServerClient, this class deliberately has no generic request()
 * surface. Desktop and IDE hosts can expose these fixed operations without
 * turning a compromised renderer/Webview into an arbitrary local RPC client.
 */
export class AppServerPilotClient extends EventEmitter {
  private readonly transport: AppServerPilotTransport;
  private startPromise: Promise<unknown> | null = null;
  private capabilities: unknown = null;
  private lastError: string | null = null;

  constructor(options: AppServerPilotClientOptions = {}) {
    super();
    const { transport, ...clientOptions } = options;
    this.transport =
      transport ??
      (new AppServerClient(clientOptions) as AppServerPilotTransport);

    // Keep transport failures observable without allowing an unhandled
    // EventEmitter "error" to terminate the Desktop/Extension host.
    this.on("error", () => {});
    this.transport.on("error", (error: Error) => {
      this.lastError = error?.message || String(error);
      this.emit("error", error);
    });
    this.transport.on("stderr", (message: string) =>
      this.emit("stderr", message),
    );
    this.transport.on("overloaded", (error: Error) =>
      this.emit("overloaded", error),
    );
    this.transport.on("exit", (code: number | null) => this.emit("exit", code));
    this.transport.on("notification", (notification: ServerNotification) => {
      this.emit("notification", notification);
      this.emit(notification.method, notification.params);
    });
  }

  get status(): AppServerPilotStatus {
    return {
      running: this.transport.running,
      initialized: this.capabilities !== null,
      pendingRequestCount: this.transport.pendingRequestCount,
      capabilities: this.capabilities,
      lastError: this.lastError,
    };
  }

  async start(): Promise<unknown> {
    if (this.capabilities !== null && this.transport.running) {
      return this.capabilities;
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.transport
      .start()
      .then((capabilities) => {
        this.capabilities = capabilities;
        this.lastError = null;
        this.emit("ready", capabilities);
        return capabilities;
      })
      .catch(async (error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.capabilities = null;
        await this.transport.close().catch(() => {});
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  async close(): Promise<void> {
    await this.transport.close();
    this.capabilities = null;
  }

  threadStart(params: JsonValue = {}): Promise<unknown> {
    return this.call("thread/start", params);
  }

  threadResume(params: JsonValue): Promise<unknown> {
    return this.call("thread/resume", params);
  }

  threadFork(params: JsonValue): Promise<unknown> {
    return this.call("thread/fork", params);
  }

  threadRead(params: JsonValue): Promise<unknown> {
    return this.call("thread/read", params);
  }

  threadList(params: JsonValue = {}): Promise<unknown> {
    return this.call("thread/list", params);
  }

  threadArchive(params: JsonValue): Promise<unknown> {
    return this.call("thread/archive", params);
  }

  turnStart(params: JsonValue): Promise<unknown> {
    return this.call("turn/start", params);
  }

  turnInterrupt(params: JsonValue): Promise<unknown> {
    return this.call("turn/interrupt", params);
  }

  graphCompile(params: JsonValue): Promise<unknown> {
    return this.call("graph/compile", params);
  }

  graphRun(params: JsonValue): Promise<unknown> {
    return this.call("graph/run", params);
  }

  graphStatus(params: JsonValue): Promise<unknown> {
    return this.call("graph/status", params);
  }

  graphCancel(params: JsonValue): Promise<unknown> {
    return this.call("graph/cancel", params);
  }

  graphReconcile(params: JsonValue): Promise<unknown> {
    return this.call("graph/reconcile", params);
  }

  private async call(
    method: AppServerMethod,
    params: JsonValue,
  ): Promise<unknown> {
    await this.start();
    return this.transport.request(method, params);
  }
}
