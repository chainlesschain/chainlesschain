/**
 * WeCom (企业微信) Notifier — sends notifications via 企业微信群机器人 Webhook.
 *
 * Configure via env:
 *   WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
 * or options.webhookUrl
 */

export class WeComNotifier {
  constructor(options = {}) {
    this.webhookUrl = options.webhookUrl || process.env.WECOM_WEBHOOK_URL || "";
  }

  get isConfigured() {
    return Boolean(this.webhookUrl);
  }

  /**
   * Send a markdown message to the 企业微信 group bot.
   * @param {string} content - Markdown content (企业微信 subset)
   */
  async send(content) {
    if (!this.isConfigured) return { ok: false, reason: "not configured" };
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: { content },
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
    const content =
      `## ✅ CI 通过\n` +
      `**任务**: ${description.slice(0, 100)}\n` +
      `**Agent 数**: ${agentCount}  **耗时**: ${mins}m\n` +
      `**ID**: \`${taskId}\``;
    return this.send(content);
  }

  async notifyFailure(summary) {
    const { taskId, description, errors = [], retryNumber = 1 } = summary;
    const errLines = errors
      .slice(0, 3)
      .map((e) => `> ${e.slice(0, 100)}`)
      .join("\n");
    const content =
      `## ❌ CI 失败 (第 ${retryNumber} 次重试)\n` +
      `**任务**: ${description.slice(0, 100)}\n` +
      (errLines ? `**错误**:\n${errLines}\n` : "") +
      `**ID**: \`${taskId}\``;
    return this.send(content);
  }

  async notifyStart(summary) {
    const { taskId, description, subtaskCount = 1 } = summary;
    const content =
      `## 🚀 开始编排\n` +
      `**任务**: ${description.slice(0, 100)}\n` +
      `**子任务**: ${subtaskCount}\n` +
      `**ID**: \`${taskId}\``;
    return this.send(content);
  }
}
