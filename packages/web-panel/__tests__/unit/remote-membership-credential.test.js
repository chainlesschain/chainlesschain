import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteMembershipCredentialManager,
  signRemoteMembershipChallenge,
} from "../../src/utils/remote-membership-credential.js";

function memoryCredentialStore(initial = []) {
  const records = new Map(initial.map((record) => [record.sessionId, record]));
  return {
    records,
    addCalls: 0,
    deleteCalls: 0,
    async get(sessionId) {
      return records.get(sessionId);
    },
    async add(record) {
      this.addCalls += 1;
      if (records.has(record.sessionId)) return false;
      records.set(record.sessionId, record);
      return true;
    },
    async put(record) {
      records.set(record.sessionId, record);
    },
    async delete(sessionId) {
      this.deleteCalls += 1;
      records.delete(sessionId);
    },
  };
}

function base64UrlBytes(value) {
  return Buffer.from(value, "base64url");
}

describe("remote membership credential", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("btoa", (value) =>
      Buffer.from(value, "binary").toString("base64"),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists only non-extractable CryptoKeys and removes legacy PKCS#8 storage", async () => {
    const store = memoryCredentialStore();
    const legacyStorage = {
      removeItem: vi.fn(),
      getItem: vi.fn(() => {
        throw new Error("legacy private key must never be read");
      }),
      setItem: vi.fn(() => {
        throw new Error("private key must never be serialized");
      }),
    };
    const manager = createRemoteMembershipCredentialManager({
      subtle: webcrypto.subtle,
      credentialStore: store,
      legacyStorage,
    });

    const credential = await manager.getOrCreate("session-1");
    const persisted = store.records.get("session-1");

    expect(credential.persistence).toBe("indexeddb");
    expect(credential.privateKey.extractable).toBe(false);
    expect(persisted.privateKey).toBe(credential.privateKey);
    expect(persisted).not.toHaveProperty("privateKeyPkcs8");
    await expect(
      webcrypto.subtle.exportKey("pkcs8", credential.privateKey),
    ).rejects.toThrow();
    expect(legacyStorage.removeItem).toHaveBeenCalledWith(
      "cc.remote-membership.ed25519.v1:session-1",
    );
    expect(legacyStorage.getItem).not.toHaveBeenCalled();
    expect(legacyStorage.setItem).not.toHaveBeenCalled();
  });

  it("binds and reloads the same principal/key across manager instances", async () => {
    const store = memoryCredentialStore();
    const first = createRemoteMembershipCredentialManager({
      subtle: webcrypto.subtle,
      credentialStore: store,
      legacyStorage: null,
    });
    const created = await first.getOrCreate("session-2");
    const bound = await first.rememberPrincipal("session-2", "principal-2");
    const second = createRemoteMembershipCredentialManager({
      subtle: webcrypto.subtle,
      credentialStore: store,
      legacyStorage: null,
    });
    const reloaded = await second.getOrCreate("session-2");

    expect(bound.publicKey).toBe(created.publicKey);
    expect(reloaded.publicKey).toBe(created.publicKey);
    expect(reloaded.principalId).toBe("principal-2");
    await expect(
      first.rememberPrincipal("session-2", "principal-tampered"),
    ).rejects.toThrow(/binding changed/);
  });

  it("serializes same-tab creation and adopts a cross-context race winner", async () => {
    const store = memoryCredentialStore();
    const a = createRemoteMembershipCredentialManager({
      subtle: webcrypto.subtle,
      credentialStore: store,
      legacyStorage: null,
    });
    const [sameA, sameB] = await Promise.all([
      a.getOrCreate("session-3"),
      a.getOrCreate("session-3"),
    ]);
    expect(sameA.publicKey).toBe(sameB.publicKey);
    expect(store.addCalls).toBe(1);

    const b = createRemoteMembershipCredentialManager({
      subtle: webcrypto.subtle,
      credentialStore: store,
      legacyStorage: null,
    });
    const c = createRemoteMembershipCredentialManager({
      subtle: webcrypto.subtle,
      credentialStore: store,
      legacyStorage: null,
    });
    const [winnerB, winnerC] = await Promise.all([
      b.getOrCreate("session-4"),
      c.getOrCreate("session-4"),
    ]);
    expect(winnerB.publicKey).toBe(winnerC.publicKey);
  });

  it("falls back to a stable in-memory non-extractable key when storage fails", async () => {
    const unavailable = {
      async get() {
        throw new Error("storage denied");
      },
      async add() {
        throw new Error("storage denied");
      },
      async put() {
        throw new Error("storage denied");
      },
      delete: vi.fn(async () => {}),
    };
    const manager = createRemoteMembershipCredentialManager({
      subtle: webcrypto.subtle,
      credentialStore: unavailable,
      legacyStorage: null,
    });
    const first = await manager.getOrCreate("session-5");
    const second = await manager.getOrCreate("session-5");
    expect(first.persistence).toBe("memory");
    expect(second.publicKey).toBe(first.publicKey);
    expect(first.privateKey.extractable).toBe(false);
    expect(unavailable.delete).not.toHaveBeenCalled();
  });

  it("keeps an admitted principal usable when the binding write fails", async () => {
    const store = memoryCredentialStore();
    const manager = createRemoteMembershipCredentialManager({
      subtle: webcrypto.subtle,
      credentialStore: store,
      legacyStorage: null,
    });
    const created = await manager.getOrCreate("session-put-failure");
    store.put = vi.fn(async () => {
      throw new Error("transient IDB write failure");
    });

    const bound = await manager.rememberPrincipal(
      "session-put-failure",
      "principal-put-failure",
    );
    const reloaded = await manager.getOrCreate("session-put-failure");

    expect(store.put).toHaveBeenCalledOnce();
    expect(bound.persistence).toBe("memory");
    expect(bound.publicKey).toBe(created.publicKey);
    expect(reloaded.principalId).toBe("principal-put-failure");
    expect(reloaded.publicKey).toBe(created.publicKey);
  });

  it("signs the exact canonical challenge with the persisted public key", async () => {
    const store = memoryCredentialStore();
    const manager = createRemoteMembershipCredentialManager({
      subtle: webcrypto.subtle,
      credentialStore: store,
      legacyStorage: null,
    });
    const credential = await manager.getOrCreate("session-6");
    const challenge = { z: "last", a: 7, nested: { ok: true } };
    const signature = await signRemoteMembershipChallenge(
      challenge,
      credential.privateKey,
    );
    const payload = Buffer.from(
      'chainlesschain.remote-membership-authentication-challenge.v1\0{"a":7,"nested":{"ok":true},"z":"last"}',
    );
    const verified = await webcrypto.subtle.verify(
      { name: "Ed25519" },
      store.records.get("session-6").publicKey,
      base64UrlBytes(signature),
      payload,
    );
    expect(verified).toBe(true);
  });
});
