/**
 * Credential proxy — keep the agent's real credentials out of the env that
 * run_shell / run_code / hook / plugin subprocesses inherit (P0 sandbox slice).
 * Pure + deterministic.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  CREDENTIAL_SENTINEL_PREFIX,
  isCredentialEnvName,
  makeSentinel,
  isSentinel,
  maskCredentialEnv,
  redactSecretValue,
  redactEnvForAudit,
  resolveApprovedInjection,
  credentialProxyEnabled,
  applyCredentialProxy,
} from "../../src/lib/credential-proxy.js";

describe("isCredentialEnvName", () => {
  it("flags well-known credential var names", () => {
    for (const n of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_ACCESS_KEY_ID",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "DB_PASSWORD",
      "MY_PASSPHRASE",
      "NPM_TOKEN",
      "AWS_SESSION_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]) {
      expect(isCredentialEnvName(n)).toBe(true);
    }
  });

  it("does NOT flag ordinary vars", () => {
    for (const n of [
      "PATH",
      "HOME",
      "MONKEY",
      "KEYBOARD",
      "TOKENIZER",
      "CC_SESSION_ID",
      "CLAUDECODE",
      "NODE_ENV",
    ]) {
      expect(isCredentialEnvName(n)).toBe(false);
    }
  });

  it("honors allow (force pass-through) and deny (force mask)", () => {
    expect(
      isCredentialEnvName("ANTHROPIC_API_KEY", {
        allow: ["ANTHROPIC_API_KEY"],
      }),
    ).toBe(false);
    expect(
      isCredentialEnvName("DATABASE_URL", { deny: ["DATABASE_URL"] }),
    ).toBe(true);
  });
});

describe("makeSentinel / isSentinel", () => {
  it("builds and recognizes sentinels; a real value is not one", () => {
    const s = makeSentinel("ANTHROPIC_API_KEY");
    expect(s.startsWith(CREDENTIAL_SENTINEL_PREFIX)).toBe(true);
    expect(isSentinel(s)).toBe(true);
    expect(isSentinel("sk-ant-realvalue")).toBe(false);
    expect(isSentinel(undefined)).toBe(false);
  });
});

describe("maskCredentialEnv", () => {
  const env = {
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "sk-ant-SECRET",
    GITHUB_TOKEN: "ghp_SECRET",
    CC_SESSION_ID: "sess-1",
  };

  it("replaces credential values with sentinels and keeps the rest verbatim", () => {
    const { env: out, masked, vault } = maskCredentialEnv(env);
    expect(out.PATH).toBe("/usr/bin");
    expect(out.CC_SESSION_ID).toBe("sess-1");
    expect(isSentinel(out.ANTHROPIC_API_KEY)).toBe(true);
    expect(isSentinel(out.GITHUB_TOKEN)).toBe(true);
    // the real secret is nowhere in the child env
    expect(JSON.stringify(out)).not.toContain("sk-ant-SECRET");
    expect(JSON.stringify(out)).not.toContain("ghp_SECRET");
    expect(masked).toEqual(["ANTHROPIC_API_KEY", "GITHUB_TOKEN"]);
    // the parent keeps the real values for approved injection
    expect(vault.get("ANTHROPIC_API_KEY")).toBe("sk-ant-SECRET");
  });

  it("does not mutate the input env", () => {
    const copy = { ...env };
    maskCredentialEnv(env);
    expect(env).toEqual(copy);
  });

  it("mode 'deny' removes the var entirely (no sentinel)", () => {
    const { env: out } = maskCredentialEnv(env, { mode: "deny" });
    expect("ANTHROPIC_API_KEY" in out).toBe(false);
    expect("GITHUB_TOKEN" in out).toBe(false);
    expect(out.PATH).toBe("/usr/bin");
  });

  it("never double-masks an already-sentineled value", () => {
    const pre = { ANTHROPIC_API_KEY: makeSentinel("ANTHROPIC_API_KEY") };
    const { env: out, masked, vault } = maskCredentialEnv(pre);
    expect(out.ANTHROPIC_API_KEY).toBe(pre.ANTHROPIC_API_KEY);
    expect(masked).toEqual([]);
    expect(vault.size).toBe(0);
  });
});

describe("audit redaction", () => {
  it("redactSecretValue never returns the real value", () => {
    expect(redactSecretValue("sk-ant-SECRET")).toBe("***");
    expect(redactSecretValue("")).toBe("");
    expect(redactSecretValue(null)).toBe(null);
  });

  it("redactEnvForAudit hides real secrets but keeps sentinels and plain vars", () => {
    const audited = redactEnvForAudit({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-SECRET",
      GITHUB_TOKEN: makeSentinel("GITHUB_TOKEN"),
    });
    expect(audited.PATH).toBe("/usr/bin");
    expect(audited.ANTHROPIC_API_KEY).toBe("***");
    expect(audited.GITHUB_TOKEN).toBe(makeSentinel("GITHUB_TOKEN"));
    expect(JSON.stringify(audited)).not.toContain("sk-ant-SECRET");
  });
});

describe("resolveApprovedInjection", () => {
  const vault = new Map([["ANTHROPIC_API_KEY", "sk-ant-SECRET"]]);

  it("injects the real value only for an approved host", () => {
    expect(
      resolveApprovedInjection(vault, "ANTHROPIC_API_KEY", {
        host: "api.anthropic.com",
        approvedHosts: ["api.anthropic.com"],
      }),
    ).toBe("sk-ant-SECRET");
  });

  it("fails closed for a non-approved host, empty host, or unknown var", () => {
    expect(
      resolveApprovedInjection(vault, "ANTHROPIC_API_KEY", {
        host: "evil.example.com",
        approvedHosts: ["api.anthropic.com"],
      }),
    ).toBe(null);
    expect(
      resolveApprovedInjection(vault, "ANTHROPIC_API_KEY", {
        host: "",
        approvedHosts: ["api.anthropic.com"],
      }),
    ).toBe(null);
    expect(
      resolveApprovedInjection(vault, "NOPE", {
        host: "api.anthropic.com",
        approvedHosts: ["api.anthropic.com"],
      }),
    ).toBe(null);
  });
});

describe("end-to-end: a real child cannot read a masked secret", () => {
  const readSecret =
    "process.stdout.write(process.env.ANTHROPIC_API_KEY || 'ABSENT')";

  it("a child spawned WITHOUT the proxy inherits the real secret", () => {
    const res = spawnSync(process.execPath, ["-e", readSecret], {
      env: { ...process.env, ANTHROPIC_API_KEY: "sk-ant-REALSECRET" },
      encoding: "utf8",
    });
    expect(res.stdout).toBe("sk-ant-REALSECRET"); // the leak the proxy closes
  });

  it("a child spawned WITH the masked env sees only the sentinel, never the secret", () => {
    const { env } = maskCredentialEnv({
      ...process.env,
      ANTHROPIC_API_KEY: "sk-ant-REALSECRET",
    });
    const res = spawnSync(process.execPath, ["-e", readSecret], {
      env,
      encoding: "utf8",
    });
    expect(res.stdout).toBe(makeSentinel("ANTHROPIC_API_KEY"));
    expect(res.stdout).not.toContain("REALSECRET");
  });

  it("mode 'deny' leaves the child with no such var at all", () => {
    const { env } = maskCredentialEnv(
      { ...process.env, ANTHROPIC_API_KEY: "sk-ant-REALSECRET" },
      { mode: "deny" },
    );
    const res = spawnSync(process.execPath, ["-e", readSecret], {
      env,
      encoding: "utf8",
    });
    expect(res.stdout).toBe("ABSENT");
  });
});

describe("credentialProxyEnabled / applyCredentialProxy", () => {
  it("is off by default (env unchanged, same reference)", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-SECRET", PATH: "/usr/bin" };
    const out = applyCredentialProxy(env, { env: {} });
    expect(out.enabled).toBe(false);
    expect(out.env).toBe(env); // byte-identical default path
    expect(out.masked).toEqual([]);
  });

  it("honors CC_CREDENTIAL_PROXY env and masks when on", () => {
    expect(credentialProxyEnabled({}, { CC_CREDENTIAL_PROXY: "1" })).toBe(true);
    expect(credentialProxyEnabled({}, { CC_CREDENTIAL_PROXY: "off" })).toBe(
      false,
    );
    const env = { ANTHROPIC_API_KEY: "sk-ant-SECRET", PATH: "/usr/bin" };
    const out = applyCredentialProxy(env, {
      env: { CC_CREDENTIAL_PROXY: "1" },
    });
    expect(out.enabled).toBe(true);
    expect(isSentinel(out.env.ANTHROPIC_API_KEY)).toBe(true);
    expect(out.env.PATH).toBe("/usr/bin");
    expect(out.vault.get("ANTHROPIC_API_KEY")).toBe("sk-ant-SECRET");
  });

  it("falls back to config.credentialProxy.enabled and merges allow/deny", () => {
    expect(
      credentialProxyEnabled({ credentialProxy: { enabled: true } }, {}),
    ).toBe(true);
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-SECRET",
      DATABASE_URL: "postgres://localhost:5432/db",
    };
    const out = applyCredentialProxy(env, {
      env: {},
      config: {
        credentialProxy: {
          enabled: true,
          allow: ["ANTHROPIC_API_KEY"],
          deny: ["DATABASE_URL"],
        },
      },
    });
    // allow forces the API key through untouched…
    expect(out.env.ANTHROPIC_API_KEY).toBe("sk-ant-SECRET");
    // …and deny masks the otherwise-unrecognized DATABASE_URL
    expect(isSentinel(out.env.DATABASE_URL)).toBe(true);
  });
});
