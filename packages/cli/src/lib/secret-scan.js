/**
 * Recall-first secret scanner + a labeled corpus and recall / false-positive /
 * latency benchmark (IDE gap §8.1 "凭据脱敏真实语料基准" of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md).
 *
 * [[ide-context-redaction.js]] `redactSecretsInText` is deliberately PRECISION-
 * first: it guards editor context that rides into the model, where mangling
 * everyday code teaches users to disable it. That posture is right there, but it
 * is the wrong one for the EXPORT gate — a diagnostic bundle / artifact / trace
 * that leaves the machine must fail toward NOT leaking, i.e. recall-first. §8.1
 * asks to prove a redactor with a real corpus (provider tokens, JWT, Bearer,
 * PEM, cloud creds, connection strings, cookies, `.env` variants) plus counter-
 * examples (sample values, hashes, UUIDs, plain base64) and to report recall,
 * false-positive rate, P95 latency and max input size — per surface.
 *
 * This module is that recall-first scanner (`scanSecrets` / `redactSecrets`),
 * the labeled `SECRET_CORPUS`, and `runRedactionBenchmark` which measures ANY
 * redactor against it. It does NOT touch the precision-first IDE redactor, so
 * default IDE-context behavior is unchanged; this is the scanner the future
 * "Secret Scan before export" gate (P1-9 诊断包) runs.
 *
 * Pure: no fs / RNG / clock. Latency is measured only when a `clock` is
 * injected, keeping the module deterministic in tests.
 */

import { isSecretEnvName } from "./credential-guard.js";

export const REDACTED = "[REDACTED]";

/** The export surfaces §8.1 wants measured independently. */
export const SURFACES = Object.freeze([
  "source_context",
  "transcript",
  "trace",
  "artifact",
  "diagnostic_bundle",
]);

/** The secret categories the scanner covers. */
export const SECRET_CATEGORIES = Object.freeze([
  "provider_token",
  "jwt",
  "bearer",
  "pem_private_key",
  "connection_string",
  "cookie",
  "env_assignment",
]);

// Each pattern is stored as a SOURCE string so `scanSecrets` compiles a fresh
// RegExp per call — a shared /g/ regex carries `lastIndex` state across calls
// and would skip matches. `replace` resets state itself, but scan/match do not.
const PATTERNS = [
  {
    category: "provider_token",
    // OpenAI/Anthropic sk-, GitHub PAT/OAuth, GitLab PAT, Slack xox*, AWS keys.
    source:
      "\\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16})\\b",
    flags: "g",
    replace: () => REDACTED,
  },
  {
    category: "jwt",
    // Three base64url segments; the first two begin `eyJ` (base64 of `{"`).
    source:
      "\\beyJ[A-Za-z0-9_-]{6,}\\.eyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}\\b",
    flags: "g",
    replace: () => REDACTED,
  },
  {
    category: "bearer",
    source: "\\bBearer\\s+[A-Za-z0-9\\-._~+/=]{8,}",
    flags: "g",
    replace: () => `Bearer ${REDACTED}`,
  },
  {
    category: "pem_private_key",
    // The bytes ARE the secret; a truncated END marker still redacts to the end.
    source:
      "-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\\s\\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)",
    flags: "g",
    replace: () => REDACTED,
  },
  {
    category: "connection_string",
    // scheme://user:PASSWORD@host — the embedded password is the secret. Only
    // the credential form (with `:pass@`) matches, so `https://example.com` is
    // untouched. Keep the scheme + user, swallow the password + host tail.
    source:
      "\\b((?:postgres|postgresql|mysql|mongodb(?:\\+srv)?|redis|rediss|amqp|amqps|https?|ftp|ssh):\\/\\/[^:\\s/@]+:)[^@\\s/]+@\\S+",
    flags: "gi",
    replace: (_m, prefix) => `${prefix}${REDACTED}`,
  },
  {
    category: "cookie",
    // A Cookie / Set-Cookie header value. Keep the header name, swallow the value.
    source: "\\b(Set-Cookie|Cookie)(\\s*:\\s*)\\S[^\\n\\r]*",
    flags: "gi",
    replace: (_m, name, sep) => `${name}${sep}${REDACTED}`,
  },
  {
    category: "env_assignment",
    // `API_KEY = "value"` / `token: value`. The key must contain a boundary-
    // delimited secret word (isSecretEnvName), the value a bare token-like run.
    // The lookahead rejects `token = getToken()` (code, not a secret).
    source:
      "\\b([A-Za-z_][A-Za-z0-9_-]*)([\"']?\\s*[=:]\\s*)([\"']?)([A-Za-z0-9+/=_.\\-]{8,})\\3(?![A-Za-z0-9+/=_.\\-(])",
    flags: "g",
    replace: (m, key, sep, quote) =>
      isSecretEnvName(key.replace(/-/g, "_"))
        ? `${key}${sep}${quote}${REDACTED}${quote}`
        : m, // key isn't secret-shaped → leave the assignment alone
    // env_assignment only counts as a detection when the key gates true; a
    // guard so scanSecrets doesn't report `count = 12345678` as a secret.
    guard: (m, groups) => isSecretEnvName(String(groups[0]).replace(/-/g, "_")),
  },
];

/**
 * Find every secret-shaped span in `text`. Recall-first: overlapping categories
 * all report, so an assignment holding a JWT is caught by both.
 *
 * @param {string} text
 * @returns {Array<{category:string, index:number, length:number, match:string}>}
 */
export function scanSecrets(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const findings = [];
  for (const p of PATTERNS) {
    const re = new RegExp(p.source, p.flags);
    for (const m of text.matchAll(re)) {
      if (p.guard && !p.guard(m[0], m.slice(1))) continue;
      findings.push({
        category: p.category,
        index: m.index,
        length: m[0].length,
        match: m[0],
      });
    }
  }
  return findings.sort((a, b) => a.index - b.index || a.length - b.length);
}

/**
 * Redact every secret-shaped span, keeping the surviving structure a human /
 * agent still needs (the `Bearer` word, a header/key name, a connection scheme)
 * while swallowing the secret value.
 *
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const p of PATTERNS) {
    const re = new RegExp(p.source, p.flags);
    out = out.replace(re, p.replace);
  }
  return out;
}

/** Whether `text` contains any secret (the export gate's fail-closed check). */
export function containsSecret(text) {
  return scanSecrets(text).length > 0;
}

// ── Labeled corpus ───────────────────────────────────────────────────────────
//
// Positives carry the exact `secret` substring that MUST disappear after
// redaction; negatives (sample/placeholder values, hashes, UUIDs, plain base64,
// ordinary code) MUST pass through byte-for-byte. Items are spread across the
// export surfaces so the benchmark can report per-surface.

const POSITIVES = [
  {
    id: "openai",
    category: "provider_token",
    surface: "transcript",
    secret: "sk-abcd1234efgh5678ijkl",
    text: 'client = OpenAI(api_key="sk-abcd1234efgh5678ijkl")',
  },
  {
    id: "github_pat",
    category: "provider_token",
    surface: "artifact",
    secret: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    text: "git remote set-url origin https://ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@github.com/x/y",
  },
  {
    id: "aws",
    category: "provider_token",
    surface: "diagnostic_bundle",
    secret: "AKIAIOSFODNN7EXAMPLE",
    text: "aws_access_key_id AKIAIOSFODNN7EXAMPLE",
  },
  {
    id: "jwt",
    category: "jwt",
    surface: "trace",
    secret:
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    text: "Authorization header carried eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  },
  {
    id: "bearer",
    category: "bearer",
    surface: "source_context",
    secret: "aG9sZDpteS1zZWNyZXQtdG9rZW4",
    text: "curl -H 'Authorization: Bearer aG9sZDpteS1zZWNyZXQtdG9rZW4' https://api",
  },
  {
    id: "pem",
    category: "pem_private_key",
    surface: "artifact",
    secret:
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBOwIBAAJBAKj34Gkx...\n-----END RSA PRIVATE KEY-----",
    text: "key file:\n-----BEGIN RSA PRIVATE KEY-----\nMIIBOwIBAAJBAKj34Gkx...\n-----END RSA PRIVATE KEY-----\n",
  },
  {
    id: "postgres",
    category: "connection_string",
    surface: "diagnostic_bundle",
    secret: "s3cr3tP@ss",
    text: "DATABASE_URL=postgres://appuser:s3cr3tP@ss@db.internal:5432/prod",
  },
  {
    id: "mongodb",
    category: "connection_string",
    surface: "trace",
    secret: "hunter2hunter2",
    text: "mongodb+srv://svc:hunter2hunter2@cluster0.mongodb.net/app",
  },
  {
    id: "cookie",
    category: "cookie",
    surface: "transcript",
    secret: "sessionid=9f8b7c6d5e4f3a2b1c0d",
    text: "Set-Cookie: sessionid=9f8b7c6d5e4f3a2b1c0d; HttpOnly",
  },
  {
    id: "env_password",
    category: "env_assignment",
    surface: "diagnostic_bundle",
    secret: "Sup3rSecret_Value-123",
    text: 'DB_PASSWORD="Sup3rSecret_Value-123"',
  },
];

const NEGATIVES = [
  {
    id: "uuid",
    surface: "trace",
    text: "requestId = 550e8400-e29b-41d4-a716-446655440000",
  },
  {
    id: "git_sha",
    surface: "transcript",
    text: "commit beaa3f9ec7069258aad5e8587d32f779da5e5d20 landed",
  },
  {
    id: "plain_base64",
    surface: "artifact",
    text: "payload blob aGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYSBzZWNyZXQ=",
  },
  {
    id: "prose",
    surface: "source_context",
    text: "The function returns the number of open editor tabs.",
  },
  {
    id: "code_call",
    surface: "source_context",
    text: "const token = getToken(config)",
  },
  {
    id: "nonsecret_assignment",
    surface: "diagnostic_bundle",
    text: "retryCount = 12345678",
  },
  {
    id: "plain_url",
    surface: "artifact",
    text: "docs at https://example.com/guide/index.html",
  },
  {
    id: "hex_digest",
    surface: "diagnostic_bundle",
    text: "sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  },
];

export const SECRET_CORPUS = Object.freeze({
  positives: Object.freeze(POSITIVES.map((p) => Object.freeze(p))),
  negatives: Object.freeze(NEGATIVES.map((n) => Object.freeze(n))),
});

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx];
}

/**
 * Measure a redactor against a labeled corpus: recall (positives whose secret
 * disappeared), false-positive rate (negatives that were altered), max input
 * size, and — only when a `clock` is injected — P95 redaction latency. Reports
 * overall, per category (recall) and per surface (recall + FPR).
 *
 * @param {object} [corpus=SECRET_CORPUS]
 * @param {object} [opts]
 * @param {(text:string)=>string} [opts.redactor=redactSecrets]
 * @param {()=>number} [opts.clock]  ms clock; enables latency metrics
 * @returns {object} the benchmark report
 */
export function runRedactionBenchmark(corpus = SECRET_CORPUS, opts = {}) {
  const redactor =
    typeof opts.redactor === "function" ? opts.redactor : redactSecrets;
  const clock = typeof opts.clock === "function" ? opts.clock : null;
  const positives = Array.isArray(corpus?.positives) ? corpus.positives : [];
  const negatives = Array.isArray(corpus?.negatives) ? corpus.negatives : [];

  const latencies = [];
  let maxInputBytes = 0;
  const measure = (text) => {
    maxInputBytes = Math.max(maxInputBytes, Buffer.byteLength(text, "utf8"));
    if (!clock) return redactor(text);
    const t0 = Number(clock());
    const out = redactor(text);
    const t1 = Number(clock());
    if (Number.isFinite(t0) && Number.isFinite(t1)) latencies.push(t1 - t0);
    return out;
  };

  const catRecall = {}; // category -> {detected, total}
  const surface = {}; // surface -> {detected, posTotal, falsePos, negTotal}
  const bumpSurface = (s) =>
    (surface[s] = surface[s] || {
      detected: 0,
      posTotal: 0,
      falsePos: 0,
      negTotal: 0,
    });

  const missed = [];
  let detected = 0;
  for (const item of positives) {
    const out = measure(item.text);
    const ok = typeof item.secret === "string" && !out.includes(item.secret);
    const cat = (catRecall[item.category] = catRecall[item.category] || {
      detected: 0,
      total: 0,
    });
    cat.total += 1;
    const s = bumpSurface(item.surface);
    s.posTotal += 1;
    if (ok) {
      detected += 1;
      cat.detected += 1;
      s.detected += 1;
    } else {
      missed.push(item.id);
    }
  }

  const falsePositives = [];
  let fp = 0;
  for (const item of negatives) {
    const out = measure(item.text);
    const s = bumpSurface(item.surface);
    s.negTotal += 1;
    if (out !== item.text) {
      fp += 1;
      s.falsePos += 1;
      falsePositives.push(item.id);
    }
  }

  const byCategory = {};
  for (const [c, v] of Object.entries(catRecall)) {
    byCategory[c] = { recall: v.total ? v.detected / v.total : 1, ...v };
  }
  const bySurface = {};
  for (const [sName, v] of Object.entries(surface)) {
    bySurface[sName] = {
      recall: v.posTotal ? v.detected / v.posTotal : 1,
      falsePositiveRate: v.negTotal ? v.falsePos / v.negTotal : 0,
      ...v,
    };
  }

  const sorted = latencies.slice().sort((a, b) => a - b);
  return {
    overall: {
      recall: positives.length ? detected / positives.length : 1,
      falsePositiveRate: negatives.length ? fp / negatives.length : 0,
      positives: positives.length,
      negatives: negatives.length,
      maxInputBytes,
      p95LatencyMs: clock ? percentile(sorted, 95) : null,
    },
    missed,
    falsePositives,
    byCategory,
    bySurface,
  };
}
