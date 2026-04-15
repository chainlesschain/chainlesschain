import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import {
  canonicalize,
  buildPacket,
  verifyPacket,
  exportTemplatePacket,
  exportResultPacket,
  findHistoryRecord,
  writePacket,
  readPacket,
  importTemplatePacket,
  importResultPacket,
  _deps,
} from "../../src/lib/cowork-share.js";
import { _deps as mpDeps } from "../../src/lib/cowork-template-marketplace.js";

function installFakeFs() {
  const files = new Map();
  const dirs = new Set();
  const fakeExists = (p) => files.has(p) || dirs.has(p);
  const fakeMkdir = (p) => {
    dirs.add(p);
  };
  const fakeRead = (p) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
    return files.get(p);
  };
  const fakeWrite = (p, body) => {
    files.set(p, body);
  };

  _deps.existsSync = vi.fn(fakeExists);
  _deps.mkdirSync = vi.fn(fakeMkdir);
  _deps.readFileSync = vi.fn(fakeRead);
  _deps.writeFileSync = vi.fn(fakeWrite);
  _deps.now = () => "2026-04-15T12:00:00Z";

  mpDeps.existsSync = vi.fn(fakeExists);
  mpDeps.mkdirSync = vi.fn(fakeMkdir);
  mpDeps.readFileSync = vi.fn(fakeRead);
  mpDeps.writeFileSync = vi.fn(fakeWrite);
  mpDeps.readdirSync = vi.fn((p) => {
    const sep = p.includes("\\") ? "\\" : "/";
    const prefix = p.endsWith(sep) ? p : p + sep;
    return [...files.keys()]
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(prefix.length))
      .filter((f) => !f.includes("/") && !f.includes("\\"));
  });

  return files;
}

const SAMPLE_TEMPLATE = {
  id: "doc-convert",
  name: "Doc Convert",
  category: "writing",
  acceptsFiles: true,
  fileTypes: [".docx"],
  mode: "agent",
  systemPromptExtension: "Convert documents between formats.",
};

const SAMPLE_RESULT = {
  taskId: "task-123",
  status: "completed",
  templateId: "doc-convert",
  templateName: "Doc Convert",
  userMessage: "convert x to pdf",
  timestamp: "2026-04-10T12:00:00Z",
  result: { summary: "Done", tokenCount: 42 },
};

describe("canonicalize", () => {
  it("produces stable key ordering", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });
  it("handles nested objects and arrays", () => {
    const a = { x: [{ c: 1, a: 2 }] };
    const b = { x: [{ a: 2, c: 1 }] };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
  it("stringifies primitives", () => {
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize("s")).toBe('"s"');
    expect(canonicalize(null)).toBe("null");
  });
});

describe("buildPacket / verifyPacket", () => {
  beforeEach(() => installFakeFs());

  it("round-trips through verify", () => {
    const pkt = buildPacket({
      kind: "template",
      payload: SAMPLE_TEMPLATE,
      author: "alice",
      cliVersion: "0.45.78",
    });
    expect(pkt.version).toBe(1);
    expect(pkt.kind).toBe("template");
    expect(pkt.meta.author).toBe("alice");
    expect(verifyPacket(pkt).valid).toBe(true);
  });

  it("rejects invalid kind", () => {
    expect(() => buildPacket({ kind: "weird", payload: {} })).toThrow(/kind/);
  });

  it("rejects missing payload", () => {
    expect(() => buildPacket({ kind: "template" })).toThrow(/payload/);
  });

  it("fails verify on checksum tamper", () => {
    const pkt = buildPacket({ kind: "template", payload: SAMPLE_TEMPLATE });
    pkt.payload.name = "Hacked";
    const { valid, errors } = verifyPacket(pkt);
    expect(valid).toBe(false);
    expect(errors.some((e) => /checksum/.test(e))).toBe(true);
  });

  it("fails verify on missing fields", () => {
    expect(verifyPacket({}).valid).toBe(false);
    expect(verifyPacket(null).valid).toBe(false);
  });
});

describe("exportTemplatePacket", () => {
  beforeEach(() => installFakeFs());
  it("reduces template to shareable fields", () => {
    const pkt = exportTemplatePacket(
      { ...SAMPLE_TEMPLATE, internalSecret: "x" },
      { author: "bob" },
    );
    expect(pkt.payload.internalSecret).toBeUndefined();
    expect(pkt.payload.id).toBe("doc-convert");
    expect(verifyPacket(pkt).valid).toBe(true);
  });
});

describe("exportResultPacket", () => {
  beforeEach(() => installFakeFs());
  it("extracts expected fields from history record", () => {
    const pkt = exportResultPacket(SAMPLE_RESULT, { author: "bob" });
    expect(pkt.kind).toBe("result");
    expect(pkt.payload.taskId).toBe("task-123");
    expect(pkt.payload.result.summary).toBe("Done");
    expect(verifyPacket(pkt).valid).toBe(true);
  });
  it("throws on missing record", () => {
    expect(() => exportResultPacket(null)).toThrow(/required/);
  });
});

describe("findHistoryRecord", () => {
  beforeEach(() => installFakeFs());
  it("returns null when history missing", () => {
    expect(findHistoryRecord("/project", "nope")).toBeNull();
  });
  it("finds matching taskId", () => {
    const files = installFakeFs();
    const histPath = join(
      "/project",
      ".chainlesschain",
      "cowork",
      "history.jsonl",
    );
    files.set(
      histPath,
      JSON.stringify({ ...SAMPLE_RESULT, taskId: "a" }) +
        "\n" +
        JSON.stringify({ ...SAMPLE_RESULT, taskId: "b" }) +
        "\n",
    );
    expect(findHistoryRecord("/project", "a").taskId).toBe("a");
    expect(findHistoryRecord("/project", "b").taskId).toBe("b");
    expect(findHistoryRecord("/project", "c")).toBeNull();
  });
  it("last matching line wins", () => {
    const files = installFakeFs();
    const histPath = join(
      "/project",
      ".chainlesschain",
      "cowork",
      "history.jsonl",
    );
    files.set(
      histPath,
      JSON.stringify({ ...SAMPLE_RESULT, taskId: "a", status: "failed" }) +
        "\n" +
        JSON.stringify({ ...SAMPLE_RESULT, taskId: "a", status: "completed" }) +
        "\n",
    );
    expect(findHistoryRecord("/project", "a").status).toBe("completed");
  });
});

describe("write/readPacket", () => {
  beforeEach(() => installFakeFs());
  it("round-trips through disk with verification", () => {
    const pkt = buildPacket({ kind: "template", payload: SAMPLE_TEMPLATE });
    writePacket("/tmp/packet.json", pkt);
    const read = readPacket("/tmp/packet.json");
    expect(read.payload.id).toBe("doc-convert");
  });
  it("readPacket rejects invalid JSON", () => {
    _deps.readFileSync = vi.fn(() => "{not json");
    _deps.existsSync = vi.fn(() => true);
    expect(() => readPacket("/tmp/bad.json")).toThrow(/JSON/);
  });
  it("readPacket rejects missing file", () => {
    expect(() => readPacket("/nope.json")).toThrow(/not found/);
  });
  it("readPacket rejects tampered packet via manual checksum edit", () => {
    const pkt = buildPacket({ kind: "template", payload: SAMPLE_TEMPLATE });
    const tampered = { ...pkt, checksum: "deadbeef" };
    writePacket("/tmp/bad.json", tampered);
    expect(() => readPacket("/tmp/bad.json")).toThrow(/checksum|Invalid/);
  });
});

describe("import helpers", () => {
  beforeEach(() => installFakeFs());

  it("importTemplatePacket saves to marketplace", () => {
    const pkt = exportTemplatePacket(SAMPLE_TEMPLATE);
    const installed = importTemplatePacket("/project", pkt);
    expect(installed.id).toBe("doc-convert");
  });

  it("importTemplatePacket rejects wrong kind", () => {
    const pkt = exportResultPacket(SAMPLE_RESULT);
    expect(() => importTemplatePacket("/project", pkt)).toThrow(
      /Expected template/,
    );
  });

  it("importResultPacket writes to shared-results dir", () => {
    const files = installFakeFs();
    const pkt = exportResultPacket(SAMPLE_RESULT);
    const out = importResultPacket("/project", pkt);
    expect(out.taskId).toBe("task-123");
    const expectedPath = join(
      "/project",
      ".chainlesschain",
      "cowork",
      "shared-results",
      "task-123.json",
    );
    expect(files.has(expectedPath)).toBe(true);
  });

  it("importResultPacket rejects wrong kind", () => {
    const pkt = exportTemplatePacket(SAMPLE_TEMPLATE);
    expect(() => importResultPacket("/project", pkt)).toThrow(
      /Expected result/,
    );
  });
});
