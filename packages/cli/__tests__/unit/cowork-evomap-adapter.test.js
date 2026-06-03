import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  publishTemplateToHub,
  searchTemplatesInHub,
  installTemplateFromHub,
  _deps,
} from "../../src/lib/cowork-evomap-adapter.js";
import { _deps as mpDeps } from "../../src/lib/cowork-template-marketplace.js";
import crypto from "node:crypto";
import { generateDID } from "../../src/lib/did-manager.js";

function makeClientStub({ search, publish, download } = {}) {
  return {
    hubUrl: "https://test.hub/api/v1",
    search: search || vi.fn(async () => []),
    publish: publish || vi.fn(async () => ({ id: "g1" })),
    download: download || vi.fn(async () => ({})),
  };
}

function makeSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" });
  const priv = privateKey.export({ format: "der", type: "pkcs8" });
  const pubHex = pub.toString("hex");
  return {
    did: generateDID(pubHex),
    publicKey: pubHex,
    privateKey: priv.toString("hex"),
    publicKeyObj: publicKey,
    privateKeyObj: privateKey,
  };
}

const sampleTemplate = {
  id: "tpl-a",
  name: "Template A",
  category: "coding",
  mode: "single",
  systemPromptExtension: "You are a helpful coder.",
};

describe("cowork-evomap-adapter", () => {
  let stub;
  let createdWith;
  beforeEach(() => {
    createdWith = null;
    stub = makeClientStub();
    _deps.createClient = vi.fn((opts) => {
      createdWith = opts;
      return stub;
    });
  });

  describe("publishTemplateToHub", () => {
    it("throws when template.id missing", async () => {
      await expect(publishTemplateToHub({})).rejects.toThrow(/template\.id/);
    });

    it("publishes a gene with kind=cowork-template and template packet", async () => {
      await publishTemplateToHub(sampleTemplate, {
        hubUrl: "https://hub.x",
        apiKey: "KEY",
      });
      expect(createdWith).toEqual({ hubUrl: "https://hub.x", apiKey: "KEY" });
      expect(stub.publish).toHaveBeenCalledOnce();
      const gene = stub.publish.mock.calls[0][0];
      expect(gene.id).toBe("tpl-a");
      expect(gene.kind).toBe("cowork-template");
      expect(gene.packet).toBeDefined();
      expect(gene.packet.kind).toBe("template");
      expect(gene.packet.payload.id).toBe("tpl-a");
      expect(gene.packet.checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it("attaches signature when signer passed", async () => {
      const signer = makeSigner();
      await publishTemplateToHub(sampleTemplate, {
        hubUrl: "https://hub.x",
        apiKey: "KEY",
        signer,
      });
      const gene = stub.publish.mock.calls[0][0];
      expect(gene.packet.signature).toBeDefined();
      expect(gene.packet.signature.alg).toBe("Ed25519");
      expect(gene.packet.signature.did).toBe(signer.did);
    });

    it("omits signature when signer absent (anonymous author)", async () => {
      await publishTemplateToHub(sampleTemplate, { hubUrl: "https://hub.x" });
      const gene = stub.publish.mock.calls[0][0];
      expect(gene.packet.signature).toBeUndefined();
    });
  });

  describe("searchTemplatesInHub", () => {
    it("filters by category=cowork-template and propagates limit", async () => {
      stub.search = vi.fn(async () => [
        { id: "g1", name: "A", downloads: 5, rating: 4.5 },
      ]);
      _deps.createClient = vi.fn(() => stub);
      const out = await searchTemplatesInHub("agent", { limit: 7 });
      expect(stub.search).toHaveBeenCalledWith("agent", {
        category: "cowork-template",
        limit: 7,
      });
      expect(out).toHaveLength(1);
      expect(out[0]._hubMeta).toEqual({
        hubUrl: "https://test.hub/api/v1",
        downloads: 5,
        rating: 4.5,
      });
    });

    it("returns [] on network error in non-strict mode", async () => {
      stub.search = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      });
      _deps.createClient = vi.fn(() => stub);
      const out = await searchTemplatesInHub("x");
      expect(out).toEqual([]);
    });

    it("re-throws on network error when strict=true", async () => {
      stub.search = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      });
      _deps.createClient = vi.fn(() => stub);
      await expect(searchTemplatesInHub("x", { strict: true })).rejects.toThrow(
        /ECONNREFUSED/,
      );
    });

    it("treats empty query as ''", async () => {
      stub.search = vi.fn(async () => []);
      _deps.createClient = vi.fn(() => stub);
      await searchTemplatesInHub(undefined);
      expect(stub.search).toHaveBeenCalledWith("", expect.any(Object));
    });
  });

  describe("installTemplateFromHub", () => {
    let saved;
    beforeEach(() => {
      saved = null;
      mpDeps.mkdirSync = vi.fn(() => {});
      mpDeps.writeFileSync = vi.fn((path, content) => {
        saved = { path, content: JSON.parse(content) };
      });
    });

    it("extracts packet from { gene: { packet } } shape and saves", async () => {
      stub.download = vi.fn(async () => ({
        gene: {
          packet: {
            kind: "template",
            payload: { id: "tpl-a", name: "A" },
            checksum: "sha256:xxx",
          },
        },
      }));
      _deps.createClient = vi.fn(() => stub);
      const out = await installTemplateFromHub("/proj", "g1");
      expect(out.id).toBe("tpl-a");
      expect(saved.content.id).toBe("tpl-a");
    });

    it("extracts packet from direct { packet } shape", async () => {
      stub.download = vi.fn(async () => ({
        packet: {
          kind: "template",
          payload: { id: "tpl-b", name: "B" },
          checksum: "sha256:yy",
        },
      }));
      _deps.createClient = vi.fn(() => stub);
      const out = await installTemplateFromHub("/proj", "g1");
      expect(out.id).toBe("tpl-b");
    });

    it("throws when hub response missing template packet", async () => {
      stub.download = vi.fn(async () => ({ junk: true }));
      _deps.createClient = vi.fn(() => stub);
      await expect(installTemplateFromHub("/proj", "g1")).rejects.toThrow(
        /missing template packet/,
      );
    });

    it("rejects when requireSigned=true and packet unsigned", async () => {
      stub.download = vi.fn(async () => ({
        packet: {
          kind: "template",
          payload: { id: "tpl-a", name: "A" },
          checksum: "sha256:xxx",
        },
      }));
      _deps.createClient = vi.fn(() => stub);
      await expect(
        installTemplateFromHub("/proj", "g1", { requireSigned: true }),
      ).rejects.toThrow(/not signed/);
    });

    it("rejects when signer DID not in trustedDids list", async () => {
      stub.download = vi.fn(async () => ({
        packet: {
          kind: "template",
          payload: { id: "tpl-a", name: "A" },
          checksum: "sha256:xxx",
          signature: { alg: "Ed25519", did: "did:chainless:untrusted" },
        },
      }));
      _deps.createClient = vi.fn(() => stub);
      await expect(
        installTemplateFromHub("/proj", "g1", {
          trustedDids: ["did:chainless:good"],
        }),
      ).rejects.toThrow(/not in trusted list/);
    });

    it("accepts when signer DID is in trustedDids list", async () => {
      stub.download = vi.fn(async () => ({
        packet: {
          kind: "template",
          payload: { id: "tpl-a", name: "A" },
          checksum: "sha256:xxx",
          signature: { alg: "Ed25519", did: "did:chainless:good" },
        },
      }));
      _deps.createClient = vi.fn(() => stub);
      const out = await installTemplateFromHub("/proj", "g1", {
        trustedDids: ["did:chainless:good"],
      });
      expect(out.id).toBe("tpl-a");
    });
  });
});
