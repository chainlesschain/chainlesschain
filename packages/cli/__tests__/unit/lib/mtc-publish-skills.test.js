/**
 * Unit tests for the publish-skills internals (fingerprint + state IO).
 * The full CLI subprocess flow is exercised in the integration test;
 * this file pins the pure logic.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { _publishInternals } from "../../../src/commands/mtc.js";

const {
  canonicalSkillsFingerprint,
  loadPublishState,
  savePublishState,
  PUBLISH_STATE_SCHEMA,
} = _publishInternals;

describe("publish-skills internals", () => {
  describe("canonicalSkillsFingerprint", () => {
    it("is stable across input order", () => {
      const a = [
        {
          id: "skill-a",
          version: "1.0.0",
          category: "x",
          activation: "a",
          description: "d",
          tags: [],
        },
        {
          id: "skill-b",
          version: "2.0.0",
          category: "y",
          activation: "b",
          description: "e",
          tags: [],
        },
      ];
      const b = [...a].reverse();
      expect(canonicalSkillsFingerprint(a)).toBe(canonicalSkillsFingerprint(b));
    });

    it("changes when any tracked field changes", () => {
      const base = [
        {
          id: "skill-a",
          version: "1.0.0",
          category: "x",
          activation: "a",
          description: "d",
        },
      ];
      const fp0 = canonicalSkillsFingerprint(base);
      expect(
        canonicalSkillsFingerprint([{ ...base[0], version: "1.0.1" }]),
      ).not.toBe(fp0);
      expect(
        canonicalSkillsFingerprint([{ ...base[0], description: "d2" }]),
      ).not.toBe(fp0);
      expect(
        canonicalSkillsFingerprint([{ ...base[0], category: "z" }]),
      ).not.toBe(fp0);
    });

    it("returns sha256:-prefixed digest", () => {
      const fp = canonicalSkillsFingerprint([{ id: "x", version: "1" }]);
      expect(fp).toMatch(/^sha256:/);
    });
  });

  describe("state file", () => {
    let tmp;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-publish-state-"));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("returns initial state when file is missing", () => {
      const s = loadPublishState(path.join(tmp, "no-such.json"));
      expect(s.schema).toBe(PUBLISH_STATE_SCHEMA);
      expect(s.last_seq).toBe(0);
      expect(s.last_fingerprint).toBe(null);
      expect(s.history).toEqual([]);
    });

    it("round-trips through savePublishState", () => {
      const file = path.join(tmp, "state.json");
      savePublishState(file, {
        schema: PUBLISH_STATE_SCHEMA,
        last_seq: 7,
        last_fingerprint: "sha256:abc",
        last_published_at: "2026-04-30T10:00:00Z",
        history: [
          {
            seq: "000007",
            namespace: "mtc/v1/skill/000007",
            tree_head_id: "sha256:def",
          },
        ],
      });
      const reloaded = loadPublishState(file);
      expect(reloaded.last_seq).toBe(7);
      expect(reloaded.history).toHaveLength(1);
      expect(reloaded.history[0].seq).toBe("000007");
    });

    it("rejects unknown schema", () => {
      const file = path.join(tmp, "bad.json");
      fs.writeFileSync(file, JSON.stringify({ schema: "wrong/v1" }));
      expect(() => loadPublishState(file)).toThrow(/unknown schema/);
    });
  });
});
