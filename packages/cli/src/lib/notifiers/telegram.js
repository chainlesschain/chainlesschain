/**
 * Telegram Notifier — sends CI pass/fail notifications via Telegram Bot API.
 *
 * Configure via .chainlesschain/config.json:
 *   { "telegramBotToken": "...", "telegramChatId": "..." }
 * or environment variables:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */

const TELEGRAM_API = "https://api.telegram.org";

export class TelegramNotifier {
  /**
   * @param {object} options
   * @param {string} options.token  - Bot token (from BotFather)
   * @param {string} options.chatId - Chat/group/channel ID
   */
  constructor(options = {}) {
    this.token = options.token || process.env.TELEGRAM_BOT_TOKEN || "";
    this.chatId = options.chatId || process.env.TELEGRAM_CHAT_ID || "";
  }

  get isConfigured() {
    return Boolean(this.token && this.chatId);
  }

  /**
   * Send a raw text message (Markdown V2).
   * @param {string} text
   */
  async send(text) {
    if (!this.isConfigured) return { ok: false, reason: "not configured" };

    try {
      const res = await fetch(`${TELEGRAM_API}/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: "HTML",
        }),
      });
      const data = await res.json();
      return { ok: data.ok, data };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Notify that a task's CI pipeline passed.
   * @param {object} summary
   * @param {string} summary.taskId
   * @param {string} summary.description   - Short task description
   * @param {number} summary.agentCount    - How many agents worked on it
   * @param {number} summary.duration      - Total ms
   * @param {string[]} summary.filesChanged
   */
  async notifySuccess(summary) {
    const {
      taskId,
      description,
      agentCount = 1,
      duration,
      filesChanged = [],
    } = summary;
    const mins = duration ? Math.round(duration / 60_000) : "?";
    const files = filesChanged.length
      ? `\n📁 <b>Files:</b> ${filesChanged.slice(0, 5).join(", ")}${filesChanged.length > 5 ? ` +${filesChanged.length - 5} more` : ""}`
      : "";

    const text =
      `✅ <b>CI Passed</b>\n` +
      `📝 <b>Task:</b> ${_escape(description)}\n` +
      `🤖 <b>Agents:</b> ${agentCount}  ⏱ <b>Time:</b> ${mins}m` +
      files +
      `\n🔑 <code>${taskId}</code>`;

    return this.send(text);
  }

  /**
   * Notify that CI failed and agents are being retried.
   * @param {object} summary
   * @param {string} summary.taskId
   * @param {string} summary.description
   * @param {string[]} summary.errors     - CI error messages
   * @param {number} summary.retryNumber  - Which retry attempt
   */
  async notifyFailure(summary) {
    const { taskId, description, errors = [], retryNumber = 1 } = summary;
    const errPreview = errors
      .slice(0, 3)
      .map((e) => `  • ${_escape(e.slice(0, 120))}`)
      .join("\n");

    const text =
      `❌ <b>CI Failed</b> (retry #${retryNumber})\n` +
      `📝 <b>Task:</b> ${_escape(description)}\n` +
      (errPreview ? `\n<b>Errors:</b>\n${errPreview}\n` : "") +
      `🔄 Dispatching fix to agents…\n` +
      `🔑 <code>${taskId}</code>`;

    return this.send(text);
  }

  /**
   * Notify that orchestration is starting.
   * @param {object} summary
   * @param {string} summary.taskId
   * @param {string} summary.description
   * @param {number} summary.subtaskCount
   */
  async notifyStart(summary) {
    const { taskId, description, subtaskCount = 1 } = summary;
    const text =
      `🚀 <b>Orchestration Started</b>\n` +
      `📝 <b>Task:</b> ${_escape(description)}\n` +
      `🤖 <b>Subtasks:</b> ${subtaskCount}\n` +
      `🔑 <code>${taskId}</code>`;
    return this.send(text);
  }
}

function _escape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
