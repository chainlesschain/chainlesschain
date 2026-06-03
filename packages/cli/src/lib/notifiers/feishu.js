/**
 * Feishu (飞书) Notifier — sends notifications via 飞书群机器人 Webhook.
 *
 * Configure via env:
 *   FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
 *   FEISHU_SECRET=xxx   (optional, if 签名校验 is enabled)
 *
 * Sends rich "interactive card" messages for good formatting.
 */

import crypto from "crypto";

export class FeishuNotifier {
  constructor(options = {}) {
    this.webhookUrl =
      options.webhookUrl || process.env.FEISHU_WEBHOOK_URL || "";
    this.secret = options.secret || process.env.FEISHU_SECRET || "";
  }

  get isConfigured() {
    return Boolean(this.webhookUrl);
  }

  /** Compute sign for 签名校验 mode. */
  _sign(timestamp) {
    if (!this.secret) return undefined;
    const str = `${timestamp}\n${this.secret}`;
    return crypto.createHmac("sha256", str).update("").digest("base64");
  }

  /**
   * Send an interactive card message.
   * @param {string} header  - Card header title
   * @param {string[]} lines - Content lines (markdown-ish)
   * @param {"green"|"red"|"blue"|"yellow"} color - Header color
   */
  async send(header, lines, color = "blue") {
    if (!this.isConfigured) return { ok: false, reason: "not configured" };

    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = this._sign(timestamp);

    const payload = {
      timestamp,
      ...(sign ? { sign } : {}),
      msg_type: "interactive",
      card: {
        header: {
          title: { tag: "plain_text", content: header },
          template: color,
        },
        elements: lines.map((line) => ({
          tag: "div",
          text: { tag: "lark_md", content: line },
        })),
      },
    };

    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return { ok: data.code === 0 || data.StatusCode === 0, data };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async notifySuccess(summary) {
    const { taskId, description, agentCount = 1, duration } = summary;
    const mins = duration ? Math.round(duration / 60_000) : "?";
    return this.send(
      "✅ CI 通过",
      [
        `**任务**: ${description.slice(0, 100)}`,
        `**Agent 数**: ${agentCount}  **耗时**: ${mins}m`,
        `**ID**: \`${taskId}\``,
      ],
      "green",
    );
  }

  async notifyFailure(summary) {
    const { taskId, description, errors = [], retryNumber = 1 } = summary;
    const errLines = errors.slice(0, 3).map((e) => `- ${e.slice(0, 120)}`);
    return this.send(
      `❌ CI 失败（第 ${retryNumber} 次重试）`,
      [
        `**任务**: ${description.slice(0, 100)}`,
        errors.length ? `**错误**:\n${errLines.join("\n")}` : "",
        `**ID**: \`${taskId}\``,
      ].filter(Boolean),
      "red",
    );
  }

  async notifyStart(summary) {
    const { taskId, description, subtaskCount = 1 } = summary;
    return this.send(
      "🚀 开始编排",
      [
        `**任务**: ${description.slice(0, 100)}`,
        `**子任务数**: ${subtaskCount}`,
        `**ID**: \`${taskId}\``,
      ],
      "blue",
    );
  }
}
