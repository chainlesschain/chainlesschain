/**
 * Tests for src/lib/stix-parser.js — STIX 2.1 indicator extraction
 * and observable classification.
 */

import { describe, it, expect } from "vitest";
import {
  parseStixPattern,
  extractIndicatorsFromObject,
  extractIndicatorsFromBundle,
  classifyObservable,
  IOC_TYPES,
} from "../../src/lib/stix-parser.js";

describe("stix-parser", () => {
  // ── parseStixPattern ────────────────────────────────────────

  describe("parseStixPattern", () => {
    it("returns [] for non-strings", () => {
      expect(parseStixPattern(null)).toEqual([]);
      expect(parseStixPattern(undefined)).toEqual([]);
      expect(parseStixPattern(123)).toEqual([]);
    });

    it("extracts a SHA-256 file hash", () => {
      const out = parseStixPattern("[file:hashes.'SHA-256' = 'abc123def456']");
      expect(out).toEqual([{ type: "file-sha256", value: "abc123def456" }]);
    });

    it("extracts MD5/SHA-1/SHA-512 hashes", () => {
      expect(
        parseStixPattern(
          "[file:hashes.MD5 = 'd41d8cd98f00b204e9800998ecf8427e']",
        ),
      ).toEqual([
        { type: "file-md5", value: "d41d8cd98f00b204e9800998ecf8427e" },
      ]);
      expect(
        parseStixPattern("[file:hashes.'SHA-1' = 'da39a3ee5e6b']"),
      ).toEqual([{ type: "file-sha1", value: "da39a3ee5e6b" }]);
      expect(parseStixPattern("[file:hashes.'SHA-512' = 'deadbeef']")).toEqual([
        { type: "file-sha512", value: "deadbeef" },
      ]);
    });

    it("extracts ipv4 / ipv6 / domain / url / email observables", () => {
      expect(parseStixPattern("[ipv4-addr:value = '192.0.2.1']")).toEqual([
        { type: "ipv4", value: "192.0.2.1" },
      ]);
      expect(parseStixPattern("[ipv6-addr:value = '2001:db8::1']")).toEqual([
        { type: "ipv6", value: "2001:db8::1" },
      ]);
      expect(parseStixPattern("[domain-name:value = 'evil.example']")).toEqual([
        { type: "domain", value: "evil.example" },
      ]);
      expect(
        parseStixPattern("[url:value = 'http://evil.example/pwn']"),
      ).toEqual([{ type: "url", value: "http://evil.example/pwn" }]);
      expect(
        parseStixPattern("[email-addr:value = 'phish@evil.example']"),
      ).toEqual([{ type: "email", value: "phish@evil.example" }]);
    });

    it("handles patterns with OR joiner — emits both terms", () => {
      const out = parseStixPattern(
        "[domain-name:value = 'bad1.example'] OR [domain-name:value = 'bad2.example']",
      );
      expect(out).toEqual([
        { type: "domain", value: "bad1.example" },
        { type: "domain", value: "bad2.example" },
      ]);
    });

    it("handles AND / FOLLOWEDBY joiners", () => {
      const out = parseStixPattern(
        "[ipv4-addr:value = '1.1.1.1'] FOLLOWEDBY [url:value = 'http://x.example']",
      );
      expect(out).toHaveLength(2);
      expect(out[0].type).toBe("ipv4");
      expect(out[1].type).toBe("url");
    });

    it("ignores unsupported observable types", () => {
      const out = parseStixPattern(
        "[windows-registry-key:key = 'HKLM\\\\Software\\\\Evil']",
      );
      expect(out).toEqual([]);
    });

    it("ignores unknown hash algorithms", () => {
      const out = parseStixPattern("[file:hashes.'SHA-3' = 'abc']");
      expect(out).toEqual([]);
    });

    it("handles escaped single quotes inside value", () => {
      const out = parseStixPattern("[domain-name:value = 'O\\'Brien.example']");
      expect(out).toEqual([{ type: "domain", value: "O'Brien.example" }]);
    });
  });

  // ── extractIndicatorsFromObject ─────────────────────────────

  describe("extractIndicatorsFromObject", () => {
    it("returns [] for non-indicator objects", () => {
      expect(extractIndicatorsFromObject(null)).toEqual([]);
      expect(extractIndicatorsFromObject({ type: "malware" })).toEqual([]);
      expect(extractIndicatorsFromObject({ type: "indicator" })).toEqual([]);
    });

    it("skips non-stix pattern_type", () => {
      expect(
        extractIndicatorsFromObject({
          type: "indicator",
          pattern: "alert tcp any any -> any any (msg:'bad'; sid:1;)",
          pattern_type: "snort",
        }),
      ).toEqual([]);
    });

    it("accepts default pattern_type (stix)", () => {
      const out = extractIndicatorsFromObject({
        type: "indicator",
        id: "indicator--abc",
        name: "Bad domain",
        pattern: "[domain-name:value = 'evil.example']",
      });
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe("domain");
      expect(out[0].source.name).toBe("Bad domain");
      expect(out[0].source.indicatorId).toBe("indicator--abc");
    });

    it("attaches source metadata from indicator_types + labels fallback", () => {
      const a = extractIndicatorsFromObject({
        type: "indicator",
        pattern: "[ipv4-addr:value = '1.2.3.4']",
        indicator_types: ["malicious-activity"],
        confidence: 85,
        valid_from: "2025-01-01T00:00:00Z",
        valid_until: "2025-12-31T00:00:00Z",
      });
      expect(a[0].source.labels).toEqual(["malicious-activity"]);
      expect(a[0].source.confidence).toBe(85);
      expect(a[0].source.validFrom).toBe("2025-01-01T00:00:00Z");
      expect(a[0].source.validUntil).toBe("2025-12-31T00:00:00Z");

      const b = extractIndicatorsFromObject({
        type: "indicator",
        pattern: "[ipv4-addr:value = '1.2.3.5']",
        labels: ["legacy-label"],
      });
      expect(b[0].source.labels).toEqual(["legacy-label"]);
      expect(b[0].source.confidence).toBeNull();
    });
  });

  // ── extractIndicatorsFromBundle ─────────────────────────────

  describe("extractIndicatorsFromBundle", () => {
    it("returns [] for null/non-bundle", () => {
      expect(extractIndicatorsFromBundle(null)).toEqual([]);
      expect(extractIndicatorsFromBundle({ type: "indicator" })).toEqual([]);
      expect(extractIndicatorsFromBundle("nope")).toEqual([]);
    });

    it("accepts a STIX 2.1 bundle", () => {
      const bundle = {
        type: "bundle",
        id: "bundle--1",
        objects: [
          {
            type: "identity",
            id: "identity--1",
            name: "Vendor",
          },
          {
            type: "indicator",
            id: "indicator--1",
            pattern: "[domain-name:value = 'evil.example']",
          },
          {
            type: "indicator",
            id: "indicator--2",
            pattern: "[ipv4-addr:value = '1.2.3.4']",
          },
        ],
      };
      const out = extractIndicatorsFromBundle(bundle);
      expect(out).toHaveLength(2);
      expect(out.map((i) => i.type)).toEqual(["domain", "ipv4"]);
    });

    it("accepts a loose array of STIX objects", () => {
      const out = extractIndicatorsFromBundle([
        {
          type: "indicator",
          pattern: "[url:value = 'http://a.example']",
        },
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe("url");
    });
  });

  // ── classifyObservable ──────────────────────────────────────

  describe("classifyObservable", () => {
    it("identifies file hashes by length", () => {
      expect(classifyObservable("d41d8cd98f00b204e9800998ecf8427e")).toBe(
        "file-md5",
      );
      expect(classifyObservable("a".repeat(40))).toBe("file-sha1");
      expect(classifyObservable("b".repeat(64))).toBe("file-sha256");
      expect(classifyObservable("c".repeat(128))).toBe("file-sha512");
    });

    it("identifies ipv4 / ipv6", () => {
      expect(classifyObservable("1.2.3.4")).toBe("ipv4");
      expect(classifyObservable("2001:db8::1")).toBe("ipv6");
    });

    it("identifies urls and emails", () => {
      expect(classifyObservable("http://evil.example/x")).toBe("url");
      expect(classifyObservable("https://evil.example")).toBe("url");
      expect(classifyObservable("phish@evil.example")).toBe("email");
    });

    it("identifies domains", () => {
      expect(classifyObservable("evil.example")).toBe("domain");
      expect(classifyObservable("sub.domain.co")).toBe("domain");
    });

    it("returns unknown for garbage", () => {
      expect(classifyObservable("")).toBe("unknown");
      expect(classifyObservable("   ")).toBe("unknown");
      expect(classifyObservable(null)).toBe("unknown");
      expect(classifyObservable(12345)).toBe("unknown");
      // too-long hex string but not a valid hash length
      expect(classifyObservable("abc".repeat(30))).toBe("unknown");
    });
  });

  describe("IOC_TYPES", () => {
    it("is frozen and contains the nine canonical types", () => {
      expect(Object.isFrozen(IOC_TYPES)).toBe(true);
      expect(IOC_TYPES).toEqual([
        "file-md5",
        "file-sha1",
        "file-sha256",
        "file-sha512",
        "ipv4",
        "ipv6",
        "domain",
        "url",
        "email",
      ]);
    });
  });
});
