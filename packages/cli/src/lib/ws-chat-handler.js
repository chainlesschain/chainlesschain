/**
 * WebSocket Chat Handler
 *
 * Handles simple streaming chat sessions over WebSocket.
 * Consumes chat-core's chatStream generator.
 */

import { chatWithStreaming } from "./chat-core.js";

export class WSChatHandler {
  /**
   * @param {object} options
   * @param {import("./ws-session-manager.js").Session} options.session
   * @param {import("./interaction-adapter.js").WebSocketInteractionAdapter} options.interaction
   */
  constructor({ session, interaction }) {
    this.session = session;
    this.interaction = interaction;
    this._processing = false;
  }

  /**
   * Handle a user message — stream the response.
   *
   * @param {string} userMessage
   * @param {string} [requestId]
   */
  async handleMessage(userMessage, requestId) {
    if (this._processing) {
      this.interaction.emit("error", {
        requestId,
        code: "BUSY",
        message: "Session is currently processing a message",
      });
      return;
    }

    this._processing = true;

    try {
      const { session } = this;
      session.messages.push({ role: "user", content: userMessage });

      const options = {
        provider: session.provider,
        model: session.model,
        baseUrl: session.baseUrl || "http://localhost:11434",
        apiKey: session.apiKey,
        // Phase J — pipe WS session id so chat-core records token_usage
        // into the JSONL session store; visible via `cc session usage`.
        sessionId: session.sessionId || session.id,
      };

      const fullContent = await chatWithStreaming(
        session.messages,
        options,
        (event) => {
          if (event.type === "response-token") {
            this.interaction.emit("response-token", {
              requestId,
              token: event.token,
            });
          }
        },
      );

      session.messages.push({ role: "assistant", content: fullContent });
      this.interaction.emit("response-complete", {
        requestId,
        content: fullContent,
      });

      session.lastActivity = new Date().toISOString();
    } catch (err) {
      this.interaction.emit("error", {
        requestId,
        code: "CHAT_ERROR",
        message: err.message,
      });
    } finally {
      this._processing = false;
    }
  }

  /**
   * Handle slash commands.
   *
   * @param {string} command
   * @param {string} [requestId]
   */
  handleSlashCommand(command, requestId) {
    const [cmd, ...args] = command.trim().split(/\s+/);
    const arg = args.join(" ").trim();
    const { session } = this;

    switch (cmd) {
      case "/model":
        if (arg) session.model = arg;
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { model: session.model },
        });
        break;

      case "/provider":
        if (arg) session.provider = arg;
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { provider: session.provider },
        });
        break;

      case "/clear":
        session.messages.length = 0;
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { cleared: true },
        });
        break;

      case "/history":
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: {
            messages: session.messages.map((m) => ({
              role: m.role,
              content:
                m.content.length > 200
                  ? m.content.substring(0, 200) + "..."
                  : m.content,
            })),
          },
        });
        break;

      default:
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { error: `Unknown command: ${cmd}` },
        });
    }
  }
}
