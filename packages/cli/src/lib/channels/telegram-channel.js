/**
 * Telegram inbound channel — long-polls the Bot API (`getUpdates`) so no
 * public endpoint is needed, and turns allowed chats' messages into session
 * events.
 *
 * Trust boundary: `allowFrom` (array of chat ids) is REQUIRED — an inbound
 * channel with no allowlist would let anyone who finds the bot drive the
 * agent, so an empty/missing allowlist denies every update (fail closed).
 *
 * Replies: `handle.reply(event, text)` posts a sendMessage back to the
 * event's chat. fetch is injectable for tests.
 */

const POLL_TIMEOUT_S = 25;
const ERROR_BACKOFF_MS = 5000;
import { EventRuntimeProducer } from "../event-runtime-producer.js";

export async function startTelegramChannel(options = {}) {
  const {
    botToken = process.env.TELEGRAM_BOT_TOKEN,
    allowFrom,
    onEvent,
    log = () => {},
    fetchImpl = globalThis.fetch,
    pollTimeoutS = POLL_TIMEOUT_S,
    // Real macrotask pause between polls. The server-side long-poll dominates
    // in production; this exists so a fast-resolving fetch (tests, HTTP-level
    // failures) can never turn the loop into a microtask chain that starves
    // the event loop (timers, stop()) entirely.
    pollPauseMs = 50,
    eventRuntimeStore = null,
  } = options;
  const runtimeProducer = eventRuntimeStore
    ? new EventRuntimeProducer({ store: eventRuntimeStore })
    : null;

  if (!botToken) {
    throw new Error(
      "telegram channel needs a bot token (channels.telegram.botToken or TELEGRAM_BOT_TOKEN)",
    );
  }
  const allowed = new Set((allowFrom || []).map((id) => String(id)));
  if (allowed.size === 0) {
    throw new Error(
      "telegram channel needs channels.telegram.allowFrom (chat-id allowlist) — refusing to listen to everyone",
    );
  }

  const api = (method) => `https://api.telegram.org/bot${botToken}/${method}`;
  let stopped = false;
  let offset = 0;

  async function poll() {
    while (!stopped) {
      try {
        const res = await fetchImpl(api("getUpdates"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeout: pollTimeoutS, offset }),
        });
        const data = await res.json();
        if (!data?.ok || !Array.isArray(data.result)) {
          throw new Error(data?.description || `getUpdates HTTP ${res.status}`);
        }
        for (const update of data.result) {
          offset = Math.max(offset, Number(update.update_id) + 1);
          const msg = update.message || update.edited_message;
          const chatId = msg?.chat?.id;
          const text = typeof msg?.text === "string" ? msg.text.trim() : "";
          if (!chatId || !text) continue;
          if (!allowed.has(String(chatId))) continue; // fail closed
          try {
            const event = {
              channel: "telegram",
              sender: String(chatId),
              text,
              meta: { updateId: update.update_id },
            };
            runtimeProducer?.publish(event, {
              origin: "telegram",
              id: `telegram:${update.update_id}`,
            });
            onEvent?.(event);
          } catch {
            /* downstream owns its failures */
          }
        }
      } catch (err) {
        if (stopped) return;
        log(`channel telegram poll error: ${err.message} — backing off`);
        await new Promise((r) => setTimeout(r, ERROR_BACKOFF_MS));
      }
      if (!stopped) {
        await new Promise((r) => setTimeout(r, pollPauseMs));
      }
    }
  }
  const pollPromise = poll();

  log(`channel telegram polling (allowlist: ${[...allowed].join(", ")})`);

  return {
    kind: "telegram",
    describe: `telegram (${allowed.size} allowed chat${allowed.size === 1 ? "" : "s"})`,
    async reply(event, text) {
      const res = await fetchImpl(api("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: event.sender, text }),
      });
      const data = await res.json();
      if (!data?.ok) {
        throw new Error(data?.description || `sendMessage HTTP ${res.status}`);
      }
      return true;
    },
    stop: () => {
      stopped = true;
      return pollPromise.catch(() => {});
    },
  };
}
