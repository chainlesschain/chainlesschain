import { describe, it, expect } from "vitest";

import GraphExporter from "../graph-exporter.js";

const sample = (overrides = {}) => {
  const ex = new GraphExporter();
  ex.loadGraph(
    overrides.nodes || [
      { id: "n1", name: "Alpha", type: "note" },
      { id: "n2", name: "Beta", type: "tag" },
    ],
    overrides.edges || [
      { source: "n1", target: "n2", weight: 2, relationType: "link" },
    ],
  );
  return ex;
};

describe("GraphExporter.exportToCSV", () => {
  it("emits the header and a basic quoted row", () => {
    const csv = sample().exportToCSV();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Source,Target,Weight,RelationType");
    expect(lines[1]).toBe('"n1","n2",2,"link"');
  });

  it("doubles embedded quotes per RFC 4180 (regression)", () => {
    // Bug was: fields wrapped in quotes but embedded " never escaped, so a
    // label like `a"b` produced `"a"b"` and broke column parsing.
    const csv = sample({
      edges: [{ source: 'a"b', target: "n2", relationType: 'sees "x"' }],
    }).exportToCSV();
    const row = csv.trim().split("\n")[1];
    expect(row).toBe('"a""b","n2",1,"sees ""x"""');
  });

  it("keeps commas and newlines inside quoted fields intact", () => {
    const csv = sample({
      edges: [{ source: "a,b", target: "c\nd", relationType: "x,y" }],
    }).exportToCSV();
    const row = csv.split("\n").slice(1).join("\n");
    // comma stays inside quotes; the literal newline is preserved within the
    // quoted field (a compliant parser reads it as one field).
    expect(row).toContain('"a,b"');
    expect(row).toContain('"c\nd"');
    expect(row).toContain('"x,y"');
  });

  it("renders null/undefined fields as empty quoted cells, defaults relationType", () => {
    const csv = sample({
      edges: [{ source: undefined, target: null }],
    }).exportToCSV();
    expect(csv.trim().split("\n")[1]).toBe('"","",1,"link"');
  });
});

describe("GraphExporter other formats", () => {
  it("escapes XML special chars in GraphML", () => {
    const xml = sample({
      nodes: [{ id: "n1", name: "A & <B>", type: "note" }],
      edges: [],
    }).exportToGraphML();
    expect(xml).toContain("A &amp; &lt;B&gt;");
    expect(xml).not.toContain("A & <B>");
  });

  it("escapes quotes in DOT labels", () => {
    const dot = sample({
      nodes: [{ id: "n1", name: 'say "hi"', type: "note" }],
      edges: [],
    }).exportToDOT();
    expect(dot).toContain('label="say \\"hi\\""');
  });

  it("exportToJSON round-trips the loaded graph", () => {
    const ex = sample();
    expect(JSON.parse(ex.exportToJSON())).toEqual(ex.graph);
  });

  it("exportToCytoscape produces nodes/edges with data envelopes", () => {
    const obj = JSON.parse(sample().exportToCytoscape());
    expect(obj.nodes[0].data).toMatchObject({ id: "n1", label: "Alpha" });
    expect(obj.edges[0].data).toMatchObject({
      id: "e0",
      source: "n1",
      target: "n2",
    });
  });
});

describe("GraphExporter.saveToFile", () => {
  it("rejects an unsupported format before touching the filesystem", async () => {
    await expect(sample().saveToFile("/tmp/x.bogus", "bogus")).rejects.toThrow(
      /Unsupported format/,
    );
  });
});

describe("GraphExporter.getSupportedFormats", () => {
  it("lists csv among the supported formats", () => {
    const fmts = GraphExporter.getSupportedFormats().map((f) => f.value);
    expect(fmts).toContain("csv");
    expect(fmts).toContain("graphml");
  });
});
