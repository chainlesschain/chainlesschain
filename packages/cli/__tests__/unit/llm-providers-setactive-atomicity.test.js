/**
 * LLMProviderRegistry.setActive() must keep exactly one active provider.
 *
 * It ran two statements with no transaction: first clearing every active flag
 * (`SET is_active = 0 WHERE 1=1`), then INSERT OR REPLACE-ing the new one with
 * is_active = 1. If the second statement failed after the clear committed,
 * NO provider was left active — and getActive() masks that as the "ollama"
 * fallback, so a failed switch silently reverts the user to ollama and loses
 * their previously-active provider.
 *
 * SQL-level transaction behavior, so this runs on real better-sqlite3.
 */

import { describe, it, expect } from "vitest";

async function makeReg() {
  const { default: Database } = await import("better-sqlite3");
  const { LLMProviderRegistry } =
    await import("../../src/lib/llm-providers.js");
  const db = new Database(":memory:");
  const reg = new LLMProviderRegistry(db);
  return { db, reg };
}

const activeCount = (db) =>
  db.prepare("SELECT COUNT(*) c FROM llm_providers WHERE is_active = 1").get()
    .c;

describe("LLMProviderRegistry.setActive — atomic active switch (real better-sqlite3)", () => {
  it("keeps the old active provider when setting the new one fails (no silent ollama revert)", async () => {
    const { db, reg } = await makeReg();
    try {
      reg.setActive("openai");
      expect(reg.getActive()).toBe("openai");

      const realPrepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        if (/INSERT OR REPLACE INTO llm_providers/.test(sql)) {
          throw new Error("simulated set-active write failure");
        }
        return realPrepare(sql);
      };

      expect(() => reg.setActive("anthropic")).toThrow(/set-active/);
      db.prepare = realPrepare;

      // Invariant: exactly one active, still openai — not zero (which getActive
      // would silently mask as the "ollama" fallback).
      expect(reg.getActive()).toBe("openai");
      expect(activeCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("a normal switch moves the active flag to the new provider", async () => {
    const { db, reg } = await makeReg();
    try {
      reg.setActive("openai");
      reg.setActive("anthropic");
      expect(reg.getActive()).toBe("anthropic");
      expect(activeCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });
});
