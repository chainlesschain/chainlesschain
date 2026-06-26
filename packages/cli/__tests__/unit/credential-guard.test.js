/**
 * Credential READ guard (Claude-Code 2.1.189 `sandbox.credentials` parity) —
 * pattern lib + executeTool seam: read_file at a credential path and run_shell
 * commands that cat a credential file / echo a secret env var require
 * confirmation; explicit settings `allow` is the only bypass; headless fails
 * closed; CC_CREDENTIAL_GUARD=0 disables it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  credentialFileReason,
  credentialFileReasonResolved,
  commandReadsCredentials,
  credentialGuardDisabled,
  _deps as credGuardDeps,
} from "../../src/lib/credential-guard.js";
import { executeTool } from "../../src/runtime/agent-core.js";

describe("credentialFileReason", () => {
  it("flags .env and real env variants", () => {
    expect(credentialFileReason(".env")).toMatch(/environment\/secret/);
    expect(credentialFileReason("/app/.env.local")).toMatch(/environment/);
    expect(credentialFileReason("project/.env.production")).toMatch(
      /environment/,
    );
  });

  it("does NOT flag committed env templates", () => {
    expect(credentialFileReason(".env.example")).toBeNull();
    expect(credentialFileReason("config/.env.sample")).toBeNull();
    expect(credentialFileReason(".env.template")).toBeNull();
    expect(credentialFileReason(".env.dist")).toBeNull();
  });

  it("flags credential basenames + AWS/kube/docker/gh paths", () => {
    expect(credentialFileReason("~/.aws/credentials")).toMatch(/credential/);
    expect(credentialFileReason("C:\\Users\\u\\.aws\\credentials")).toMatch(
      /credential/,
    );
    expect(credentialFileReason("/home/u/.npmrc")).toMatch(/credential/);
    expect(credentialFileReason(".netrc")).toMatch(/credential/);
    expect(credentialFileReason(".git-credentials")).toMatch(/credential/);
    expect(credentialFileReason("~/.kube/config")).toMatch(/credential/);
    expect(credentialFileReason("~/.docker/config.json")).toMatch(/credential/);
    expect(credentialFileReason("~/.config/gh/hosts.yml")).toMatch(
      /credential/,
    );
  });

  it("flags private-key / cert material but not public siblings", () => {
    expect(credentialFileReason("~/.ssh/id_rsa")).toMatch(/credential/);
    expect(credentialFileReason("server.pem")).toMatch(/private key/);
    expect(credentialFileReason("cert.pfx")).toMatch(/private key/);
    expect(credentialFileReason("keystore.jks")).toMatch(/private key/);
    // public material is safe
    expect(credentialFileReason("~/.ssh/id_rsa.pub")).toBeNull();
    expect(credentialFileReason("server.crt")).toBeNull();
    expect(credentialFileReason("ca.cert")).toBeNull();
  });

  it("flags secrets.{json,yaml} files", () => {
    expect(credentialFileReason("config/secrets.json")).toMatch(/secrets/);
    expect(credentialFileReason("secret.yaml")).toMatch(/secrets/);
  });

  it("flags FIDO SSH keys, kubeconfig, .htpasswd, terraformrc", () => {
    expect(credentialFileReason("~/.ssh/id_ed25519_sk")).toMatch(/credential/);
    expect(credentialFileReason("~/.ssh/id_ecdsa_sk")).toMatch(/credential/);
    expect(credentialFileReason("/etc/nginx/.htpasswd")).toMatch(/credential/);
    expect(credentialFileReason("deploy/kubeconfig")).toMatch(/credential/);
    expect(credentialFileReason("~/.terraformrc")).toMatch(/credential/);
    expect(credentialFileReason("terraform.rc")).toMatch(/credential/);
  });

  it("flags GCP service-account key JSON (but not arbitrary json)", () => {
    expect(credentialFileReason("gcp/service-account.json")).toMatch(
      /credential/,
    );
    expect(credentialFileReason("my-service_account-key.json")).toMatch(
      /credential/,
    );
    expect(credentialFileReason("config/app-config.json")).toBeNull();
  });

  it("leaves everyday files alone", () => {
    expect(credentialFileReason("src/index.js")).toBeNull();
    expect(credentialFileReason("package.json")).toBeNull();
    expect(credentialFileReason("README.md")).toBeNull();
    expect(credentialFileReason("docs/env.md")).toBeNull();
    expect(credentialFileReason("kubernetes.yaml")).toBeNull(); // not a kubeconfig
    expect(credentialFileReason("")).toBeNull();
  });
});

describe("credentialFileReasonResolved (symlink-aware)", () => {
  afterEach(() => {
    // Restore the real impls in case a test swapped them.
    credGuardDeps.realpathSync = fs.realpathSync;
    credGuardDeps.resolve = path.resolve;
  });

  it("flags an innocent-named path whose real target is a credential file", () => {
    // Deterministic fake: notes.txt resolves to ~/.ssh/id_rsa.
    credGuardDeps.realpathSync = (p) => {
      if (String(p).endsWith("notes.txt")) return "/home/u/.ssh/id_rsa";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    const reason = credentialFileReasonResolved("notes.txt", { cwd: "/work" });
    expect(reason).toMatch(/credential file/);
    expect(reason).toMatch(/\(via symlink\)/);
  });

  it("short-circuits on a literal credential name (no symlink suffix)", () => {
    let called = false;
    credGuardDeps.realpathSync = () => {
      called = true;
      return "/x";
    };
    const reason = credentialFileReasonResolved(".env", { cwd: "/work" });
    expect(reason).toMatch(/environment\/secret/);
    expect(reason).not.toMatch(/via symlink/);
    expect(called).toBe(false); // literal hit wins; never touches the fs
  });

  it("returns null for an ordinary file that resolves to an ordinary file", () => {
    credGuardDeps.realpathSync = (p) =>
      `/canonical/${path.basename(String(p))}`;
    expect(
      credentialFileReasonResolved("notes.txt", { cwd: "/work" }),
    ).toBeNull();
  });

  it("falls back to null when the path can't be resolved (read would fail anyway)", () => {
    credGuardDeps.realpathSync = () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    expect(
      credentialFileReasonResolved("missing.txt", { cwd: "/work" }),
    ).toBeNull();
  });

  it("accepts an injected deps object via opts.deps", () => {
    const reason = credentialFileReasonResolved("link", {
      cwd: "/w",
      deps: {
        resolve: (a, b) => `${a}/${b}`,
        realpathSync: () => "/secrets/id_ed25519",
      },
    });
    expect(reason).toMatch(/credential file.*\(via symlink\)/);
  });
});

describe("commandReadsCredentials", () => {
  it("flags content-readers aimed at a credential file", () => {
    expect(commandReadsCredentials("cat .env")?.kind).toBe("file");
    expect(commandReadsCredentials("cat ~/.aws/credentials")?.reason).toMatch(
      /credential/,
    );
    expect(commandReadsCredentials("type C:\\Users\\u\\.npmrc")?.kind).toBe(
      "file",
    );
    expect(commandReadsCredentials("Get-Content ./id_rsa")?.kind).toBe("file");
    expect(commandReadsCredentials("head -n 5 server.pem")?.kind).toBe("file");
  });

  it("flags echoing a secret-looking env var", () => {
    expect(commandReadsCredentials("echo $ANTHROPIC_API_KEY")?.kind).toBe(
      "env-var",
    );
    expect(
      commandReadsCredentials('printf "%s" "$AWS_SECRET_ACCESS_KEY"')?.kind,
    ).toBe("env-var");
    expect(commandReadsCredentials("echo %GITHUB_TOKEN%")?.kind).toBe(
      "env-var",
    );
    expect(commandReadsCredentials("Write-Host $env:DB_PASSWORD")?.kind).toBe(
      "env-var",
    );
    expect(
      commandReadsCredentials("Get-Content env:OPENAI_API_KEY")?.kind,
    ).toBe("env-var");
    expect(commandReadsCredentials("printenv ANTHROPIC_API_KEY")?.kind).toBe(
      "env-var",
    );
  });

  it("flags full-environment dumps", () => {
    expect(commandReadsCredentials("printenv")?.kind).toBe("env-dump");
    expect(commandReadsCredentials("env")?.kind).toBe("env-dump");
    expect(commandReadsCredentials("Get-ChildItem env:")?.kind).toBe(
      "env-dump",
    );
  });

  it("catches a credential read smuggled after a benign segment", () => {
    expect(commandReadsCredentials("echo hi && cat .env")?.kind).toBe("file");
    expect(commandReadsCredentials("ls; echo $OPENAI_API_KEY")?.kind).toBe(
      "env-var",
    );
  });

  it("does NOT flag benign reads / non-secret vars / consuming a key", () => {
    expect(commandReadsCredentials("cat README.md")).toBeNull();
    expect(commandReadsCredentials("cat .env.example")).toBeNull();
    expect(commandReadsCredentials("echo $PATH")).toBeNull();
    expect(commandReadsCredentials("echo $HOME")).toBeNull();
    expect(commandReadsCredentials("printenv PATH")).toBeNull();
    expect(commandReadsCredentials("env FOO=bar npm test")).toBeNull();
    // consuming a key (not echoing it) is fine — value never lands in output
    expect(
      commandReadsCredentials("mytool --token $API_TOKEN deploy"),
    ).toBeNull();
    expect(commandReadsCredentials("")).toBeNull();
  });
});

describe("credentialGuardDisabled", () => {
  it("default ON; only explicit 0/false/no/off disables", () => {
    expect(credentialGuardDisabled({})).toBe(false);
    expect(credentialGuardDisabled({ CC_CREDENTIAL_GUARD: "1" })).toBe(false);
    for (const v of ["0", "false", "no", "off", "OFF"]) {
      expect(credentialGuardDisabled({ CC_CREDENTIAL_GUARD: v })).toBe(true);
    }
  });
});

describe("executeTool credential-guard seam", () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-credguard-"));
    delete process.env.CC_CREDENTIAL_GUARD;
  });

  afterEach(() => {
    delete process.env.CC_CREDENTIAL_GUARD;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("headless (no confirmer) read_file of .env fails closed", async () => {
    fs.writeFileSync(path.join(tmp, ".env"), "SECRET=hunter2", "utf-8");
    const res = await executeTool("read_file", { path: ".env" }, { cwd: tmp });
    expect(res.error).toMatch(/\[Credential Guard\]/);
    expect(res.policy).toMatchObject({
      decision: "ask",
      via: "credential-guard",
    });
    expect(res.content).toBeUndefined();
  });

  it("declined confirmation blocks; approval returns the content", async () => {
    fs.writeFileSync(path.join(tmp, ".env"), "API_KEY=abc123", "utf-8");

    const denied = await executeTool(
      "read_file",
      { path: ".env" },
      { cwd: tmp, permissionConfirm: async () => false },
    );
    expect(denied.error).toMatch(/Credential Guard/);

    let seen = null;
    const ok = await executeTool(
      "read_file",
      { path: ".env" },
      {
        cwd: tmp,
        permissionConfirm: async (q) => {
          seen = q;
          return true;
        },
      },
    );
    expect(ok.error).toBeUndefined();
    expect(ok.content).toBe("API_KEY=abc123");
    expect(seen.reason).toMatch(/credential access: environment\/secret/);
  });

  it("explicit settings allow rule bypasses without confirming", async () => {
    fs.writeFileSync(path.join(tmp, ".env"), "TOKEN=xyz", "utf-8");
    let confirmCalled = false;
    const res = await executeTool(
      "read_file",
      { path: ".env" },
      {
        cwd: tmp,
        permissionRules: { allow: ["Read"] },
        permissionConfirm: async () => {
          confirmCalled = true;
          return false;
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(res.content).toBe("TOKEN=xyz");
    expect(confirmCalled).toBe(false);
  });

  it("CC_CREDENTIAL_GUARD=0 disables the guard (headless read proceeds)", async () => {
    fs.writeFileSync(path.join(tmp, ".env"), "K=v", "utf-8");
    process.env.CC_CREDENTIAL_GUARD = "0";
    const res = await executeTool("read_file", { path: ".env" }, { cwd: tmp });
    expect(res.error).toBeUndefined();
    expect(res.content).toBe("K=v");
  });

  it("ordinary file reads are untouched by the guard", async () => {
    fs.writeFileSync(path.join(tmp, "notes.txt"), "plain", "utf-8");
    const res = await executeTool(
      "read_file",
      { path: "notes.txt" },
      { cwd: tmp },
    );
    expect(res.error).toBeUndefined();
    expect(res.content).toBe("plain");
  });

  it("blocks a symlink-obfuscated credential read (real symlink, where privileged)", async () => {
    fs.writeFileSync(
      path.join(tmp, "id_rsa"),
      "-----PRIVATE KEY-----",
      "utf-8",
    );
    let linked = false;
    try {
      fs.symlinkSync(path.join(tmp, "id_rsa"), path.join(tmp, "notes.txt"));
      linked = true;
    } catch {
      // Unprivileged Windows / restricted FS — symlink creation denied; skip.
    }
    if (!linked) return;

    const res = await executeTool(
      "read_file",
      { path: "notes.txt" },
      { cwd: tmp },
    );
    expect(res.error).toMatch(/\[Credential Guard\]/);
    expect(res.policy).toMatchObject({ via: "credential-guard" });
    expect(res.content).toBeUndefined();
  });

  it("run_shell credential reads fail closed before executing (cross-platform deny path)", async () => {
    const catEnv = await executeTool(
      "run_shell",
      { command: "cat .env" },
      { cwd: tmp },
    );
    expect(catEnv.error).toMatch(/\[Credential Guard\]/);

    const echoSecret = await executeTool(
      "run_shell",
      { command: "echo $ANTHROPIC_API_KEY" },
      { cwd: tmp },
    );
    expect(echoSecret.error).toMatch(/\[Credential Guard\]/);
    expect(echoSecret.policy).toMatchObject({ via: "credential-guard" });
  });

  it("content search redacts credential-file matches (no secret line leaks)", async () => {
    // secrets.yaml is matched by the `*` glob on every platform (no leading-dot
    // glob ambiguity); the secret sits on the line that also holds the pattern.
    fs.writeFileSync(
      path.join(tmp, "secrets.yaml"),
      "password: topsecret123 NEEDLE\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmp, "note.txt"),
      "harmless NEEDLE here\n",
      "utf-8",
    );

    const res = await executeTool(
      "search_files",
      { pattern: "NEEDLE", content_search: true },
      { cwd: tmp },
    );

    const blob = JSON.stringify(res);
    // The secret value must never appear in the tool output…
    expect(blob).not.toContain("topsecret123");
    // …the credential file is surfaced as an existence-only redaction marker…
    expect(blob).toMatch(/credential file.*secrets\.yaml.*redacted/i);
    // …and the ordinary match is still returned.
    expect(blob).toContain("note.txt");
  });
});
