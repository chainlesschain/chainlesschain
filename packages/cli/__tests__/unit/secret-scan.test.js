/**
 * Recall-first secret scanner + corpus benchmark (IDE gap §8.1
 * "凭据脱敏真实语料基准"). Pure module. The load-bearing assertions are the
 * OBJECTIVE metrics: recall = 1.0 across every §8.1 category, false-positive
 * rate = 0 on the counter-examples (UUIDs / hashes / plain base64 / code), plus
 * per-surface coverage and a P95 latency measured from an injected clock.
 */
import { describe, it, expect } from "vitest";
import {
  SURFACES,
  SECRET_CATEGORIES,
  SECRET_CORPUS,
  scanSecrets,
  redactSecrets,
  containsSecret,
  runRedactionBenchmark,
} from "../../src/lib/secret-scan.js";

describe("scanSecrets / redactSecrets — per category", () => {
  const cases = [
    ["provider_token", "OPENAI_API_KEY set to sk-abcd1234efgh5678ijkl here"],
    ["provider_token", "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 leaked"],
    ["provider_token", "id AKIAIOSFODNN7EXAMPLE"],
    [
      "jwt",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ],
    ["bearer", "Authorization: Bearer aG9sZDpteS1zZWNyZXQtdG9rZW4"],
    [
      "connection_string",
      "postgres://appuser:s3cr3tP@ss@db.internal:5432/prod",
    ],
    ["cookie", "Set-Cookie: sessionid=9f8b7c6d5e4f3a2b1c0d; HttpOnly"],
    ["env_assignment", 'DB_PASSWORD="Sup3rSecret_Value-123"'],
  ];

  it("detects every category", () => {
    for (const [cat, text] of cases) {
      const found = scanSecrets(text);
      expect(found.length, `${cat}: ${text}`).toBeGreaterThan(0);
      expect(
        found.some((f) => f.category === cat),
        cat,
      ).toBe(true);
    }
  });

  it("redacts the secret value (fail toward not-leaking)", () => {
    expect(redactSecrets("key sk-abcd1234efgh5678ijkl")).not.toContain(
      "sk-abcd1234efgh5678ijkl",
    );
    // structure a reader still needs survives
    expect(
      redactSecrets("Authorization: Bearer aG9sZDpteS1zZWNyZXQtdG9rZW4"),
    ).toContain("Bearer");
    expect(redactSecrets("postgres://u:pw0rdlong@host/db")).toContain(
      "postgres://u:",
    );
  });

  it("covers a dedicated JWT / connection-string / cookie rule (gaps vs the IDE redactor)", () => {
    expect(
      containsSecret("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.aaaaaaaaaaaa"),
    ).toBe(true);
    expect(containsSecret("redis://svc:longpassword@cache:6379")).toBe(true);
    expect(containsSecret("Cookie: auth=deadbeefdeadbeef")).toBe(true);
  });
});

describe("scanSecrets — counter-examples do NOT match (false positives)", () => {
  const safe = [
    "requestId = 550e8400-e29b-41d4-a716-446655440000", // UUID
    "commit beaa3f9ec7069258aad5e8587d32f779da5e5d20", // git sha
    "blob aGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYSBzZWNyZXQ=", // plain base64
    "const token = getToken(config)", // function call, not a value
    "retryCount = 12345678", // non-secret key
    "docs at https://example.com/guide", // url without credentials
    "The number of open editor tabs.", // prose
  ];
  it("leaves safe text byte-for-byte unchanged", () => {
    for (const text of safe) {
      expect(scanSecrets(text), text).toEqual([]);
      expect(redactSecrets(text)).toBe(text);
    }
  });
});

describe("runRedactionBenchmark — objective metrics", () => {
  it("achieves recall 1.0 and FPR 0 on the labeled corpus", () => {
    const report = runRedactionBenchmark();
    expect(report.overall.recall).toBe(1);
    expect(report.overall.falsePositiveRate).toBe(0);
    expect(report.missed).toEqual([]);
    expect(report.falsePositives).toEqual([]);
    expect(report.overall.maxInputBytes).toBeGreaterThan(0);
  });

  it("reports recall for every §8.1 category", () => {
    const report = runRedactionBenchmark();
    for (const cat of SECRET_CATEGORIES) {
      // every category appears in the corpus and is fully recalled
      expect(report.byCategory[cat], cat).toBeTruthy();
      expect(report.byCategory[cat].recall, cat).toBe(1);
    }
  });

  it("measures every surface independently", () => {
    const report = runRedactionBenchmark();
    // each surface used in the corpus has a report entry
    const used = new Set([
      ...SECRET_CORPUS.positives.map((p) => p.surface),
      ...SECRET_CORPUS.negatives.map((n) => n.surface),
    ]);
    for (const s of used) {
      expect(SURFACES).toContain(s);
      expect(report.bySurface[s]).toBeTruthy();
      expect(report.bySurface[s].falsePositiveRate).toBe(0);
    }
  });

  it("computes P95 latency only when a clock is injected", () => {
    expect(runRedactionBenchmark().overall.p95LatencyMs).toBeNull();
    // deterministic fake clock: each read advances 1ms → every op measures 1ms.
    let t = 0;
    const clock = () => (t += 1);
    const report = runRedactionBenchmark(SECRET_CORPUS, { clock });
    expect(report.overall.p95LatencyMs).toBe(1);
  });

  it("surfaces a redactor's gaps honestly (a no-op redactor scores recall 0)", () => {
    const report = runRedactionBenchmark(SECRET_CORPUS, {
      redactor: (t) => t,
    });
    expect(report.overall.recall).toBe(0);
    expect(report.missed.length).toBe(SECRET_CORPUS.positives.length);
    // a no-op never alters safe text either → still no false positives
    expect(report.overall.falsePositiveRate).toBe(0);
  });
});
