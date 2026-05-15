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

describe("MultisigSigner.signProposal source=ukey", () => {
  it("rejects without ukeySigner wired (UKEY_NOT_WIRED)", async () => {
    const mgrSign = vi.fn();
    const { signer } = withSigner({ sign: mgrSign });
    await expect(
      signer.signProposal({
        proposalId: "msp_u",
        signerDid: "did:cc:a",
        source: KEY_SOURCES.UKEY,
        params: {},
      }),
    ).rejects.toMatchObject({ code: "UKEY_NOT_WIRED" });
    expect(mgrSign).not.toHaveBeenCalled();
  });

  it("rejects with ukeySigner wired but flagged NOT_IMPLEMENTED in PR1", async () => {
    const mgrSign = vi.fn();
    const fakeUkeySigner = vi.fn(async () => Buffer.alloc(64));
    const { signer } = withSigner(
      { sign: mgrSign },
      { ukeySigner: fakeUkeySigner },
    );
    await expect(
      signer.signProposal({
        proposalId: "msp_u",
        signerDid: "did:cc:a",
        source: KEY_SOURCES.UKEY,
        params: {},
      }),
    ).rejects.toMatchObject({ code: "UKEY_NOT_IMPLEMENTED" });
    expect(mgrSign).not.toHaveBeenCalled();
    // ukeySigner not invoked because the implementation gate triggers first.
    expect(fakeUkeySigner).not.toHaveBeenCalled();
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
