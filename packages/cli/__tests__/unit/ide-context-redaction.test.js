/**
 * IDE-context redaction pure core (src/lib/ide-context-redaction.js):
 * credential-file entries are dropped from IDE-shared context, secret-shaped
 * text is scrubbed, ordinary code survives, and CC_IDE_CONTEXT_REDACTION=0
 * turns the whole thing off.
 */
import { describe, it, expect } from "vitest";
import {
  ideRedactionEnabled,
  filterIdeFileEntry,
  redactSecretsInText,
} from "../../src/lib/ide-context-redaction.js";

const OFF = { CC_IDE_CONTEXT_REDACTION: "0" };

describe("ideRedactionEnabled", () => {
  it("defaults on", () => {
    expect(ideRedactionEnabled({})).toBe(true);
    expect(ideRedactionEnabled({ CC_IDE_CONTEXT_REDACTION: "1" })).toBe(true);
  });
  it("is disabled by 0/false/no/off", () => {
    for (const v of ["0", "false", "no", "OFF"]) {
      expect(ideRedactionEnabled({ CC_IDE_CONTEXT_REDACTION: v })).toBe(false);
    }
  });
});

describe("filterIdeFileEntry", () => {
  it("drops credential files (returns null)", () => {
    expect(filterIdeFileEntry(".env", { env: {} })).toBe(null);
    expect(filterIdeFileEntry("C:\\proj\\.env", { env: {} })).toBe(null);
    expect(filterIdeFileEntry("/home/u/.aws/credentials", { env: {} })).toBe(
      null,
    );
    expect(filterIdeFileEntry("~/.ssh/id_rsa", { env: {} })).toBe(null);
    expect(filterIdeFileEntry("certs/server.pem", { env: {} })).toBe(null);
    expect(filterIdeFileEntry("config/secrets.yaml", { env: {} })).toBe(null);
  });

  it("passes ordinary files and safe env templates through unchanged", () => {
    expect(filterIdeFileEntry("src/index.js", { env: {} })).toBe(
      "src/index.js",
    );
    expect(filterIdeFileEntry(".env.example", { env: {} })).toBe(
      ".env.example",
    );
    expect(filterIdeFileEntry("C:/proj/package.json", { env: {} })).toBe(
      "C:/proj/package.json",
    );
    expect(filterIdeFileEntry("keys/server.pub", { env: {} })).toBe(
      "keys/server.pub",
    );
  });

  it("escape hatch passes credential files through", () => {
    expect(filterIdeFileEntry(".env", { env: OFF })).toBe(".env");
    expect(filterIdeFileEntry("~/.ssh/id_rsa", { env: OFF })).toBe(
      "~/.ssh/id_rsa",
    );
  });
});

describe("redactSecretsInText", () => {
  const env = {};

  it("redacts AWS access-key ids", () => {
    const out = redactSecretsInText("key AKIAIOSFODNN7EXAMPL2 end", { env });
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPL2");
  });

  it("redacts Bearer tokens but keeps the header shape", () => {
    const out = redactSecretsInText(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
      { env },
    );
    expect(out).toContain("Bearer [REDACTED]");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("redacts PEM private-key blocks (including truncated ones)", () => {
    const pem =
      "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\nafter";
    const out = redactSecretsInText(pem, { env });
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("MIIEowIBAAKCAQEA");

    const truncated = "x\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk";
    const outT = redactSecretsInText(truncated, { env });
    expect(outT).not.toContain("b3BlbnNzaC1rZXk");
  });

  it("redacts vendor token prefixes (sk- / ghp_ / glpat-)", () => {
    const out = redactSecretsInText(
      "keys: sk-ant-api03-abcdefghij0123456789 and ghp_abcdefghijklmnopqrst1234",
      { env },
    );
    expect(out).not.toContain("sk-ant-api03");
    expect(out).not.toContain("ghp_abcdefghijklmnopqrst1234");
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it("redacts only the VALUE of secret assignments, keeping the key", () => {
    const out = redactSecretsInText(
      'API_KEY=abcd1234efgh5678\ndb_password: "hunter2hunter2"\n"client_secret": "sup3rsecretvalue"',
      { env },
    );
    expect(out).toContain("API_KEY=[REDACTED]");
    expect(out).toContain('db_password: "[REDACTED]"');
    expect(out).toContain('"client_secret": "[REDACTED]"');
    expect(out).not.toContain("abcd1234efgh5678");
    expect(out).not.toContain("hunter2hunter2");
    expect(out).not.toContain("sup3rsecretvalue");
  });

  it("does not maul ordinary code", () => {
    const code = [
      "const apiKeyName = fetchKey();",
      "const token = getToken();",
      "if (keyboard.TOKENIZER) return monkeyPatch;",
      "password reset flow docs",
      "const total = count + 1;",
    ].join("\n");
    const out = redactSecretsInText(code, { env });
    expect(out).toContain("const apiKeyName = fetchKey();");
    expect(out).toContain("const token = getToken();");
    expect(out).toContain("keyboard.TOKENIZER");
    expect(out).toContain("password reset flow docs");
    expect(out).toContain("const total = count + 1;");
  });

  it("passes non-strings and empty text through", () => {
    expect(redactSecretsInText(null, { env })).toBe(null);
    expect(redactSecretsInText(undefined, { env })).toBe(undefined);
    expect(redactSecretsInText("", { env })).toBe("");
  });

  it("escape hatch returns text untouched", () => {
    const raw = "API_KEY=abcd1234efgh5678 Bearer eyJhbGciOiJIUzI1NiJ9.x.y";
    expect(redactSecretsInText(raw, { env: OFF })).toBe(raw);
  });
});
