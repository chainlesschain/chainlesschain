import nativeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  GIT_CREDENTIAL_REF_PREFIX,
  GitCredentialStore,
} = require("../git-credential-store.js");
const { GitConfig } = require("../git-config.js");

const roots = [];

function temporaryRoot() {
  const root = nativeFs.mkdtempSync(
    path.join(os.tmpdir(), "cc-git-credential-store-"),
  );
  roots.push(root);
  return root;
}

function memoryStorage() {
  let payload = null;
  return {
    exists: () => payload !== null,
    load: () => (payload === null ? null : structuredClone(payload)),
    save: (next) => {
      payload = structuredClone(next);
      return true;
    },
    snapshot: () => (payload === null ? null : structuredClone(payload)),
  };
}

afterEach(() => {
  while (roots.length > 0) {
    nativeFs.rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("GitCredentialStore", () => {
  it("persists bounded secrets behind opaque references", () => {
    const storage = memoryStorage();
    const store = new GitCredentialStore({ storage });

    const references = store.set("default", {
      token: "github-token-value",
      password: "git-password-value",
    });

    expect(references.tokenRef).toMatch(
      new RegExp(`^${GIT_CREDENTIAL_REF_PREFIX}`),
    );
    expect(references.tokenRef).not.toContain("github-token-value");
    expect(store.get(references.tokenRef)).toBe("github-token-value");
    expect(store.get(references.passwordRef)).toBe("git-password-value");
    expect(JSON.stringify(storage.snapshot())).not.toContain("default");
  });

  it("rejects forged references and clears an exact scope", () => {
    const store = new GitCredentialStore({ storage: memoryStorage() });
    const { tokenRef } = store.set("default", { token: "token-value" });

    expect(() => store.get("cc-git-secret:v1:forged:token")).toThrow(
      expect.objectContaining({ code: "CC_GIT_CREDENTIAL_REF_INVALID" }),
    );
    expect(store.clear("default")).toBe(true);
    expect(store.get(tokenRef)).toBeNull();
  });

  it("fails closed when encrypted persistence is unavailable", () => {
    const store = new GitCredentialStore({
      storage: {
        exists: () => false,
        load: () => null,
        save: () => false,
      },
    });

    expect(() => store.set("default", { token: "token-value" })).toThrow(
      expect.objectContaining({
        code: "CC_GIT_CREDENTIAL_STORE_UNAVAILABLE",
      }),
    );
  });
});

describe("GitConfig encrypted credential migration", () => {
  it("migrates default and provider credentials before rewriting JSON", () => {
    const root = temporaryRoot();
    const configPath = path.join(root, "git-config.json");
    nativeFs.writeFileSync(
      configPath,
      JSON.stringify({
        enabled: true,
        remoteUrl: "https://github.com/example/repo.git",
        auth: {
          username: "alice",
          token: "legacy-github-token",
          password: "legacy-git-password",
        },
        providers: [
          {
            name: "github-primary",
            type: "github",
            auth: { token: "provider-github-token" },
          },
        ],
      }),
    );
    const store = new GitCredentialStore({ storage: memoryStorage() });
    const config = new GitConfig({ configPath, credentialStore: store });

    config.load();

    expect(config.getAuth()).toEqual(
      expect.objectContaining({
        username: "alice",
        token: "legacy-github-token",
        password: "legacy-git-password",
      }),
    );
    expect(config.getProviderConfigs()[0].auth.token).toBe(
      "provider-github-token",
    );
    const publicConfig = config.getAll();
    expect(publicConfig.auth).toEqual(
      expect.objectContaining({
        username: "alice",
        credentialConfigured: true,
      }),
    );
    expect(publicConfig.auth.token).toBeUndefined();
    expect(publicConfig.providers[0].auth.token).toBeUndefined();

    const persisted = nativeFs.readFileSync(configPath, "utf8");
    expect(persisted).not.toContain("legacy-github-token");
    expect(persisted).not.toContain("legacy-git-password");
    expect(persisted).not.toContain("provider-github-token");
    expect(persisted).toContain(GIT_CREDENTIAL_REF_PREFIX);
  });

  it("stores new credentials before exposing only sanitized config", () => {
    const root = temporaryRoot();
    const configPath = path.join(root, "git-config.json");
    const store = new GitCredentialStore({ storage: memoryStorage() });
    const config = new GitConfig({ configPath, credentialStore: store });

    expect(config.setAuth({ username: "bob", token: "new-github-token" })).toBe(
      true,
    );
    expect(config.getAuth().token).toBe("new-github-token");
    expect(config.getAll().auth).toEqual({
      username: "bob",
      credentialConfigured: true,
    });
    expect(nativeFs.readFileSync(configPath, "utf8")).not.toContain(
      "new-github-token",
    );

    expect(config.setAuth(null)).toBe(true);
    expect(config.getAuth()).toBeNull();
  });

  it("does not erase a legacy file when encrypted migration fails", () => {
    const root = temporaryRoot();
    const configPath = path.join(root, "git-config.json");
    nativeFs.writeFileSync(
      configPath,
      JSON.stringify({
        enabled: true,
        auth: { token: "retryable-legacy-token" },
      }),
    );
    const store = new GitCredentialStore({
      storage: {
        exists: () => false,
        load: () => null,
        save: () => false,
      },
    });
    const config = new GitConfig({ configPath, credentialStore: store });

    expect(config.load().enabled).toBe(false);
    expect(config.getAuth()).toBeNull();
    expect(nativeFs.readFileSync(configPath, "utf8")).toContain(
      "retryable-legacy-token",
    );
  });
});
