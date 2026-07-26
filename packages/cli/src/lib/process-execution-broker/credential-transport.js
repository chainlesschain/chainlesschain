/**
 * Authenticated local transport for broker-issued credential references.
 *
 * A worker thread hosts the pipe so spawnSync children can resolve a reference
 * while the broker's main JavaScript thread is blocked.
 */

import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

const TRANSPORT_VERSION = "local-ipc-v1";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function transportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function credentialTransportEndpoint(agentId, options = {}) {
  const platform = options.platform || process.platform;
  const safeId = crypto
    .createHash("sha256")
    .update(String(agentId))
    .digest("hex")
    .slice(0, 24);
  if (platform === "win32") return `\\\\.\\pipe\\cc-cred-${safeId}`;
  return path.join(options.tmpdir || os.tmpdir(), `cc-cred-${safeId}.sock`);
}

export class CredentialTransport {
  constructor(options = {}) {
    if (!options.agentId) {
      throw transportError(
        "CC_CREDENTIAL_INVALID_REQUEST",
        "Credential transport requires an agent id",
      );
    }
    this.agentId = String(options.agentId);
    this.platform = options.platform || process.platform;
    this.endpoint =
      options.endpoint ||
      credentialTransportEndpoint(this.agentId, {
        platform: this.platform,
        tmpdir: options.tmpdir,
      });
    this.version = TRANSPORT_VERSION;
    this.ready = false;
    this.closed = false;
    this.error = null;
    this._onAudit =
      typeof options.onAudit === "function" ? options.onAudit : () => {};
    this._onSettlement =
      typeof options.onSettlement === "function"
        ? options.onSettlement
        : () => {};
    this._workerFactory =
      options.workerFactory ||
      ((url, workerOptions) => new Worker(url, workerOptions));

    this._readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this._readyPromise.catch(() => {});

    try {
      this._worker = this._workerFactory(
        new URL("./credential-transport-worker.js", import.meta.url),
        {
          type: "module",
          workerData: {
            agentId: this.agentId,
            endpoint: this.endpoint,
            platform: this.platform,
          },
        },
      );
      this._worker.on("message", (message) =>
        this._handleWorkerMessage(message),
      );
      this._worker.on("error", (error) => this._handleWorkerFailure(error));
      this._worker.on("exit", (code) => {
        if (!this.closed && code !== 0) {
          this._handleWorkerFailure(
            transportError(
              "CC_CREDENTIAL_TRANSPORT_UNAVAILABLE",
              `Credential transport worker exited with code ${code}`,
            ),
          );
        }
      });
      this._worker.unref?.();
    } catch (error) {
      this._handleWorkerFailure(error);
    }
  }

  _handleWorkerMessage(message) {
    if (message?.type === "ready") {
      this.ready = true;
      this._resolveReady(this);
      return;
    }
    if (message?.type === "audit" && message.entry) {
      this._onAudit(message.entry);
      return;
    }
    if (message?.type === "settlement") {
      this._onSettlement(message);
      return;
    }
    if (message?.type === "fatal") {
      this._handleWorkerFailure(
        transportError(
          message.error?.code || "CC_CREDENTIAL_TRANSPORT_UNAVAILABLE",
          message.error?.message || "Credential transport failed",
        ),
      );
    }
  }

  _handleWorkerFailure(error) {
    if (this.error) return;
    this.error = transportError(
      error?.code || "CC_CREDENTIAL_TRANSPORT_UNAVAILABLE",
      error?.message || "Credential transport is unavailable",
    );
    this.ready = false;
    this._rejectReady(this.error);
  }

  isAvailable() {
    return Boolean(this._worker && !this.closed && !this.error);
  }

  waitUntilReady() {
    return this._readyPromise;
  }

  createCapabilityToken() {
    if (!this.isAvailable()) {
      throw (
        this.error ||
        transportError(
          "CC_CREDENTIAL_TRANSPORT_UNAVAILABLE",
          "Credential transport is unavailable",
        )
      );
    }
    return crypto.randomBytes(32).toString("base64url");
  }

  registerCredential(record) {
    if (!this.isAvailable()) {
      throw (
        this.error ||
        transportError(
          "CC_CREDENTIAL_TRANSPORT_UNAVAILABLE",
          "Credential transport is unavailable",
        )
      );
    }
    this._worker.postMessage({ type: "register", record });
  }

  updateCredential(refId, state) {
    if (!this.isAvailable()) return;
    this._worker.postMessage({
      type: "update",
      refId,
      useCount: state.useCount,
      status: state.status,
    });
  }

  revokeCredential(refId) {
    if (!this.isAvailable()) return;
    this._worker.postMessage({ type: "revoke", refId });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (!this._worker) return;
    const worker = this._worker;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      const onMessage = (message) => {
        if (message?.type !== "closed") return;
        clearTimeout(timer);
        worker.removeListener("message", onMessage);
        resolve();
      };
      worker.on("message", onMessage);
      worker.postMessage({ type: "close" });
    });
    await worker.terminate();
    this.ready = false;
  }

  getInfo() {
    return {
      version: this.version,
      endpoint: this.endpoint,
      available: this.isAvailable(),
      ready: this.ready,
      error: this.error
        ? {
            code: this.error.code,
            message: this.error.message,
          }
        : null,
    };
  }
}

function connectOnce(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint);
    const onError = (error) => {
      socket.removeListener("connect", onConnect);
      reject(error);
    };
    const onConnect = () => {
      socket.removeListener("error", onError);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

async function connectWithRetry(endpoint, deadline) {
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await connectOnce(endpoint);
    } catch (error) {
      lastError = error;
      const retryable = ["ENOENT", "ECONNREFUSED", "EPIPE"].includes(
        error?.code,
      );
      if (!retryable) throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
  }
  throw (
    lastError ||
    transportError(
      "CC_CREDENTIAL_TRANSPORT_UNAVAILABLE",
      "Credential transport connection timed out",
    )
  );
}

/**
 * Resolve one reference using only the capability material inherited by the
 * approved target process.
 */
export async function resolveCredentialRefOverTransport(refId, options = {}) {
  const env = options.env || process.env;
  const endpoint = options.endpoint || env.CC_CREDENTIAL_ENDPOINT;
  const capabilityToken =
    options.capabilityToken || env.CC_CREDENTIAL_AUTH_TOKEN;
  const agentId = options.agentId || env.CC_CREDENTIAL_AGENT_ID;
  const processTarget =
    options.process ||
    options.processTarget ||
    env.CC_CREDENTIAL_TARGET_PROCESS;
  const host =
    options.host !== undefined
      ? options.host
      : env.CC_CREDENTIAL_TARGET_HOST || null;
  const timeoutMs = Math.max(
    1,
    Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
  );

  if (!endpoint || !capabilityToken || !agentId || !processTarget || !refId) {
    throw transportError(
      "CC_CREDENTIAL_INVALID_REQUEST",
      "Credential transport environment is incomplete",
    );
  }

  const deadline = Date.now() + timeoutMs;
  const socket = await connectWithRetry(endpoint, deadline);
  return await new Promise((resolve, reject) => {
    let settled = false;
    let carry = "";
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => {
        finish(
          transportError(
            "CC_CREDENTIAL_TRANSPORT_TIMEOUT",
            "Credential transport response timed out",
          ),
        );
      },
      Math.max(1, deadline - Date.now()),
    );
    timer.unref?.();
    socket.on("data", (chunk) => {
      carry += chunk.toString("utf8");
      if (Buffer.byteLength(carry, "utf8") > MAX_RESPONSE_BYTES) {
        finish(
          transportError(
            "CC_CREDENTIAL_INVALID_REQUEST",
            "Credential transport response is too large",
          ),
        );
        return;
      }
      const newline = carry.indexOf("\n");
      if (newline === -1) return;
      let response;
      try {
        response = JSON.parse(carry.slice(0, newline).replace(/\r$/, ""));
      } catch {
        finish(
          transportError(
            "CC_CREDENTIAL_INVALID_REQUEST",
            "Credential transport returned invalid JSON",
          ),
        );
        return;
      }
      if (!response.ok) {
        finish(
          transportError(
            response.code || "CC_CREDENTIAL_TRANSPORT_UNAVAILABLE",
            response.message || "Credential transport denied the request",
          ),
        );
        return;
      }
      finish(null, response.value);
    });
    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled) {
        finish(
          transportError(
            "CC_CREDENTIAL_TRANSPORT_UNAVAILABLE",
            "Credential transport closed without a response",
          ),
        );
      }
    });
    socket.write(
      `${JSON.stringify({
        type: "resolve",
        refId,
        agentId,
        capabilityToken,
        process: processTarget,
        host,
      })}\n`,
    );
  });
}

export { TRANSPORT_VERSION };
