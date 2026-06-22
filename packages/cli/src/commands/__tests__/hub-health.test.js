/**
 * `cc hub health` — focused unit tests for the --quick (minimal hub) path.
 *
 * Why this test exists: `cc hub health` defaults to the FULL hub because its
 * job is to verify hub init wired every component (llm / kgSink / ragSink) —
 * a minimal hub leaves those null on purpose, so reporting them as down would
 * be a false negative, not a faster check. `--quick` opts into a vault-only
 * probe on the minimal hub (skips the 77-adapter registry + sink wiring) and
 * must mark the other components "not probed" rather than failing them. If
 * that distinction regresses, `--quick` would either go slow again or start
 * lying about component health. This suite is the canary.
 *
 * Uses the `_getHub` injection seam — no real vault / no spinner side effects.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _internal } from "../hub.js";

const { cmdHealth } = _internal;

let exitSpy, logSpy, out;

beforeEach(() => {
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
  out = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    out.push(args.join(" "));
  });
});

afterEach(() => {
  exitSpy.mockRestore();
  logSpy.mockRestore();
});

function fullHub() {
  return {
    minimal: false,
    vault: { db: {}, schemaVersion: () => 4 },
    llm: { name: "ollama:qwen2.5", isLocal: true },
    kgSink: {},
    ragSink: {},
  };
}

function minimalHub() {
  return {
    minimal: true,
    vault: { db: {}, schemaVersion: () => 4 },
    llm: null,
    kgSink: null,
    ragSink: null,
  };
}

function parseJson() {
  return JSON.parse(out.join("\n"));
}

describe("cc hub health — default (full) vs --quick (minimal)", () => {
  it("default probes all four components with real ok states", async () => {
    const stub = vi.fn(async () => fullHub());
    await cmdHealth({ json: true, _getHub: stub });
    const o = parseJson();
    expect(stub).toHaveBeenCalledTimes(1);
    expect(o.quick).toBe(false);
    expect(o.vault.ok).toBe(true);
    expect(o.vault.schemaVersion).toBe(4);
    expect(o.llm).toEqual({ ok: true, isLocal: true, name: "ollama:qwen2.5" });
    expect(o.kgSink).toEqual({ ok: true });
    expect(o.ragSink).toEqual({ ok: true });
  });

  it("--quick reports vault only; llm/kgSink/ragSink marked not probed (NOT down)", async () => {
    await cmdHealth({
      json: true,
      quick: true,
      _getHub: async () => minimalHub(),
    });
    const o = parseJson();
    expect(o.quick).toBe(true);
    expect(o.vault.ok).toBe(true);
    // The key correctness property: not-probed, never { ok: false }.
    expect(o.llm).toEqual({ probed: false });
    expect(o.kgSink).toEqual({ probed: false });
    expect(o.ragSink).toEqual({ probed: false });
    expect(o.llm.ok).toBeUndefined();
  });

  it("--quick human output notes the skipped components", async () => {
    await cmdHealth({ quick: true, _getHub: async () => minimalHub() });
    const text = out.join("\n");
    expect(text).toMatch(/vault\s+schema=4/);
    expect(text).toContain("not probed");
    expect(text).toContain("--quick");
  });

  it("default human output lists llm/kgSink/ragSink", async () => {
    await cmdHealth({ _getHub: async () => fullHub() });
    const text = out.join("\n");
    expect(text).toContain("llm");
    expect(text).toContain("kgSink");
    expect(text).toContain("ragSink");
  });
});
