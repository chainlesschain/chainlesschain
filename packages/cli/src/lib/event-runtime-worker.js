/**
 * Recoverable consumer for EventRuntimeStore.
 *
 * Handlers are injected because inbox events and outbox deliveries have
 * different side effects in different hosts (Hooks, Agenda, WebSocket, CI).
 * The worker owns only claim/ack/retry semantics and never invents an
 * authority policy for the event payload.
 */

export class EventRuntimeWorker {
  constructor({
    store,
    onInbox = async () => {},
    onOutbox = async () => {},
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    batchSize = 50,
    retryDelayMs = 1000,
  } = {}) {
    if (!store) throw new Error("EventRuntimeWorker requires a store");
    this.store = store;
    this.onInbox = onInbox;
    this.onOutbox = onOutbox;
    this.now = now;
    this.sleep = sleep;
    this.batchSize = Math.max(1, Number(batchSize) || 50);
    this.retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
  }

  async _drain(queue, handler, stats) {
    const claimed =
      queue === "inbox"
        ? this.store.claimInbox({ limit: this.batchSize, now: this.now() })
        : this.store.claimOutbox({ limit: this.batchSize, now: this.now() });
    for (const record of claimed) {
      try {
        const result = await handler(record.event, record);
        if (queue === "inbox") this.store.acknowledgeInbox(record.id, result);
        else this.store.acknowledgeOutbox(record.id, result);
        stats[`${queue}Acked`] += 1;
      } catch (error) {
        this.store.fail(queue, record.id, error?.message || error, {
          retryDelayMs: this.retryDelayMs,
        });
        stats[`${queue}Failed`] += 1;
      }
    }
    stats[`${queue}Claimed`] += claimed.length;
  }

  async runOnce() {
    const stats = {
      inboxClaimed: 0,
      inboxAcked: 0,
      inboxFailed: 0,
      outboxClaimed: 0,
      outboxAcked: 0,
      outboxFailed: 0,
    };
    await this._drain("inbox", this.onInbox, stats);
    await this._drain("outbox", this.onOutbox, stats);
    return stats;
  }

  async run({ intervalMs = 1000, signal = null, maxTicks = null } = {}) {
    let stopped = Boolean(signal?.aborted);
    let ticks = 0;
    const stop = () => {
      stopped = true;
    };
    signal?.addEventListener?.("abort", stop, { once: true });
    const totals = {
      inboxClaimed: 0,
      inboxAcked: 0,
      inboxFailed: 0,
      outboxClaimed: 0,
      outboxAcked: 0,
      outboxFailed: 0,
    };
    try {
      while (!stopped) {
        const stats = await this.runOnce();
        for (const key of Object.keys(totals)) totals[key] += stats[key];
        ticks += 1;
        if (Number.isFinite(maxTicks) && ticks >= maxTicks) break;
        await this.sleep(Math.max(0, Number(intervalMs) || 0));
      }
    } finally {
      signal?.removeEventListener?.("abort", stop);
    }
    return { ticks, ...totals };
  }
}
