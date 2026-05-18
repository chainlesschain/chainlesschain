/**
 * NotificationManager — unified multi-channel notification dispatcher.
 *
 * Supported channels:
 *   telegram  — Telegram Bot API
 *   wecom     — 企业微信群机器人 Webhook
 *   dingtalk  — 钉钉群机器人 Webhook (支持加签)
 *   feishu    — 飞书群机器人 Webhook (支持签名校验)
 *   websocket — Real-time push back over the triggering WS connection
 *
 * Supported incoming command sources (via HTTP Webhook receiver):
 *   wecom     — 企业微信 回调 (XML format)
 *   dingtalk  — 钉钉 outgoing webhook
 *   feishu    — 飞书 event subscription
 *
 * Configuration (any combination via env vars or options):
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *   WECOM_WEBHOOK_URL
 *   DINGTALK_WEBHOOK_URL  [+ DINGTALK_SECRET]
 *   FEISHU_WEBHOOK_URL    [+ FEISHU_SECRET]
 *
 * Usage:
 *   const nm = NotificationManager.fromEnv();
 *   await nm.notifySuccess({ taskId, description, ... });
 *
 *   // With WebSocket channel:
 *   nm.addWebSocketChannel({ send: (data) => ws._send(ws, data), requestId });
 */

import { TelegramNotifier } from "./telegram.js";
import { WeComNotifier } from "./wecom.js";
import { DingTalkNotifier } from "./dingtalk.js";
import { FeishuNotifier } from "./feishu.js";
import { WebSocketNotifier } from "./websocket.js";

// ─── Incoming command parsers ─────────────────────────────────────

/**
 * Parse a 钉钉 outgoing webhook payload into a command string.
 * DingTalk sends: { msgtype: "text", text: { content: "..." }, ... }
 */
export function parseDingTalkIncoming(body) {
  if (body?.msgtype === "text") {
    return body.text?.content?.trim() || null;
  }
  return null;
}

/**
 * Parse a 飞书 event subscription payload into a command string.
 * Feishu sends: { event: { message: { content: '{"text":"..."}' } } }
 */
export function parseFeishuIncoming(body) {
  try {
    const content = body?.event?.message?.content;
    if (content) {
      const parsed = JSON.parse(content);
      return parsed.text?.trim() || null;
    }
  } catch (_err) {
    // ignore
  }
  return null;
}

/**
 * Parse a 企业微信 回调 XML body into a command string.
 * WeCom sends XML; this extracts the <Content> field using simple regex
 * (no heavy XML parser needed for plain text messages).
 */
export function parseWeComIncoming(xmlBody) {
  const match = String(xmlBody).match(
    /<Content><!\[CDATA\[([^\]]*)\]\]><\/Content>/,
  );
  return match ? match[1].trim() : null;
}

// ─── Notification Manager ─────────────────────────────────────────

export class NotificationManager {
  constructor() {
    /** @type {Array<object>} registered notifier instances */
    this._channels = [];
  }

  /**
   * Build a NotificationManager from environment variables.
   * Any configured channel is automatically added.
   */
  static fromEnv(options = {}) {
    const nm = new NotificationManager();

    const telegram = new TelegramNotifier(options.telegram || {});
    if (telegram.isConfigured) nm.add("telegram", telegram);

    const wecom = new WeComNotifier(options.wecom || {});
    if (wecom.isConfigured) nm.add("wecom", wecom);

    const dingtalk = new DingTalkNotifier(options.dingtalk || {});
    if (dingtalk.isConfigured) nm.add("dingtalk", dingtalk);

    const feishu = new FeishuNotifier(options.feishu || {});
    if (feishu.isConfigured) nm.add("feishu", feishu);

    return nm;
  }

  /**
   * Register a notifier under a name.
   * @param {string} name
   * @param {object} notifier - must implement notifySuccess/notifyFailure/notifyStart
   */
  add(name, notifier) {
    // Remove existing channel with same name before re-adding
    this._channels = this._channels.filter((c) => c.name !== name);
    this._channels.push({ name, notifier });
    return this;
  }

  /**
   * Add (or replace) the WebSocket channel.
   * Call this when an orchestration task is triggered from a WS connection.
   *
   * @param {object} options
   * @param {Function} options.send      - (data: object) => void
   * @param {string}  [options.requestId] - correlating request ID
   */
  addWebSocketChannel(options) {
    const notifier = new WebSocketNotifier(options);
    this.add("websocket", notifier);
    return notifier; // caller may use directly for agent output streaming
  }

  /** Remove a channel by name. */
  remove(name) {
    this._channels = this._channels.filter((c) => c.name !== name);
    return this;
  }

  /** List active channel names. */
  get activeChannels() {
    return this._channels.map((c) => c.name);
  }

  get isConfigured() {
    return this._channels.length > 0;
  }

  // ─── Broadcast methods ──────────────────────────────────────────

  /** Fan-out to all channels; collect results. */
  async _broadcast(method, payload) {
    const results = await Promise.allSettled(
      this._channels.map(({ name, notifier }) =>
        notifier[method]?.(payload)
          .then((r) => ({ channel: name, ...r }))
          .catch((err) => ({ channel: name, ok: false, reason: err.message })),
      ),
    );
    return results.map((r) =>
      r.status === "fulfilled" ? r.value : { ok: false, ...r.reason },
    );
  }

  async notifyStart(summary) {
    return this._broadcast("notifyStart", summary);
  }

  async notifySuccess(summary) {
    return this._broadcast("notifySuccess", summary);
  }

  async notifyFailure(summary) {
    return this._broadcast("notifyFailure", summary);
  }
}

// Re-export individual notifiers for direct use
export { TelegramNotifier } from "./telegram.js";
export { WeComNotifier } from "./wecom.js";
export { DingTalkNotifier } from "./dingtalk.js";
export { FeishuNotifier } from "./feishu.js";
export { WebSocketNotifier } from "./websocket.js";
