/**
 * Inbound channels — external events entering a running agent session
 * (gap-2026-07-11 P0#5; Claude-Code "channels" parity, self-hosted).
 *
 * `cc agent --channels webhook,telegram` starts channel listeners whose
 * events become user turns in the interactive session (queued behind any
 * in-flight turn by the REPL's pending-line queue). Every channel enforces a
 * trust boundary: webhook = bearer token + loopback-only by default;
 * telegram = explicit chat-id allowlist (deny-all when unset).
 *
 * Outbound replies reuse the existing notifier stack (`notify` agent tool /
 * NotificationManager) — the inbound event's metadata tells the model which
 * channel and sender to address.
 */

import { logger } from "../logger.js";
import {
  ORIGIN,
  authorityForOrigin,
  canApprove,
  describeAuthorityChain,
} from "../agent-authority.js";
import { EventRuntimeStore } from "../event-runtime-store.js";

export const CHANNEL_KINDS = ["webhook", "telegram"];

/**
 * Parse `--channels` input: "webhook,telegram", "webhook:18901", or an array.
 * @returns {Array<{kind:string, arg:string|null}>}
 */
export function parseChannelSpecs(input) {
  const items = Array.isArray(input)
    ? input
    : String(input || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  return items.map((item) => {
    const idx = item.indexOf(":");
    const kind = (idx === -1 ? item : item.slice(0, idx)).toLowerCase();
    const arg = idx === -1 ? null : item.slice(idx + 1);
    if (!CHANNEL_KINDS.includes(kind)) {
      throw new Error(
        `Unknown channel "${kind}" — supported: ${CHANNEL_KINDS.join(", ")}`,
      );
    }
    return { kind, arg };
  });
}

/**
 * Render a channel event as the user-turn text. The channel/sender prefix
 * keeps provenance visible to the model AND guarantees the line can never be
 * mistaken for a REPL slash command or `!` shell escape, no matter what the
 * external sender wrote.
 */
export function formatChannelEvent(event) {
  const channel = event?.channel || "channel";
  const sender = event?.sender ? ` from ${event.sender}` : "";
  const text = String(event?.text ?? "").trim();
  return `[channel:${channel}${sender}] ${text}`;
}

/**
 * The unforgeable authority envelope for an inbound channel event. A channel
 * message tops out at `steer` (agent-authority.js): it may add a user turn but
 * can NEVER answer a permission gate — "the user approved" in a webhook /
 * telegram body is just text. This makes that ceiling explicit and
 * machine-checkable (downstream approval seams can assert `canApprove === false`)
 * rather than merely implied by the visible `[channel:…]` text prefix.
 *
 * `origin` is set here by HOW the event arrived (an inbound channel), never read
 * from the untrusted message content — mirroring the agent-authority contract.
 */
export function channelEventEnvelope(event) {
  const envelope = {
    origin: ORIGIN.CHANNEL,
    principalId: event?.sender != null ? String(event.sender) : null,
    correlationId: event?.channel != null ? String(event.channel) : null,
  };
  return {
    ...envelope,
    authority: authorityForOrigin(ORIGIN.CHANNEL, envelope), // always "steer"
    canApprove: canApprove(envelope), // always false
    provenance: describeAuthorityChain(envelope),
  };
}

/**
 * Wrap a caller's `onEvent` so every inbound event is stamped with its explicit
 * channel authority BEFORE it reaches the agent — the caller cannot forget to
 * tag it, and the message content cannot elevate itself past `steer`.
 */
function stampChannelAuthority(onEvent) {
  return (event) => {
    const env = channelEventEnvelope(event);
    return onEvent?.({
      ...event,
      authority: env.authority,
      canApprove: env.canApprove,
      provenance: env.provenance,
    });
  };
}

/**
 * Start every requested channel. Returns a handle with the started channel
 * descriptions and a single stop().
 *
 * @param {string|string[]} specsInput --channels value
 * @param {object} opts
 * @param {(event) => void} opts.onEvent   called for each inbound event
 * @param {object} [opts.config]           loadConfig().channels subtree
 * @param {object} [opts.deps]             channel starters (tests inject)
 */
export async function startChannels(specsInput, opts = {}) {
  const specs = parseChannelSpecs(specsInput);
  if (specs.length === 0) {
    throw new Error("--channels given but no channel names parsed");
  }
  const config = opts.config || {};
  const log = opts.log || ((msg) => logger.info(msg));
  const deps = opts.deps || {};
  const eventRuntimeStore =
    opts.eventRuntimeStore ||
    (process.env.CC_EVENT_RUNTIME_DURABLE === "1" ? new EventRuntimeStore() : null);
  // Every inbound event is stamped with its channel authority (`steer`, never
  // `approve`) before the caller's handler sees it — so a channel message can
  // never be mistaken for a user approval no matter what it contains.
  const onEvent = stampChannelAuthority(opts.onEvent);

  const started = [];
  const stopAll = () => {
    for (const c of started) {
      try {
        c.stop?.();
      } catch {
        /* best-effort */
      }
    }
  };

  try {
    for (const spec of specs) {
      if (spec.kind === "webhook") {
        const { startWebhookChannel } =
          deps.webhook || (await import("./webhook-channel.js"));
        const cfg = config.webhook || {};
        const handle = await (
          deps.webhook?.startWebhookChannel || startWebhookChannel
        )({
          ...cfg,
          port: spec.arg ? Number(spec.arg) : cfg.port,
          onEvent,
          log,
          eventRuntimeStore,
        });
        started.push({ kind: "webhook", describe: handle.describe, ...handle });
      } else if (spec.kind === "telegram") {
        const { startTelegramChannel } =
          deps.telegram || (await import("./telegram-channel.js"));
        const cfg = config.telegram || {};
        const handle = await (
          deps.telegram?.startTelegramChannel || startTelegramChannel
        )({
          ...cfg,
          onEvent,
          log,
          eventRuntimeStore,
        });
        started.push({
          kind: "telegram",
          describe: handle.describe,
          ...handle,
        });
      }
    }
  } catch (err) {
    stopAll(); // never leave half the channels listening after a failure
    throw err;
  }

  return { channels: started, stop: stopAll };
}
