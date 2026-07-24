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
    leaseRenewIntervalMs = null,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = {}) {
    if (!store) throw new Error("EventRuntimeWorker requires a store");
    this.store = store;
    this.onInbox = onInbox;
    this.onOutbox = onOutbox;
    this.now = now;
    this.sleep = sleep;
    this.batchSize = Math.max(1, Number(batchSize) || 50);
    this.retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
    const inferredRenewMs = Math.max(
      1,
      Math.floor(Number(store.leaseMs || 120000) / 3),
    );
    this.leaseRenewIntervalMs =
      leaseRenewIntervalMs == null
        ? inferredRenewMs
        : Math.max(0, Number(leaseRenewIntervalMs) || 0);
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
  }

  _settlementOptions(record) {
    if (!record?.lease?.owner) return {};
    return {
      owner: record.lease.owner,
      ...(record.lease.fence == null ? {} : { fence: record.lease.fence }),
    };
  }

  _startLeaseRenewal(queue, record) {
    const renew =
      queue === "inbox" ? this.store.renewInbox : this.store.renewOutbox;
    if (
      typeof renew !== "function" ||
      !record?.lease?.owner ||
      this.leaseRenewIntervalMs <= 0
    ) {
      return { lost: false, stop() {} };
    }
    const options = this._settlementOptions(record);
    const state = { lost: false, timer: null };
    const tick = () => {
      if (state.lost) return;
      try {
        const renewed = renew.call(this.store, record.id, options);
        if (renewed == null) state.lost = true;
      } catch {
        // Renewal is part of the correctness boundary. A lock/storage failure
        // means this worker can no longer prove it owns the record.
        state.lost = true;
      }
    };
    state.timer = this.setIntervalFn(tick, this.leaseRenewIntervalMs);
    state.timer?.unref?.();
    return {
      get lost() {
        return state.lost;
      },
      stop: () => {
        if (state.timer != null) this.clearIntervalFn(state.timer);
        state.timer = null;
      },
    };
  }

  async _drain(queue, handler, stats) {
    const claimed =
      queue === "inbox"
        ? this.store.claimInbox({ limit: this.batchSize, now: this.now() })
        : this.store.claimOutbox({ limit: this.batchSize, now: this.now() });
    for (const record of claimed) {
      const renewal = this._startLeaseRenewal(queue, record);
      try {
        const result = await handler(record.event, record);
        renewal.stop();
        if (renewal.lost) {
          stats[`${queue}LeaseLost`] += 1;
          continue;
        }
        const options = this._settlementOptions(record);
        const settled =
          queue === "inbox"
            ? this.store.acknowledgeInbox(record.id, result, options)
            : this.store.acknowledgeOutbox(record.id, result, options);
        if (settled === null && options.owner) stats[`${queue}LeaseLost`] += 1;
        else stats[`${queue}Acked`] += 1;
      } catch (error) {
        renewal.stop();
        if (renewal.lost) {
          stats[`${queue}LeaseLost`] += 1;
          continue;
        }
        const options = {
          retryDelayMs: this.retryDelayMs,
          ...this._settlementOptions(record),
        };
        const settled = this.store.fail(
          queue,
          record.id,
          error?.message || error,
          options,
        );
        if (settled === null && options.owner) stats[`${queue}LeaseLost`] += 1;
        else stats[`${queue}Failed`] += 1;
      }
    }
    stats[`${queue}Claimed`] += claimed.length;
  }

  async runOnce() {
    const stats = {
      inboxClaimed: 0,
      inboxAcked: 0,
      inboxFailed: 0,
      inboxLeaseLost: 0,
      outboxClaimed: 0,
      outboxAcked: 0,
      outboxFailed: 0,
      outboxLeaseLost: 0,
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
      inboxLeaseLost: 0,
      outboxClaimed: 0,
      outboxAcked: 0,
      outboxFailed: 0,
      outboxLeaseLost: 0,
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
