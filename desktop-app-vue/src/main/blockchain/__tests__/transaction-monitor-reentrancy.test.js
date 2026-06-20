import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { TransactionMonitor } = require("../transaction-monitor.js");

function makeDeps(waitImpl) {
  const provider = { waitForTransaction: vi.fn(waitImpl) };
  const adapter = { getProvider: () => provider, currentChainId: 1 };
  const database = { db: { prepare: () => ({ run: vi.fn(), all: () => [], get: () => undefined }) } };
  return { provider, adapter, database };
}

describe("TransactionMonitor.checkPendingTransactions re-entrancy", () => {
  let provider, monitor;

  beforeEach(() => {
    const deps = makeDeps();
    provider = deps.provider;
    monitor = new TransactionMonitor(deps.adapter, deps.database);
  });

  it("does not re-monitor a pending tx while a previous check is still running", async () => {
    let resolveWait;
    provider.waitForTransaction.mockImplementation(
      () => new Promise((r) => (resolveWait = r)),
    );
    const onConfirmed = vi.fn();
    monitor.pendingTxs.set("0xabc", { onConfirmed, onFailed: vi.fn() });

    const first = monitor.checkPendingTransactions(); // blocks on waitForTransaction
    const second = monitor.checkPendingTransactions(); // re-entrant → no-op
    await second;

    expect(monitor._checking).toBe(true); // first is still in flight
    expect(provider.waitForTransaction).toHaveBeenCalledTimes(1); // NOT re-monitored

    resolveWait({ status: 1 });
    await first;

    expect(provider.waitForTransaction).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledTimes(1); // confirmation fired exactly once
    expect(monitor._checking).toBe(false); // guard released
    expect(monitor.pendingTxs.has("0xabc")).toBe(false); // removed after confirm
  });

  it("confirms a tx once and emits tx:confirmed", async () => {
    provider.waitForTransaction.mockResolvedValue({ status: 1, blockNumber: 9 });
    const onConfirmed = vi.fn();
    const emitted = vi.fn();
    monitor.on("tx:confirmed", emitted);
    monitor.pendingTxs.set("0xdef", { onConfirmed, onFailed: vi.fn() });

    await monitor.checkPendingTransactions();

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(monitor.pendingTxs.has("0xdef")).toBe(false);
  });

  it("releases the guard so a later check runs again", async () => {
    provider.waitForTransaction.mockResolvedValue({ status: 1 });
    monitor.pendingTxs.set("0x1", { onConfirmed: vi.fn(), onFailed: vi.fn() });
    await monitor.checkPendingTransactions();
    expect(monitor._checking).toBe(false);

    monitor.pendingTxs.set("0x2", { onConfirmed: vi.fn(), onFailed: vi.fn() });
    await monitor.checkPendingTransactions(); // runs (not blocked by a stuck guard)
    expect(provider.waitForTransaction).toHaveBeenCalledTimes(2);
  });
});
