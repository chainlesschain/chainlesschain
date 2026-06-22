/**
 * `cc hub stats` — focused unit tests for the minimal-vs-full hub selection.
 *
 * Why this test exists: `cc hub stats` defaults to the MINIMAL hub so a quick
 * "how many rows do I have" check doesn't pay to instantiate the full
 * 77-adapter registry + KG/RAG sinks + email-account auto-load. The adapter
 * list + resolved LLM are only built when the caller passes `--full` (or via
 * the standalone `cc hub list-adapters`). If that wiring regresses, every
 * `cc hub stats` call silently goes back to a slow full-hub init. This suite
 * is the canary.
 *
 * Uses the `_getHub` injection seam — no real vault / no spinner side effects.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _internal } from "../hub.js";

const { cmdStats } = _internal;

let exitSpy, logSpy, jsonOut;

beforeEach(() => {
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
  jsonOut = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    jsonOut.push(args.join(" "));
  });
});

afterEach(() => {
  exitSpy.mockRestore();
  logSpy.mockRestore();
});

function minimalHub() {
  return {
    minimal: true,
    hubDir: "/tmp/hub",
    vault: {
      stats: () => ({ events: 3, persons: 1, places: 0, items: 6, topics: 2 }),
    },
    registry: null,
    llm: null,
  };
}

function fullHub() {
  return {
    minimal: false,
    hubDir: "/tmp/hub",
    vault: {
      stats: () => ({ events: 3, persons: 1, places: 0, items: 6, topics: 2 }),
    },
    registry: {
      list: () => [
        { name: "wechat", version: "0.1.0" },
        { name: "email-imap", version: "0.2.0" },
      ],
    },
    llm: { name: "ollama:qwen2.5", isLocal: true },
  };
}

function parseJson() {
  return JSON.parse(jsonOut.join("\n"));
}

describe("cc hub stats — minimal vs full hub selection", () => {
  it("default (no --full) builds the MINIMAL hub: null adapters, minimal flag", async () => {
    const stub = vi.fn(async () => minimalHub());
    await cmdStats({ json: true, _getHub: stub });
    const out = parseJson();
    expect(stub).toHaveBeenCalledTimes(1);
    expect(out.minimal).toBe(true);
    expect(out.adapters).toBeNull();
    expect(out.llm).toBeNull();
    expect(out.vault.items).toBe(6);
    expect(out.hubDir).toBe("/tmp/hub");
  });

  it("--full builds the full hub: adapters listed, llm resolved, minimal false", async () => {
    const stub = vi.fn(async () => fullHub());
    await cmdStats({ json: true, full: true, _getHub: stub });
    const out = parseJson();
    expect(out.minimal).toBe(false);
    expect(Array.isArray(out.adapters)).toBe(true);
    expect(out.adapters).toHaveLength(2);
    expect(out.llm).toEqual({ name: "ollama:qwen2.5", isLocal: true });
  });

  it("human (non-JSON) minimal output points to --full / list-adapters", async () => {
    await cmdStats({ _getHub: async () => minimalHub() });
    const text = jsonOut.join("\n");
    expect(text).toMatch(/events:\s+3/);
    expect(text).toContain("cc hub list-adapters");
    expect(text).toContain("cc hub stats --full");
  });

  it("human full output lists adapter names + versions", async () => {
    await cmdStats({ full: true, _getHub: async () => fullHub() });
    const text = jsonOut.join("\n");
    expect(text).toContain("adapters (2)");
    expect(text).toContain("wechat");
    expect(text).toContain("email-imap");
  });
});
