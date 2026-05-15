/**
 * Unit tests for MultisigSigner middleware (#21 B.1 PR1).
 *
 * Uses fake runtimeFactory + fake mgr so tests run without SQLite. Verifies:
 *   - source='hex' resolves secret + calls mgr.sign with correct shape
 *   - source='path' reads file + resolves secret
 *   - source='ukey' refuses without ukeySigner wired (PR2 placeholder)
 *   - source='ukey' with wired signer still refuses in PR1 (signing path
 *     not yet wired into core-multisig)
 *   - source='unified' refuses (PR3 placeholder)
 *   - unknown source rejected
 *   - missing proposalId / signerDid rejected
 *   - mgr.sign errors flow through (e.g. proposal_state_consumed)
 *   - hex secret parser catches malformed hex
 *   - path parser catches missing/non-file paths
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  createMultisigSigner,
  KEY_SOURCES,
  _hexToSecret,
  _pathToSecret,
  buildUkeyManagerSigner,
} from "../multisig-signer.js";

function makeFakeRuntime(mgrImpl) {
  const close = vi.fn();
  return {
    openMultisigManager: vi.fn(async () => ({
      db: {},
      store: {},
      mgr: mgrImpl,
      close,
    })),
    _close: close,
  };
}

function withSigner(mgrImpl, signerOpts = {}) {
  const fake = makeFakeRuntime(mgrImpl);
  const signer = createMultisigSigner({
    runtimeFactory: async () => fake,
    ...signerOpts,
  });
  return { signer, fake };
}

describe("MultisigSigner._hexToSecret", () => {
  it("converts valid hex string to Buffer", () => {
    const buf = _hexToSecret("deadbeef");
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.toString("hex")).toBe("deadbeef");
  });

  it("rejects empty string", () => {
    expect(() => _hexToSecret("")).toThrowError(/hex secret required/);
  });

  it("rejects non-hex chars", () => {
    expect(() => _hexToSecret("not_hex_chars")).toThrowError(
      /hex secret malformed/,
    );
  });

  it("rejects non-string input", () => {
    expect(() => _hexToSecret(null)).toThrowError(/hex secret required/);
    expect(() => _hexToSecret(undefined)).toThrowError(/hex secret required/);
    expect(() => _hexToSecret(123)).toThrowError(/hex secret required/);
  });
});

describe("MultisigSigner._pathToSecret", () => {
  it("reads hex from file and trims whitespace", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-signer-"));
    const filePath = path.join(tmp, "key.hex");
    fs.writeFileSync(filePath, "  deadbeefcafef00d\n", "utf-8");
    try {
      const buf = _pathToSecret(filePath);
      expect(buf.toString("hex")).toBe("deadbeefcafef00d");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects missing path", () => {
    expect(() => _pathToSecret("")).toThrowError(/key path required/);
  });

  it("rejects nonexistent path", () => {
    expect(() => _pathToSecret("/nonexistent-file-xyz-12345")).toThrowError(
      /key file does not exist/,
    );
  });

  it("rejects directory (non-regular file)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-signer-dir-"));
    try {
      expect(() => _pathToSecret(tmp)).toThrowError(/not a regular file/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("MultisigSigner.signProposal source=hex (happy path)", () => {
  it("resolves hex secret + calls mgr.sign + returns result", async () => {
    const mgrSign = vi.fn(() => ({ accepted: true, reachedThreshold: false }));
    const { signer } = withSigner({ sign: mgrSign });

    const r = await signer.signProposal({
      proposalId: "msp_1",
      signerDid: "did:cc:a",
      alg: "Ed25519",
      source: KEY_SOURCES.HEX,
      params: { secretKeyHex: "deadbeef" },
    });

    expect(r).toEqual({ accepted: true, reachedThreshold: false });
    expect(mgrSign).toHaveBeenCalledTimes(1);
    const arg = mgrSign.mock.calls[0][0];
    expect(arg.proposalId).toBe("msp_1");
    expect(arg.signer.did).toBe("did:cc:a");
    expect(arg.signer.alg).toBe("Ed25519");
    expect(arg.signer.secretKey).toBeInstanceOf(Buffer);
    expect(arg.signer.secretKey.toString("hex")).toBe("deadbeef");
  });

  it("defaults alg to Ed25519 when omitted", async () => {
    const mgrSign = vi.fn(() => ({ accepted: true, reachedThreshold: true }));
    const { signer } = withSigner({ sign: mgrSign });
    await signer.signProposal({
      proposalId: "msp_2",
      signerDid: "did:cc:b",
      source: KEY_SOURCES.HEX,
      params: { secretKeyHex: "aabbccdd" },
    });
    expect(mgrSign.mock.calls[0][0].signer.alg).toBe("Ed25519");
  });

  it("passes through mgr.sign error result (e.g. duplicate_signer)", async () => {
    const mgrSign = vi.fn(() => ({
      accepted: false,
      reachedThreshold: false,
      reason: "duplicate_signer",
    }));
    const { signer } = withSigner({ sign: mgrSign });
    const r = await signer.signProposal({
      proposalId: "msp_3",
      signerDid: "did:cc:a",
      source: KEY_SOURCES.HEX,
      params: { secretKeyHex: "deadbeef" },
    });
    expect(r).toEqual({
      accepted: false,
      reachedThreshold: false,
      reason: "duplicate_signer",
    });
  });
});

describe("MultisigSigner.signProposal source=path", () => {
  it("reads hex from file and calls mgr.sign", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-signer-path-"));
    const keyPath = path.join(tmp, "k.hex");
    fs.writeFileSync(keyPath, "00112233", "utf-8");
    try {
      const mgrSign = vi.fn(() => ({ accepted: true, reachedThreshold: true }));
      const { signer } = withSigner({ sign: mgrSign });
      const r = await signer.signProposal({
        proposalId: "msp_4",
        signerDid: "did:cc:c",
        source: KEY_SOURCES.PATH,
        params: { keyPath },
      });
      expect(r.accepted).toBe(true);
      expect(mgrSign.mock.calls[0][0].signer.secretKey.toString("hex")).toBe(
        "00112233",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("MultisigSigner.signProposal source=ukey (PR2a wired)", () => {
  it("rejects without ukeySigner wired (UKEY_NOT_WIRED)", async () => {
    const mgrSign = vi.fn();
    const mgrSignWithExternal = vi.fn();
    const { signer } = withSigner({
      sign: mgrSign,
      signWithExternal: mgrSignWithExternal,
    });
    await expect(
      signer.signProposal({
        proposalId: "msp_u",
        signerDid: "did:cc:a",
        source: KEY_SOURCES.UKEY,
        params: {},
      }),
    ).rejects.toMatchObject({ code: "UKEY_NOT_WIRED" });
    expect(mgrSignWithExternal).not.toHaveBeenCalled();
  });

  it("with ukeySigner wired: delegates to mgr.signWithExternal", async () => {
    const mgrSign = vi.fn();
    const mgrSignWithExternal = vi.fn(async () => ({
      accepted: true,
      reachedThreshold: true,
    }));
    const fakeUkeySigner = vi.fn(async () => Buffer.alloc(64, 0xaa));
    const { signer } = withSigner(
      { sign: mgrSign, signWithExternal: mgrSignWithExternal },
      { ukeySigner: fakeUkeySigner },
    );

    const r = await signer.signProposal({
      proposalId: "msp_u",
      signerDid: "did:cc:a",
      alg: "Ed25519",
      source: KEY_SOURCES.UKEY,
      params: {},
    });

    expect(r).toEqual({ accepted: true, reachedThreshold: true });
    expect(mgrSign).not.toHaveBeenCalled();
    expect(mgrSignWithExternal).toHaveBeenCalledTimes(1);
    const arg = mgrSignWithExternal.mock.calls[0][0];
    expect(arg.proposalId).toBe("msp_u");
    expect(arg.signer).toEqual({ did: "did:cc:a", alg: "Ed25519" });
    expect(arg.signCallback).toBe(fakeUkeySigner);
  });

  it("forwards mgr.signWithExternal error result (sig_self_verify_failed)", async () => {
    const mgrSignWithExternal = vi.fn(async () => ({
      accepted: false,
      reachedThreshold: false,
      reason: "sig_self_verify_failed",
    }));
    const fakeUkeySigner = vi.fn(async () =>
      Buffer.from("00".repeat(64), "hex"),
    );
    const { signer } = withSigner(
      { sign: vi.fn(), signWithExternal: mgrSignWithExternal },
      { ukeySigner: fakeUkeySigner },
    );
    const r = await signer.signProposal({
      proposalId: "msp_u",
      signerDid: "did:cc:a",
      source: KEY_SOURCES.UKEY,
      params: {},
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("sig_self_verify_failed");
  });

  it("defaults alg to Ed25519 in ukey path when omitted", async () => {
    const mgrSignWithExternal = vi.fn(async () => ({ accepted: true }));
    const { signer } = withSigner(
      { sign: vi.fn(), signWithExternal: mgrSignWithExternal },
      { ukeySigner: vi.fn() },
    );
    await signer.signProposal({
      proposalId: "msp_u",
      signerDid: "did:cc:a",
      source: KEY_SOURCES.UKEY,
      params: {},
    });
    expect(mgrSignWithExternal.mock.calls[0][0].signer.alg).toBe("Ed25519");
  });

  it("closes the multisig handle even when ukeySigner throws", async () => {
    const fake = makeFakeRuntime({
      sign: vi.fn(),
      signWithExternal: vi.fn(async () => {
        throw new Error("ukey signer exploded");
      }),
    });
    const signer = createMultisigSigner({
      runtimeFactory: async () => fake,
      ukeySigner: vi.fn(),
    });
    await expect(
      signer.signProposal({
        proposalId: "msp_u",
        signerDid: "did:cc:a",
        source: KEY_SOURCES.UKEY,
        params: {},
      }),
    ).rejects.toThrow(/ukey signer exploded/);
    expect(fake._close).toHaveBeenCalledTimes(1);
  });
});

describe("MultisigSigner.signProposal source=unified", () => {
  it("rejects with UNIFIED_NOT_IMPLEMENTED (PR3 placeholder)", async () => {
    const { signer } = withSigner({ sign: vi.fn() });
    await expect(
      signer.signProposal({
        proposalId: "msp_n",
        signerDid: "did:cc:a",
        source: KEY_SOURCES.UNIFIED,
        params: {},
      }),
    ).rejects.toMatchObject({ code: "UNIFIED_NOT_IMPLEMENTED" });
  });
});

describe("MultisigSigner.signProposal invalid input", () => {
  it("rejects missing proposalId (INVALID_ARGS)", async () => {
    const { signer } = withSigner({ sign: vi.fn() });
    await expect(
      signer.signProposal({
        signerDid: "did:cc:a",
        source: KEY_SOURCES.HEX,
        params: { secretKeyHex: "aa" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("rejects missing signerDid (INVALID_ARGS)", async () => {
    const { signer } = withSigner({ sign: vi.fn() });
    await expect(
      signer.signProposal({
        proposalId: "msp_x",
        source: KEY_SOURCES.HEX,
        params: { secretKeyHex: "aa" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("rejects unknown source (INVALID_SOURCE)", async () => {
    const { signer } = withSigner({ sign: vi.fn() });
    await expect(
      signer.signProposal({
        proposalId: "msp_x",
        signerDid: "did:cc:a",
        source: "magic-future-source",
        params: {},
      }),
    ).rejects.toMatchObject({ code: "INVALID_SOURCE" });
  });

  it("rejects hex source with malformed hex (INVALID_KEY)", async () => {
    const { signer } = withSigner({ sign: vi.fn() });
    await expect(
      signer.signProposal({
        proposalId: "msp_x",
        signerDid: "did:cc:a",
        source: KEY_SOURCES.HEX,
        params: { secretKeyHex: "not_hex" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_KEY" });
  });

  it("rejects path source with nonexistent file (KEY_PATH_NOT_FOUND)", async () => {
    const { signer } = withSigner({ sign: vi.fn() });
    await expect(
      signer.signProposal({
        proposalId: "msp_x",
        signerDid: "did:cc:a",
        source: KEY_SOURCES.PATH,
        params: { keyPath: "/nonexistent-xyz-12345" },
      }),
    ).rejects.toMatchObject({ code: "KEY_PATH_NOT_FOUND" });
  });
});

describe("buildUkeyManagerSigner (#21 B.1 PR2b)", () => {
  it("rejects when ukeyManager is missing or lacks sign()", () => {
    expect(() => buildUkeyManagerSigner(null)).toThrowError(
      /ukeyManager\.sign\(data\) function required/,
    );
    expect(() => buildUkeyManagerSigner({})).toThrowError(
      /ukeyManager\.sign\(data\) function required/,
    );
    expect(() =>
      buildUkeyManagerSigner({ sign: "not-a-function" }),
    ).toThrowError(/ukeyManager\.sign\(data\) function required/);
  });

  it("passes Buffer through when driver returns Buffer directly", async () => {
    const fakeSig = Buffer.from("aabbccdd", "hex");
    const ukm = { sign: vi.fn(async () => fakeSig) };
    const sign = buildUkeyManagerSigner(ukm);
    const r = await sign(Buffer.from("hello"), "Ed25519");
    expect(r).toBe(fakeSig);
    expect(ukm.sign).toHaveBeenCalledTimes(1);
    expect(ukm.sign.mock.calls[0][0]).toEqual(Buffer.from("hello"));
  });

  it("extracts signature field when driver returns { signature: Buffer }", async () => {
    const fakeSig = Buffer.from("deadbeef", "hex");
    const ukm = {
      sign: vi.fn(async () => ({ success: true, signature: fakeSig })),
    };
    const sign = buildUkeyManagerSigner(ukm);
    const r = await sign(Buffer.from("x"), "Ed25519");
    expect(r).toBe(fakeSig);
  });

  it("converts hex signature string to Buffer", async () => {
    const ukm = { sign: vi.fn(async () => ({ signature: "deadbeef" })) };
    const sign = buildUkeyManagerSigner(ukm);
    const r = await sign(Buffer.from("x"), "Ed25519");
    expect(r).toBeInstanceOf(Buffer);
    expect(r.toString("hex")).toBe("deadbeef");
  });

  it("converts base64 signature string to Buffer (fallback)", async () => {
    // 'AAEC' base64 = 0x000102; not hex-looking (contains uppercase + '+/')
    // Use a non-hex string to force base64 branch.
    const b64 = Buffer.from([0x00, 0x01, 0x02]).toString("base64"); // 'AAEC'
    const ukm = { sign: vi.fn(async () => ({ signature: b64 })) };
    const sign = buildUkeyManagerSigner(ukm);
    const r = await sign(Buffer.from("x"), "Ed25519");
    expect(r.toString("hex")).toBe("000102");
  });

  it("accepts 'sig' field when 'signature' missing", async () => {
    const ukm = {
      sign: vi.fn(async () => ({ sig: Buffer.from("0102", "hex") })),
    };
    const sign = buildUkeyManagerSigner(ukm);
    const r = await sign(Buffer.from("x"), "Ed25519");
    expect(r.toString("hex")).toBe("0102");
  });

  it("throws when driver returns success=false", async () => {
    const ukm = {
      sign: vi.fn(async () => ({
        success: false,
        reason: "device_locked",
        message: "Insert U-Key first",
      })),
    };
    const sign = buildUkeyManagerSigner(ukm);
    await expect(sign(Buffer.from("x"), "Ed25519")).rejects.toMatchObject({
      code: "device_locked",
    });
  });

  it("throws UKEY_BAD_RESULT when result lacks any signature field", async () => {
    const ukm = { sign: vi.fn(async () => ({ unrelated: "stuff" })) };
    const sign = buildUkeyManagerSigner(ukm);
    await expect(sign(Buffer.from("x"), "Ed25519")).rejects.toMatchObject({
      code: "UKEY_BAD_RESULT",
    });
  });

  it("throws UKEY_BAD_RESULT when result is primitive (not object)", async () => {
    const ukm = { sign: vi.fn(async () => "raw-string-not-hex-len") };
    const sign = buildUkeyManagerSigner(ukm);
    await expect(sign(Buffer.from("x"), "Ed25519")).rejects.toMatchObject({
      code: "UKEY_BAD_RESULT",
    });
  });

  it("integrates with createMultisigSigner: source=ukey uses ukeyManager", async () => {
    const fakeSig = Buffer.from("11223344", "hex");
    const ukm = { sign: vi.fn(async () => ({ signature: fakeSig })) };
    const mgrSignWithExternal = vi.fn(async ({ signCallback }) => {
      // Simulate mgr passing canonical bytes; verify the signCallback works.
      const sig = await signCallback(Buffer.from("canonical-bytes"), "Ed25519");
      expect(sig).toBe(fakeSig);
      return { accepted: true, reachedThreshold: false };
    });
    const { signer } = withSigner(
      { sign: vi.fn(), signWithExternal: mgrSignWithExternal },
      { ukeySigner: buildUkeyManagerSigner(ukm) },
    );
    const r = await signer.signProposal({
      proposalId: "msp_b1_pr2b",
      signerDid: "did:cc:a",
      source: KEY_SOURCES.UKEY,
      params: {},
    });
    expect(r.accepted).toBe(true);
    expect(ukm.sign).toHaveBeenCalledTimes(1);
  });
});

describe("MultisigSigner.signProposal cleanup", () => {
  it("closes the multisig manager handle even on mgr.sign failure", async () => {
    const fake = makeFakeRuntime({
      sign: vi.fn(() => {
        throw new Error("simulated mgr.sign explosion");
      }),
    });
    const signer = createMultisigSigner({
      runtimeFactory: async () => fake,
    });
    await expect(
      signer.signProposal({
        proposalId: "msp_z",
        signerDid: "did:cc:a",
        source: KEY_SOURCES.HEX,
        params: { secretKeyHex: "aa" },
      }),
    ).rejects.toThrow(/simulated mgr.sign explosion/);
    expect(fake._close).toHaveBeenCalledTimes(1);
  });

  it("closes the handle on hex parse failure too", async () => {
    const fake = makeFakeRuntime({ sign: vi.fn() });
    const signer = createMultisigSigner({
      runtimeFactory: async () => fake,
    });
    await expect(
      signer.signProposal({
        proposalId: "msp_z",
        signerDid: "did:cc:a",
        source: KEY_SOURCES.HEX,
        params: { secretKeyHex: "GARBAGE" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(fake._close).toHaveBeenCalledTimes(1);
  });
});
