import { createInterface } from "node:readline";
import { once } from "node:events";
import { BoundedAsyncQueue, QueueOverloadedError } from "./bounded-queue.js";
import { CcAppServer } from "./server.js";
import { JSON_RPC_ERROR, JsonRpcError, rpcError } from "./protocol.js";

export class StdioAppServerTransport {
  constructor({
    input = process.stdin,
    output = process.stdout,
    maxLineBytes = 1024 * 1024,
    maxQueuedMessages = 512,
    maxQueuedBytes = 8 * 1024 * 1024,
  } = {}) {
    this.input = input;
    this.output = output;
    this.maxLineBytes = maxLineBytes;
    this.queue = new BoundedAsyncQueue({
      maxItems: maxQueuedMessages,
      maxBytes: maxQueuedBytes,
      sizeOf: (line) => Buffer.byteLength(line, "utf8"),
    });
    this.closed = false;
    this.failure = null;
    this.pump = this._pump();
  }

  async _pump() {
    try {
      for await (const line of this.queue) {
        if (!this.output.write(line)) await once(this.output, "drain");
      }
    } catch (error) {
      this.failure = error;
      this.queue.close(error);
      throw error;
    }
  }

  send(message) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed)
      return Promise.reject(new Error("stdio transport is closed"));
    const line = `${JSON.stringify(message)}\n`;
    try {
      this.queue.push(line);
      return Promise.resolve();
    } catch (error) {
      if (error instanceof QueueOverloadedError) {
        this.failure = error;
      }
      return Promise.reject(error);
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.queue.close();
    await this.pump;
  }
}

export async function runStdioAppServer(options = {}) {
  const input = options.input || process.stdin;
  const transport = options.transport || new StdioAppServerTransport(options);
  const server =
    options.server ||
    new CcAppServer({
      ...options,
      send: (message) => transport.send(message),
    });
  const readline = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  let fatal = null;
  try {
    for await (const line of readline) {
      if (Buffer.byteLength(line, "utf8") > transport.maxLineBytes) {
        await transport.send(
          rpcError(
            null,
            new JsonRpcError(
              JSON_RPC_ERROR.INVALID_REQUEST,
              "JSON-RPC line exceeds the transport limit",
            ),
          ),
        );
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        await transport.send(
          rpcError(
            null,
            new JsonRpcError(JSON_RPC_ERROR.PARSE_ERROR, "Invalid JSON"),
          ),
        );
        continue;
      }
      const request = Promise.resolve(server.receive(message)).catch(
        (error) => {
          fatal ||= error;
        },
      );
      pending.add(request);
      request.finally(() => pending.delete(request));
    }
    await Promise.all(pending);
  } finally {
    readline.close();
    await server.close();
    await transport.close();
  }
  if (fatal) throw fatal;
  return server.status();
}
