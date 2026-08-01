import { describe, expect, it, vi } from "vitest";
import {
  createHostOwnedMcpEffectContract,
  createMcpConflictScheduler,
  explainMcpConcurrency,
  McpConflictReason,
  normalizeMcpConcurrencyRequest,
} from "../../src/lib/mcp-conflict-scheduler.js";

function hostRead(options = {}) {
  return createHostOwnedMcpEffectContract({
    effect: "read",
    trusted: true,
    openWorld: false,
    ...options,
  });
}

function hostEffect(effect, options = {}) {
  return createHostOwnedMcpEffectContract({
    effect,
    trusted: true,
    openWorld: false,
    ...options,
  });
}

function call(effectContract, resourceScopes = [], networkScopes = []) {
  return { effectContract, resourceScopes, networkScopes };
}

describe("MCP conflict explanations", () => {
  it("does not trust a model/server object that merely claims read-only", () => {
    const forged = call(
      {
        effect: "read",
        trusted: true,
        openWorld: false,
        readOnlyHint: true,
      },
      ["file:C:/repo/a.txt"],
    );
    forged.stableKey = "model-forged-stable-key";
    forged.parallelReadEligible = true;
    const trusted = call(hostRead(), ["file:C:/repo/b.txt"]);
    const normalized = normalizeMcpConcurrencyRequest(forged);
    const explanation = explainMcpConcurrency(forged, trusted);

    expect(normalized).toMatchObject({
      hostOwned: false,
      parallelReadEligible: false,
      serialReason: McpConflictReason.UNTRUSTED_CONTRACT_SERIALIZED,
    });
    expect(explanation).toMatchObject({
      conflict: true,
      canRunInParallel: false,
      reasonCode: McpConflictReason.UNTRUSTED_CONTRACT_SERIALIZED,
    });
    expect(explanation.stableKey).toMatch(/^mcp-conflict:[a-f0-9]{64}$/);
  });

  it("explains a same-resource conflict when either call may write", () => {
    const resource = "file:C:/repo/report.md";
    const explanation = explainMcpConcurrency(
      call(hostRead(), [resource]),
      call(hostEffect("write"), [resource]),
    );

    expect(explanation).toMatchObject({
      conflict: true,
      reasonCode: McpConflictReason.SAME_SCOPE_MAY_WRITE,
      sharedScopes: ["resource:file:C:/repo/report.md"],
    });
    expect(explanation.reason).toMatch(/at least one may write/i);
  });

  it("allows different-resource trusted, scoped, closed-world reads", () => {
    const left = call(hostRead(), ["file:C:/repo/a.txt"]);
    const right = call(hostRead(), ["file:C:/repo/b.txt"]);
    const first = explainMcpConcurrency(left, right);
    const second = explainMcpConcurrency(right, left);

    expect(first).toMatchObject({
      conflict: false,
      canRunInParallel: true,
      reasonCode: McpConflictReason.NONE,
      sharedScopes: [],
    });
    expect(second.stableKey).toBe(first.stableKey);
  });

  it.each([
    {
      name: "unknown",
      request: call(hostEffect("unknown"), ["db:catalog"]),
      reason: McpConflictReason.UNKNOWN_EFFECT_SERIALIZED,
    },
    {
      name: "open-world read",
      request: call(hostRead({ openWorld: true }), [], ["https://api.example"]),
      reason: McpConflictReason.OPEN_WORLD_SERIALIZED,
    },
    {
      name: "read without scope",
      request: call(hostRead()),
      reason: McpConflictReason.MISSING_SCOPE_SERIALIZED,
    },
  ])("serializes $name", ({ request, reason }) => {
    const explanation = explainMcpConcurrency(
      request,
      call(hostRead(), ["file:C:/repo/safe.txt"]),
    );
    expect(explanation).toMatchObject({ conflict: true, reasonCode: reason });
  });
});

describe("McpConflictScheduler", () => {
  it("acquires compatible reads concurrently and releases idempotently", async () => {
    const scheduler = createMcpConflictScheduler({ maxActive: 2 });
    const first = await scheduler.acquire(
      call(hostRead(), ["file:C:/repo/a.txt"]),
    );
    const second = await scheduler.acquire(
      call(hostRead(), ["file:C:/repo/b.txt"]),
    );

    expect(first.stableKey).toMatch(/^mcp-scope:[a-f0-9]{64}$/);
    expect(scheduler.snapshot()).toMatchObject({ active: 2, queued: 0 });
    expect(first.release()).toBe(true);
    expect(first.release()).toBe(false);
    expect(second.release()).toBe(true);
    expect(scheduler.snapshot().active).toBe(0);
  });

  it("supports aborting queued and active requests", async () => {
    const scheduler = createMcpConflictScheduler();
    const active = await scheduler.acquire(
      call(hostEffect("write"), ["db:catalog"]),
    );
    const controller = new AbortController();
    const queued = scheduler.acquire(
      call(hostRead(), ["file:C:/repo/readme.md"]),
      { signal: controller.signal },
    );
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 1 });

    controller.abort("user cancelled");
    await expect(queued).rejects.toMatchObject({
      name: "AbortError",
      code: "CC_MCP_SCHEDULER_ABORTED",
    });
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 0 });

    const nextPromise = scheduler.acquire(
      call(hostRead(), ["file:C:/repo/next.md"]),
    );
    expect(active.abort("stop write")).toBe(true);
    expect(active.signal.aborted).toBe(true);
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 1 });
    // Cancellation is advisory: the lock remains until the caller's finally
    // block confirms that the active operation has stopped.
    expect(active.release()).toBe(true);
    const next = await nextPromise;
    expect(next.release()).toBe(true);
  });

  it("uses strict FIFO ordering so a queued writer is not starved by later reads", async () => {
    const scheduler = createMcpConflictScheduler({ maxActive: 2 });
    const order = [];
    const first = await scheduler.acquire(
      call(hostRead(), ["file:C:/repo/first.md"]),
    );
    const writerPromise = scheduler
      .acquire(call(hostEffect("write"), ["db:catalog"]))
      .then((lease) => {
        order.push("writer");
        return lease;
      });
    const laterReadPromise = scheduler
      .acquire(call(hostRead(), ["file:C:/repo/later.md"]))
      .then((lease) => {
        order.push("later-read");
        return lease;
      });

    await Promise.resolve();
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 2 });
    expect(order).toEqual([]);
    first.release();
    const writer = await writerPromise;
    expect(order).toEqual(["writer"]);
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 1 });
    writer.release();
    const laterRead = await laterReadPromise;
    expect(order).toEqual(["writer", "later-read"]);
    laterRead.release();
  });

  it("bounds the waiting queue", async () => {
    const scheduler = createMcpConflictScheduler({ maxQueue: 1 });
    const active = await scheduler.acquire(
      call(hostEffect("destructive"), ["db:catalog"]),
    );
    const waiting = scheduler.acquire(
      call(hostRead(), ["file:C:/repo/one.md"]),
    );
    await expect(
      scheduler.acquire(call(hostRead(), ["file:C:/repo/two.md"])),
    ).rejects.toMatchObject({ code: "CC_MCP_SCHEDULER_QUEUE_FULL" });

    active.release();
    const lease = await waiting;
    lease.release();
  });

  it("supports an injected host-ownership predicate", async () => {
    const contract = Object.freeze({
      effect: "read",
      trusted: true,
      openWorld: false,
    });
    const isHostOwnedContract = vi.fn((candidate) => candidate === contract);
    const scheduler = createMcpConflictScheduler({ isHostOwnedContract });
    const first = await scheduler.acquire(
      call(contract, ["file:C:/repo/a.md"]),
    );
    const second = await scheduler.acquire(
      call(contract, ["file:C:/repo/b.md"]),
    );

    expect(scheduler.snapshot().active).toBe(2);
    expect(isHostOwnedContract).toHaveBeenCalled();
    first.release();
    second.release();
  });
});
