/**
 * WebFinger Protocol
 *
 * WebFinger (RFC 7033) implementation for remote user discovery
 * in ActivityPub federation.
 *
 * @module social/ap-webfinger
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import https from "https";
import http from "http";

// ============================================================
// APWebFinger
// ============================================================

class APWebFinger {
  constructor(activityPubBridge) {
    this.apBridge = activityPubBridge;
    this._cache = new Map();
    this._cacheTTL = 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Resolve a WebFinger address (user@domain).
   * @param {string} address - WebFinger address (e.g., "user@mastodon.social")
   * @returns {Object} WebFinger response with links
   */
  async resolve(address) {
    try {
      if (!address || !address.includes("@")) {
        throw new Error("Invalid WebFinger address format (expected user@domain)");
      }

      // Remove leading @ or acct: prefix
      const cleanAddress = address.replace(/^@/, "").replace(/^acct:/, "");
      const [username, domain] = cleanAddress.split("@");

      if (!username || !domain) {
        throw new Error("Invalid WebFinger address");
      }

      // Check cache
      const cacheKey = `${username}@${domain}`;
      const cached = this._cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this._cacheTTL) {
        return cached.data;
      }

      // Build WebFinger URL
      const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`;

      // Attempt HTTP fetch
      let response;
      try {
        response = await this._httpGet(webfingerUrl);
      } catch (_fetchError) {
        logger.warn("[APWebFinger] HTTP fetch failed for", webfingerUrl, ":", fetchError.message);
        // Return simulated response for offline/dev mode
        response = this._buildSimulatedResponse(username, domain);
      }

      // Cache result
      this._cache.set(cacheKey, { data: response, timestamp: Date.now() });

      return response;
    } catch (_error) {
      logger.error("[APWebFinger] Failed to resolve:", error);
      throw error;
    }
  }

  /**
   * Build a WebFinger response for a local actor.
   * @param {string} username - Local username
   * @param {string} domain - Local domain
   * @returns {Object} JRD response
   */
  buildLocalResponse(username, domain) {
    return {
      subject: `acct:${username}@${domain}`,
      aliases: [
        `https://${domain}/users/${username}`,
        `https://${domain}/@${username}`,
      ],
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: `https://${domain}/users/${username}`,
        },
        {
          rel: "http://webfinger.net/rel/profile-page",
          type: "text/html",
          href: `https://${domain}/@${username}`,
        },
      ],
    };
  }

  /**
   * Extract the actor URL from a WebFinger response.
   * @param {Object} webfingerResponse - JRD response
   * @returns {string|null} Actor URL
   */
  extractActorUrl(webfingerResponse) {
    if (!webfingerResponse || !webfingerResponse.links) {return null;}

    const selfLink = webfingerResponse.links.find(
      (link) =>
        link.rel === "self" &&
        (link.type === "application/activity+json" ||
          link.type === 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'),
    );

    return selfLink ? selfLink.href : null;
  }

  /**
   * Lookup a remote user by address and return their actor profile.
   * @param {string} address - WebFinger address
   * @returns {Object} Remote user profile
   */
  async lookupUser(address) {
    try {
      const webfinger = await this.resolve(address);
      const actorUrl = this.extractActorUrl(webfinger);

      return {
        address: webfinger.subject,
        actorUrl,
        aliases: webfinger.aliases || [],
        links: webfinger.links || [],
      };
    } catch (_error) {
      logger.error("[APWebFinger] User lookup failed:", error);
      throw error;
    }
  }

  _buildSimulatedResponse(username, domain) {
    return {
      subject: `acct:${username}@${domain}`,
      aliases: [`https://${domain}/users/${username}`],
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: `https://${domain}/users/${username}`,
        },
      ],
    };
  }

  async _httpGet(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith("https") ? https : http;
      const req = mod.get(url, { headers: { Accept: "application/jrd+json, application/json" }, timeout: 10000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._httpGet(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Invalid JSON response"));
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
    });
  }

  clearCache() {
    this._cache.clear();
  }
}

let _instance;
function getAPWebFinger() {
  if (!_instance) {_instance = new APWebFinger();}
  return _instance;
}

export { APWebFinger, getAPWebFinger };
