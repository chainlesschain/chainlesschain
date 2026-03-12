import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EvoMapClient, _deps } from "../../src/lib/evomap-client.js";
import {
  EvoMapManager,
  _deps as mgrDeps,
} from "../../src/lib/evomap-manager.js";

describe("EvoMapClient", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });

  afterEach(() => {
    Object.assign(_deps, originalDeps);
  });

  // ── Constructor ──

  describe("constructor", () => {
    it("uses default hub URL", () => {
      const client = new EvoMapClient();
      expect(client.hubUrl).toContain("evomap");
    });

    it("accepts custom hub URL", () => {
      const client = new EvoMapClient({ hubUrl: "https://custom.hub/api" });
      expect(client.hubUrl).toBe("https://custom.hub/api");
    });

    it("accepts API key", () => {
      const client = new EvoMapClient({ apiKey: "test-key" });
      expect(client.apiKey).toBe("test-key");
    });
  });

  // ── search ──

  describe("search", () => {
    it("calls hub search endpoint", async () => {
      const mockFetch = vi.fn(() => ({
        ok: true,
        json: () => ({ genes: [{ id: "gene1", name: "test-gene" }] }),
      }));
      _deps.fetch = mockFetch;

      const client = new EvoMapClient({ hubUrl: "https://hub.test/api" });
      const results = await client.search("test");

      expect(mockFetch).toHaveBeenCalled();
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("/genes/search");
      expect(url).toContain("q=test");
      expect(results).toEqual([{ id: "gene1", name: "test-gene" }]);
    });

    it("passes category filter", async () => {
      const mockFetch = vi.fn(() => ({
        ok: true,
        json: () => ({ genes: [] }),
      }));
      _deps.fetch = mockFetch;

      const client = new EvoMapClient({ hubUrl: "https://hub.test/api" });
      await client.search("test", { category: "skills" });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("category=skills");
    });

    it("throws on API error", async () => {
      _deps.fetch = vi.fn(() => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }));

      const client = new EvoMapClient();
      await expect(client.search("test")).rejects.toThrow("EvoMap API error");
    });
  });

  // ── getGene ──

  describe("getGene", () => {
    it("fetches gene details", async () => {
      const gene = { id: "gene1", name: "test", version: "1.0.0" };
      _deps.fetch = vi.fn(() => ({ ok: true, json: () => gene }));

      const client = new EvoMapClient();
      const result = await client.getGene("gene1");
      expect(result.id).toBe("gene1");
    });
  });

  // ── download ──

  describe("download", () => {
    it("downloads gene package", async () => {
      _deps.fetch = vi.fn(() => ({
        ok: true,
        json: () => ({ gene: { id: "g1" }, content: "skill content" }),
      }));

      const client = new EvoMapClient();
      const data = await client.download("g1");
      expect(data.gene.id).toBe("g1");
      expect(data.content).toBe("skill content");
    });
  });

  // ── publish ──

  describe("publish", () => {
    it("requires API key", async () => {
      const client = new EvoMapClient({ apiKey: "" });
      await expect(client.publish({ name: "test" })).rejects.toThrow(
        "API key required",
      );
    });

    it("publishes gene with API key", async () => {
      _deps.fetch = vi.fn(() => ({
        ok: true,
        json: () => ({ id: "new-gene", success: true }),
      }));

      const client = new EvoMapClient({ apiKey: "test-key" });
      const result = await client.publish({ name: "test" });
      expect(result.success).toBe(true);

      const fetchOpts = _deps.fetch.mock.calls[0][1];
      expect(fetchOpts.method).toBe("POST");
      expect(fetchOpts.headers.Authorization).toBe("Bearer test-key");
    });
  });

  // ── listHubs ──

  describe("listHubs", () => {
    it("returns hub list", async () => {
      _deps.fetch = vi.fn(() => ({
        ok: true,
        json: () => ({ name: "Main Hub", version: "1.0" }),
      }));

      const client = new EvoMapClient();
      const hubs = await client.listHubs();
      expect(hubs.length).toBe(1);
      expect(hubs[0].url).toBeTruthy();
    });

    it("returns unreachable status on error", async () => {
      _deps.fetch = vi.fn(() => {
        throw new Error("network error");
      });

      const client = new EvoMapClient();
      const hubs = await client.listHubs();
      expect(hubs[0].status).toBe("unreachable");
    });
  });

  // ── timeout ──

  describe("timeout handling", () => {
    it("times out on slow responses", async () => {
      _deps.fetch = vi.fn(
        () =>
          new Promise((_, reject) => {
            const err = new Error("aborted");
            err.name = "AbortError";
            setTimeout(() => reject(err), 10);
          }),
      );

      const client = new EvoMapClient({ timeout: 5 });
      await expect(client.search("test")).rejects.toThrow("timed out");
    });
  });
});

describe("EvoMapManager", () => {
  let originalMgrDeps;

  beforeEach(() => {
    originalMgrDeps = { ...mgrDeps };
  });

  afterEach(() => {
    Object.assign(mgrDeps, originalMgrDeps);
  });

  // ── Constructor ──

  describe("constructor", () => {
    it("creates uninitialized manager", () => {
      const mgr = new EvoMapManager({});
      expect(mgr._initialized).toBe(false);
    });
  });

  // ── initialize ──

  describe("initialize", () => {
    it("creates DB table", () => {
      const mockDb = { exec: vi.fn() };
      const mgr = new EvoMapManager({ db: mockDb });
      mgr.initialize();
      expect(mockDb.exec).toHaveBeenCalled();
      expect(mockDb.exec.mock.calls[0][0]).toContain("evomap_genes");
    });

    it("creates genes directory", () => {
      mgrDeps.fs = {
        existsSync: vi.fn(() => false),
        mkdirSync: vi.fn(),
      };

      const mgr = new EvoMapManager({ genesDir: "/tmp/genes" });
      mgr.initialize();
      expect(mgrDeps.fs.mkdirSync).toHaveBeenCalled();
    });
  });

  // ── saveGene ──

  describe("saveGene", () => {
    it("saves gene to disk", () => {
      mgrDeps.fs = {
        existsSync: vi.fn(() => false),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
      };

      const mgr = new EvoMapManager({ genesDir: "/tmp/genes" });
      const result = mgr.saveGene({ id: "test-gene", name: "Test" }, "content");
      expect(result.path).toContain("test-gene");
      expect(mgrDeps.fs.writeFileSync).toHaveBeenCalled();
    });

    it("throws without gene ID", () => {
      const mgr = new EvoMapManager({ genesDir: "/tmp/genes" });
      expect(() => mgr.saveGene({}, "content")).toThrow("Gene ID required");
    });
  });

  // ── listGenes ──

  describe("listGenes", () => {
    it("lists genes from DB", () => {
      const mockDb = {
        exec: vi.fn(),
        prepare: vi.fn(() => ({
          all: () => [{ id: "g1", name: "Gene 1" }],
        })),
      };

      const mgr = new EvoMapManager({ db: mockDb, genesDir: "/tmp" });
      mgr.initialize();
      const genes = mgr.listGenes();
      expect(genes.length).toBe(1);
    });

    it("falls back to file-based listing", () => {
      mgrDeps.fs = {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn(() => [{ name: "gene1", isDirectory: () => true }]),
        readFileSync: vi.fn(() => JSON.stringify({ name: "Gene 1" })),
      };

      const mgr = new EvoMapManager({ genesDir: "/tmp/genes" });
      const genes = mgr.listGenes();
      expect(genes.length).toBe(1);
    });
  });

  // ── getGene ──

  describe("getGene", () => {
    it("returns null for non-existent gene", () => {
      mgrDeps.fs = {
        existsSync: vi.fn(() => false),
        mkdirSync: vi.fn(),
      };

      const mgr = new EvoMapManager({ genesDir: "/tmp/genes" });
      expect(mgr.getGene("unknown")).toBeNull();
    });
  });

  // ── removeGene ──

  describe("removeGene", () => {
    it("removes gene directory and DB entry", () => {
      mgrDeps.fs = {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        rmSync: vi.fn(),
      };
      const mockDb = {
        exec: vi.fn(),
        prepare: vi.fn(() => ({ run: vi.fn() })),
      };

      const mgr = new EvoMapManager({ genesDir: "/tmp/genes", db: mockDb });
      mgr.initialize();
      const result = mgr.removeGene("test-gene");
      expect(result.removed).toBe(true);
      expect(mgrDeps.fs.rmSync).toHaveBeenCalled();
    });
  });

  // ── packageGene ──

  describe("packageGene", () => {
    it("creates gene package", () => {
      const mgr = new EvoMapManager({});
      const gene = mgr.packageGene({
        name: "my-skill",
        description: "A custom skill",
        category: "development",
        content: "skill content",
        author: "testuser",
      });

      expect(gene.id).toContain("my-skill");
      expect(gene.name).toBe("my-skill");
      expect(gene.author).toBe("testuser");
      expect(gene.version).toBe("1.0.0");
    });
  });
});
