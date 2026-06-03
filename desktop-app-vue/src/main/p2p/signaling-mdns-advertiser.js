const { logger } = require("../utils/logger.js");

/**
 * mDNS / Bonjour advertiser for the embedded signaling WebSocket server.
 *
 * Publishes service `_chainlesschain-signaling._tcp.local` so Android
 * (NsdManager) and other LAN peers can discover this desktop's signaling
 * URL without manual IP configuration.
 *
 * TXT record fields:
 *   did   — desktop's DID (so client can pre-fill expected peer DID)
 *   ver   — protocol version (currently '1')
 *   path  — WebSocket path (currently '/' but reserved)
 *
 * Phase 3d v1.3 (Mobile auto-discovery, 2026-05-10).
 */

const SERVICE_TYPE = "chainlesschain-signaling";
const SERVICE_PROTOCOL = "tcp";

class SignalingMdnsAdvertiser {
  constructor() {
    this._bonjour = null;
    this._service = null;
  }

  /**
   * Publish the signaling service to the LAN.
   *
   * @param {Object} opts
   * @param {number} opts.port  signaling WS server port (e.g. 9001)
   * @param {string} opts.did   self DID, embedded as TXT record
   * @param {string} [opts.name] friendly device name (default os.hostname)
   */
  async publish({ port, did, name } = {}) {
    if (!port) {
      logger.warn("[SignalingMdns] publish() called without port — skip");
      return;
    }
    if (this._service) {
      logger.warn("[SignalingMdns] already publishing — unpublish first");
      return;
    }
    try {
      const { Bonjour } = require("bonjour-service");
      this._bonjour = new Bonjour();
      const os = require("os");
      const friendlyName = name || os.hostname() || "ChainlessChain Desktop";
      this._service = this._bonjour.publish({
        name: friendlyName,
        type: SERVICE_TYPE,
        protocol: SERVICE_PROTOCOL,
        port,
        txt: {
          did: did || "",
          ver: "1",
          path: "/",
        },
      });
      this._service.on("up", () => {
        logger.info(
          `[SignalingMdns] ✓ advertised _${SERVICE_TYPE}._${SERVICE_PROTOCOL}.local on port ${port} as "${friendlyName}"`,
        );
      });
      this._service.on("error", (err) => {
        logger.warn("[SignalingMdns] advertiser error:", err?.message || err);
      });
    } catch (err) {
      logger.error(
        "[SignalingMdns] publish failed (mDNS unavailable):",
        err?.message || err,
      );
      this._bonjour = null;
      this._service = null;
    }
  }

  /**
   * Stop advertising. Idempotent.
   */
  async unpublish() {
    if (this._service) {
      try {
        await new Promise((resolve) => {
          try {
            this._service.stop(() => resolve());
          } catch (e) {
            logger.warn("[SignalingMdns] service.stop threw:", e?.message || e);
            resolve();
          }
        });
      } catch (e) {
        logger.warn("[SignalingMdns] unpublish error:", e?.message || e);
      }
      this._service = null;
    }
    if (this._bonjour) {
      try {
        this._bonjour.destroy();
      } catch (e) {
        logger.warn("[SignalingMdns] bonjour.destroy error:", e?.message || e);
      }
      this._bonjour = null;
    }
  }
}

module.exports = {
  SignalingMdnsAdvertiser,
  SERVICE_TYPE,
  SERVICE_PROTOCOL,
};
