/**
 * agent-notify — shared backing for the `notify` agent tool + `cc agenda`
 * monitor firing (gap-analysis 第四阶段 #3).
 *
 * Fans a notification out over the user's configured multi-channel notifiers
 * (Telegram / WeCom / DingTalk / Feishu, via NotificationManager.fromEnv) and,
 * when a paired-device push descriptor exists, the mobile push bridge. Pure
 * over injected deps so it is unit-testable without any network.
 */

import { NotificationManager } from "./notifiers/index.js";

/**
 * @param {{title:string, body?:string, level?:"info"|"success"|"failure"}} msg
 * @param {{env?:object, manager?:object}} [deps]
 * @returns {Promise<{delivered:string[], failed:string[], channels:number, results:Array}>}
 */
export async function sendAgentNotification(msg, deps = {}) {
  const title = String(msg?.title || "").trim();
  if (!title) throw new Error("notify requires a title");
  const body = msg?.body ? String(msg.body) : "";
  const level = ["info", "success", "failure"].includes(msg?.level)
    ? msg.level
    : "info";

  const manager =
    deps.manager ||
    NotificationManager.fromEnv({ env: deps.env || process.env });
  if (!manager.isConfigured) {
    return {
      delivered: [],
      failed: [],
      channels: 0,
      results: [],
      note: "No notification channels configured (set TELEGRAM_BOT_TOKEN / WECOM_WEBHOOK_URL / DINGTALK_WEBHOOK_URL / FEISHU_WEBHOOK_URL).",
    };
  }

  const summary = {
    taskId: msg?.taskId || null,
    description: title,
    detail: body,
    message: body || title,
    title,
  };
  const method =
    level === "success"
      ? "notifySuccess"
      : level === "failure"
        ? "notifyFailure"
        : "notifyStart";
  const results = await manager[method](summary);

  const delivered = [];
  const failed = [];
  for (const r of results || []) {
    if (r && r.ok !== false) delivered.push(r.channel);
    else failed.push(r?.channel || "unknown");
  }
  return {
    delivered,
    failed,
    channels: (manager.activeChannels || []).length,
    results: results || [],
  };
}
