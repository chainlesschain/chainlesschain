/**
 * MockAdapter — deterministic reference implementation of PersonalDataAdapter.
 *
 * Used by the registry tests + Phase 2 E2E pipeline validation (1k events
 * < 30s target). Also serves as a template real adapter authors can read
 * to understand the contract.
 *
 * Deterministic: seed + offset produces the same stream of synthetic
 * messages, so tests can assert exact counts / ids / content without
 * snapshot fragility.
 *
 * Behaviors exposed for tests:
 *   - new MockAdapter({ count, seed, sinceSupported })
 *   - adapter.shouldFailHealth  → flip to true to simulate down adapter
 *   - adapter.failAfter         → throw mid-sync after N yields (resilience tests)
 *   - adapter.normalizeShouldThrowAt(N) → throw on normalize call #N
 */

"use strict";

const { newId } = require("./ids");
const {
  EVENT_SUBTYPES,
  PERSON_SUBTYPES,
  CAPTURED_BY,
} = require("./constants");

// Tiny LCG so a given seed always produces the same sequence.
// (Math.random() would make tests flaky.)
function lcg(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0x100000000);
  };
}

class MockAdapter {
  constructor(opts = {}) {
    this.name = opts.name || "mock";
    this.version = opts.version || "0.1.0";
    this.capabilities = ["sync:mock", "parse:mock"];
    this.rateLimits = { perMinute: 600 };
    this.dataDisclosure = {
      fields: ["mock:body,recipient,amount"],
      sensitivity: "low",
      legalGate: false,
    };

    this._count = Number.isInteger(opts.count) && opts.count >= 0 ? opts.count : 10;
    this._seed = opts.seed || 1;
    this._sinceSupported = opts.sinceSupported !== false;

    // Test knobs
    this.shouldFailHealth = false;
    this.healthCheckCount = 0;
    this.authenticateCount = 0;
    this.syncCount = 0;
    this.normalizeCount = 0;
    this.failAfter = -1;  // -1 = never; otherwise throws after N raws yielded
    this._normalizeFailAt = -1;
  }

  normalizeShouldThrowAt(n) {
    this._normalizeFailAt = n;
  }

  async authenticate(_ctx) {
    this.authenticateCount += 1;
    return { ok: true };
  }

  async healthCheck() {
    this.healthCheckCount += 1;
    if (this.shouldFailHealth) {
      return { ok: false, reason: "mock-adapter-marked-unhealthy" };
    }
    return { ok: true, lastChecked: Date.now() };
  }

  /**
   * Yield synthetic raw events. sinceWatermark is a count of already-seen
   * items; the adapter skips those many from the start of its deterministic
   * sequence to simulate incremental sync.
   */
  async *sync(opts = {}) {
    this.syncCount += 1;
    const since = this._sinceSupported && Number.isInteger(opts.sinceWatermark)
      ? opts.sinceWatermark
      : 0;
    const max = Number.isInteger(opts.maxEvents) && opts.maxEvents > 0 ? opts.maxEvents : this._count;
    const target = Math.min(this._count, since + max);

    const rand = lcg(this._seed + since);
    let yielded = 0;

    for (let i = since; i < target; i++) {
      const rawId = `mock-raw-${i.toString().padStart(8, "0")}`;
      const capturedAt = 1_700_000_000_000 + i * 60_000; // deterministic monotonic timestamps
      const variant = Math.floor(rand() * 3); // 0 = simple msg, 1 = with sender, 2 = with sender + amount

      yield {
        adapter: this.name,
        originalId: rawId,
        capturedAt,
        payload: {
          variant,
          index: i,
          text: `mock message #${i}`,
          senderName: variant >= 1 ? `Sender_${(i * 7) % 23}` : undefined,
          amountCNY: variant === 2 ? Math.round(rand() * 10000) / 100 : undefined,
        },
      };

      yielded += 1;
      if (this.failAfter >= 0 && yielded >= this.failAfter) {
        throw new Error(`MockAdapter: induced sync failure after ${yielded} yields`);
      }
    }
  }

  /**
   * Convert one raw payload to a NormalizedBatch:
   *   variant 0: 1 Event[message]
   *   variant 1: 1 Event[message] + 1 Person[contact]
   *   variant 2: 1 Event[payment] + 1 Person[contact]
   */
  normalize(raw) {
    this.normalizeCount += 1;
    if (this._normalizeFailAt >= 0 && this.normalizeCount === this._normalizeFailAt + 1) {
      throw new Error(`MockAdapter: induced normalize failure on call #${this.normalizeCount}`);
    }

    const { payload, originalId, capturedAt } = raw;
    const ingestedAt = Date.now();
    const source = (originalIdOverride) => ({
      adapter: this.name,
      adapterVersion: this.version,
      capturedAt,
      capturedBy: CAPTURED_BY.MANUAL,
      originalId: originalIdOverride || originalId,
    });

    const persons = [];
    let actorId = "person-self";
    if (payload.variant >= 1) {
      // Stable id derived from sender — same sender across multiple events
      // resolves to the same Person row. Real adapters should follow this
      // pattern (or implement lookupOrCreatePerson against the vault) so
      // person records dedup instead of accumulating duplicates.
      const senderKey = payload.senderName;
      const senderId = `person-mock-${senderKey}`;
      persons.push({
        id: senderId,
        type: "person",
        subtype: PERSON_SUBTYPES.CONTACT,
        names: [payload.senderName],
        ingestedAt,
        source: source(`mock-person-${senderKey}`),
      });
      actorId = senderId;
    }

    const events = [];
    if (payload.variant === 2 && payload.amountCNY != null) {
      events.push({
        id: newId(),
        type: "event",
        subtype: EVENT_SUBTYPES.PAYMENT,
        occurredAt: capturedAt,
        actor: "person-self",
        participants: persons.length > 0 ? [persons[0].id, "person-self"] : ["person-self"],
        content: {
          title: payload.text,
          amount: { value: payload.amountCNY, currency: "CNY", direction: "out" },
        },
        ingestedAt,
        source: source(),
        extra: { variant: 2, index: payload.index },
      });
    } else {
      events.push({
        id: newId(),
        type: "event",
        subtype: EVENT_SUBTYPES.MESSAGE,
        occurredAt: capturedAt,
        actor: actorId,
        content: { text: payload.text },
        ingestedAt,
        source: source(),
        extra: { variant: payload.variant, index: payload.index },
      });
    }

    return { events, persons, places: [], items: [], topics: [] };
  }
}

module.exports = { MockAdapter };
