/**
 * DingTalk (钉钉) Notifier — sends notifications via 钉钉群机器人 Webhook.
 *
 * Configure via env:
 *   DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx
 *   DINGTALK_SECRET=SECxxx   (optional, if "加签" is enabled)
 *
 * If DINGTALK_SECRET is set, each request is signed with HMAC-SHA256.
 */

import crypto from "crypto";

export class DingTalkNotifier {
  constructor(options = {}) {
    this.webhookUrl =
      options.webhookUrl || process.env.DINGTALK_WEBHOOK_URL || "";
    this.secret = options.secret || process.env.DINGTALK_SECRET || "";
  }

  get isConfigured() {
    return Boolean(this.webhookUrl);
  }

  /** Compute timestamp + sign query params (required when 加签 is on). */
  _signedUrl() {
    if (!this.secret) return this.webhookUrl;
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${this.secret}`;
    const sign = crypto
      .createHmac("sha256", this.secret)
      .update(stringToSign)
      .digest("base64");
    const encodedSign = encodeURIComponent(sign);
    const sep = this.webhookUrl.includes("?") ? "&" : "?";
    return `${this.webhookUrl}${sep}timestamp=${timestamp}&sign=${encodedSign}`;
  }

  /**
   * Send a markdown card message.
   * @param {string} title
   * @param {string} text  - Markdown body
   */
  async send(title, text) {
    if (!this.isConfigured) return { ok: false, reason: "not configured" };
    try {
      const res = await fetch(this._signedUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: { title, text },
          at: { isAtAll: false },
        }),
      });
      const data = await res.json();
      return { ok: data.errcode === 0, data };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async notifySuccess(summary) {
    const { taskId, description, agentCount = 1, duration } = summary;
    const mins = duration ? Math.round(duration / 60_000) : "?";
    return this.send(
      "✅ CI 通过",
      `## ✅ CI 通过\n` +
        `**任务**: ${description.slice(0, 100)}\n` +
        `**Agent**: ${agentCount} 个  **耗时**: ${mins}m\n` +
        `**ID**: ${taskId}`,
    );
  }

  async notifyFailure(summary) {
    const { taskId, description, errors = [], retryNumber = 1 } = summary;
    const errLines = errors
      .slice(0, 3)
      .map((e) => `- ${e.slice(0, 120)}`)
      .join("\n");
    return this.send(
      `❌ CI 失败 (重试 #${retryNumber})`,
      `## ❌ CI 失败\n` +
        `**任务**: ${description.slice(0, 100)}\n` +
        (errLines ? `**错误**:\n${errLines}\n` : "") +
        `**ID**: ${taskId}`,
    );
  }

  async notifyStart(summary) {
    const { taskId, description, subtaskCount = 1 } = summary;
    return this.send(
      "🚀 开始编排",
      `## 🚀 开始编排\n` +
        `**任务**: ${description.slice(0, 100)}\n` +
        `**子任务数**: ${subtaskCount}\n` +
        `**ID**: ${taskId}`,
    );
  }
}
