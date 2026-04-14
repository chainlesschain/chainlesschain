import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import {
  toShareableTemplate,
  buildTemplateGene,
  templateFromGene,
  listUserTemplates,
  saveUserTemplate,
  removeUserTemplate,
  searchTemplates,
  installTemplate,
  publishTemplate,
  _deps,
} from "../../src/lib/cowork-template-marketplace.js";

function installFakeFs() {
  const files = new Map();
  const dirs = new Set();
  _deps.existsSync = vi.fn((p) => files.has(p) || dirs.has(p));
  _deps.mkdirSync = vi.fn((p) => {
    dirs.add(p);
  });
  _deps.readFileSync = vi.fn((p) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
    return files.get(p);
  });
  _deps.writeFileSync = vi.fn((p, body) => {
    files.set(p, body);
  });
  _deps.readdirSync = vi.fn((p) => {
    const sep = p.includes("\\") ? "\\" : "/";
    const normalizedPrefix = p.endsWith(sep) ? p : p + sep;
    return [...files.keys()]
      .filter((f) => f.startsWith(normalizedPrefix))
      .map((f) => f.slice(normalizedPrefix.length))
      .filter((f) => !f.includes("/") && !f.includes("\\"));
  });
  _deps.unlinkSync = vi.fn((p) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
    files.delete(p);
  });
  return files;
}

const SAMPLE_TEMPLATE = {
  id: "my-tpl",
  name: "My Template",
  category: "utility",
  acceptsFiles: true,
  fileTypes: [".txt"],
  mode: "agent",
  systemPromptExtension: "Do the thing.",
  mcpServers: [{ name: "fetch", command: "npx", args: ["-y", "@mcp/fetch"] }],
};

describe("toShareableTemplate", () => {
  it("picks only the shareable fields and drops unknown ones", () => {
    const src = {
      ...SAMPLE_TEMPLATE,
      internalField: "should not survive",
    };
    const out = toShareableTemplate(src, {
      icon: "FileTextOutlined",
      description: "desc",
      examples: ["ex1"],
    });
    expect(out).toEqual({
      ...SAMPLE_TEMPLATE,
      icon: "FileTextOutlined",
      description: "desc",
      examples: ["ex1"],
    });
    expect(out.internalField).toBeUndefined();
  });
});

describe("buildTemplateGene", () => {
  it("wraps the template as a JSON gene with cowork-template category", () => {
    const gene = buildTemplateGene(SAMPLE_TEMPLATE, {
      author: "alice",
      version: "1.2.0",
      description: "nice template",
      tags: ["utility", "demo"],
    });
    expect(gene.id).toBe("cowork-template-my-tpl");
    expect(gene.category).toBe("cowork-template");
    expect(gene.author).toBe("alice");
    expect(gene.version).toBe("1.2.0");
    expect(gene.tags).toEqual(["utility", "demo"]);
    expect(JSON.parse(gene.content)).toEqual(SAMPLE_TEMPLATE);
  });

  it("throws on missing id or name", () => {
    expect(() => buildTemplateGene({ name: "x" })).toThrow(/id/);
    expect(() => buildTemplateGene({ id: "x" })).toThrow(/name/);
  });
});

describe("templateFromGene", () => {
  it("parses { gene, content } shape", () => {
    const payload = {
      gene: { id: "cowork-template-my-tpl" },
      content: JSON.stringify(SAMPLE_TEMPLATE),
    };
    expect(templateFromGene(payload)).toEqual(SAMPLE_TEMPLATE);
  });

  it("parses flat gene shape", () => {
    const payload = { id: "x", content: JSON.stringify(SAMPLE_TEMPLATE) };
    expect(templateFromGene(payload)).toEqual(SAMPLE_TEMPLATE);
  });

  it("rejects missing content", () => {
    expect(() => templateFromGene({})).toThrow(/content/);
  });

  it("rejects invalid JSON", () => {
    expect(() => templateFromGene({ content: "{not json" })).toThrow(/JSON/);
  });

  it("rejects content without id/name", () => {
    expect(() =>
      templateFromGene({ content: JSON.stringify({ foo: "bar" }) }),
    ).toThrow(/valid cowork template/);
  });
});

describe("local persistence", () => {
  beforeEach(() => installFakeFs());

  it("listUserTemplates returns [] when dir missing", () => {
    expect(listUserTemplates("/project")).toEqual([]);
  });

  it("saveUserTemplate then listUserTemplates round-trips", () => {
    saveUserTemplate("/project", SAMPLE_TEMPLATE);
    const list = listUserTemplates("/project");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("my-tpl");
    expect(list[0].source).toBe("user");
  });

  it("removeUserTemplate removes the file", () => {
    saveUserTemplate("/project", SAMPLE_TEMPLATE);
    expect(removeUserTemplate("/project", "my-tpl")).toBe(true);
    expect(listUserTemplates("/project")).toEqual([]);
  });

  it("removeUserTemplate returns false when template doesn't exist", () => {
    expect(removeUserTemplate("/project", "nope")).toBe(false);
  });

  it("saveUserTemplate rejects objects without id", () => {
    expect(() => saveUserTemplate("/project", { name: "x" })).toThrow(/id/);
  });
});

describe("marketplace operations", () => {
  beforeEach(() => {
    installFakeFs();
    _deps.evomapClient = null;
  });

  it("searchTemplates throws when client not configured", async () => {
    await expect(searchTemplates("anything")).rejects.toThrow(
      /client not configured/,
    );
  });

  it("searchTemplates filters by cowork-template category", async () => {
    const mockSearch = vi.fn(async () => [
      { id: "cowork-template-a", name: "A" },
    ]);
    _deps.evomapClient = { search: mockSearch };
    const results = await searchTemplates("keyword");
    expect(mockSearch).toHaveBeenCalledWith("keyword", {
      category: "cowork-template",
      limit: 20,
    });
    expect(results).toHaveLength(1);
  });

  it("installTemplate downloads, validates, and saves locally", async () => {
    const mockDownload = vi.fn(async () => ({
      gene: { id: "cowork-template-my-tpl" },
      content: JSON.stringify(SAMPLE_TEMPLATE),
    }));
    _deps.evomapClient = { download: mockDownload };

    const installed = await installTemplate("/project", "cowork-template-my-tpl");
    expect(installed).toEqual(SAMPLE_TEMPLATE);
    expect(mockDownload).toHaveBeenCalledWith("cowork-template-my-tpl");
    expect(listUserTemplates("/project")).toHaveLength(1);
  });

  it("publishTemplate uploads gene with shareable content", async () => {
    const mockPublish = vi.fn(async () => ({ id: "cowork-template-my-tpl" }));
    _deps.evomapClient = { publish: mockPublish };
    await publishTemplate(SAMPLE_TEMPLATE, {
      author: "bob",
      version: "2.0.0",
    });
    expect(mockPublish).toHaveBeenCalledOnce();
    const [gene] = mockPublish.mock.calls[0];
    expect(gene.category).toBe("cowork-template");
    expect(gene.author).toBe("bob");
    expect(gene.version).toBe("2.0.0");
    expect(JSON.parse(gene.content)).toEqual(SAMPLE_TEMPLATE);
  });
});
