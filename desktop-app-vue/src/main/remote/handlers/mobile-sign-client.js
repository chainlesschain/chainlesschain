/**
 * Mobile Sign Client — 桌面发起反向 sign.request RPC，让 Android StrongBox 签名。
 *
 * 设计文档 v0.2 ADR-6 + §5.5：桌面 U-Key 仅 Windows，macOS/Linux 无硬件签名路径。
 * 让 Android 当"跨平台 USB key"：大额 marketplace 操作 / DID delegate 等高敏行为
 * 由桌面发起 → 推送到已配对 Android → 用户 ApprovalUI 二次确认 + StrongBox/TEE 硬件
 * 签名 → 反向 RPC 把签名回桌面。
 *
 * Transport 抽象：
 *  - 注入 `transport.send(peerId, jsonRpcRequest) → Promise<jsonRpcResponse>`
 *  - 真实实现：mobile-bridge.js 的 WebRTC DataChannel 反向 RPC 路径（M5 wire-up commit）
 *  - 测试实现：fake transport 返回 scripted 响应
 *
 * Envelope (jsonrpc 2.0)：
 *   method: "sign.request"
 *   params: { payloadHash:hex32, description, requireStrongBox }
 *   result: { approved, did, signature(b64), signedAt, deniedReason }
 *
 * @module remote/handlers/mobile-sign-client
 */

const crypto = require("crypto");

const DEFAULT_TIMEOUT_MS = 60_000;
const PAYLOAD_HASH_HEX_LEN = 64; // SHA-256 = 32 bytes = 64 hex chars

/** 反向 RPC 调用失败（transport 异常 / 协议错误）。 */
class SignError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "SignError";
    this.code = code;
  }
}

/** 用户在 ApprovalUI 拒绝 / 反向 RPC 业务侧 approved=false。 */
class SignDeniedError extends Error {
  constructor(reason, result = null) {
    super(`Sign request denied: ${reason}`);
    this.name = "SignDeniedError";
    this.reason = reason;
    this.result = result;
  }
}

/** 反向 RPC 超时（默认 60s，覆盖 BiometricPrompt 慢用户）。 */
class SignTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "SignTimeoutError";
  }
}

class MobileSignClient {
  /**
   * @param {Object} options
   * @param {Object} options.transport - 必须有 send(peerId, request) → Promise
   * @param {number} [options.timeoutMs=60000] - 反向 RPC 超时
   */
  constructor(options = {}) {
    const { transport, timeoutMs } = options;
    if (!transport || typeof transport.send !== "function") {
      throw new Error(
        "MobileSignClient requires options.transport with send(peerId, request) → Promise",
      );
    }
    this.transport = transport;
    this.timeoutMs =
      typeof timeoutMs === "number" && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS;
  }

  /**
   * 发起签名请求。
   *
   * @param {Object} args
   * @param {string} args.peerId - 目标 Android 设备 ID（来自 device pairing）
   * @param {string} args.payloadHash - 待签名内容的 SHA-256 hex（64 chars）
   * @param {string} [args.description] - UI 展示用一行描述，如 "购买 X，金额 25"
   * @param {boolean} [args.requireStrongBox=false] - 强制要求 StrongBox 硬件签名
   * @returns {Promise<{did, signature, signedAt}>}
   * @throws {SignError | SignDeniedError | SignTimeoutError}
   */
  async requestSignature(args = {}) {
    const { peerId, payloadHash, description, requireStrongBox } = args;
    if (!peerId || typeof peerId !== "string") {
      throw new SignError("peerId is required");
    }
    if (
      typeof payloadHash !== "string" ||
      payloadHash.length !== PAYLOAD_HASH_HEX_LEN
    ) {
      throw new SignError(
        `payloadHash must be ${PAYLOAD_HASH_HEX_LEN}-char hex (SHA-256), got ${
          typeof payloadHash === "string"
            ? payloadHash.length
            : typeof payloadHash
        }`,
      );
    }
    if (!/^[0-9a-fA-F]+$/.test(payloadHash)) {
      throw new SignError("payloadHash must be valid hex");
    }

    const requestId = `sign-${crypto.randomUUID()}`;
    const request = {
      jsonrpc: "2.0",
      id: requestId,
      method: "sign.request",
      params: {
        payloadHash: payloadHash.toLowerCase(),
        description: typeof description === "string" ? description : "",
        requireStrongBox: !!requireStrongBox,
      },
    };

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new SignTimeoutError(
            `sign.request timed out after ${this.timeoutMs}ms (peerId=${peerId})`,
          ),
        );
      }, this.timeoutMs);
    });

    let response;
    try {
      response = await Promise.race([
        this.transport.send(peerId, request),
        timeoutPromise,
      ]);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof SignTimeoutError) {
        throw err;
      }
      // 包装 transport 异常
      throw new SignError(
        `Transport error: ${err.message || String(err)}`,
        err.code || null,
      );
    }
    clearTimeout(timer);

    if (!response || typeof response !== "object") {
      throw new SignError("Empty or non-object response from transport");
    }
    if (response.error) {
      throw new SignError(
        response.error.message || "Sign request errored",
        response.error.code || null,
      );
    }

    const result = response.result;
    if (!result || typeof result !== "object") {
      throw new SignError("Response missing result object");
    }
    if (!result.approved) {
      throw new SignDeniedError(result.deniedReason || "unknown", result);
    }
    if (!result.signature) {
      throw new SignError("Response approved but signature is missing");
    }
    if (!result.did) {
      throw new SignError("Response approved but did is missing");
    }

    return {
      did: result.did,
      signature: result.signature,
      signedAt: result.signedAt || Date.now(),
      requestId,
    };
  }

  /**
   * Utility：用 SHA-256 哈希待签名内容，返回 64-char hex（适合 requestSignature 入参）。
   */
  static hashPayload(payload) {
    const buf =
      typeof payload === "string" ? Buffer.from(payload, "utf-8") : payload;
    return crypto.createHash("sha256").update(buf).digest("hex");
  }
}

module.exports = {
  MobileSignClient,
  SignError,
  SignDeniedError,
  SignTimeoutError,
  DEFAULT_TIMEOUT_MS,
  PAYLOAD_HASH_HEX_LEN,
};
