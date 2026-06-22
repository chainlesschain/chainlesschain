/**
 * stats-collector 单元测试 —— analyzeCodeLines 的 code/comment/blank 分类，
 * 重点回归：尾随开启块注释的代码行(`foo(); /* note`)后续注释体不再被计为代码。
 */

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ProjectStatsCollector } = require("../stats-collector.js");

let collector;
let tmpDir;

beforeEach(() => {
  collector = new ProjectStatsCollector(null);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stats-collector-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const analyze = async (name, content) => {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, "utf-8");
  return collector.analyzeCodeLines(p);
};

describe("ProjectStatsCollector.analyzeCodeLines", () => {
  it("classifies blank, code and line-comment lines", async () => {
    const stats = await analyze(
      "a.js",
      ["const a = 1;", "", "// a comment", "doThing();"].join("\n"),
    );
    expect(stats).toEqual({ code: 2, comment: 1, blank: 1 });
  });

  it("counts a single-line block comment as a comment", async () => {
    const stats = await analyze("b.js", "/* one liner */");
    expect(stats).toEqual({ code: 0, comment: 1, blank: 0 });
  });

  it("counts a multi-line JSDoc block as comments", async () => {
    const stats = await analyze(
      "c.js",
      ["/**", " * docs", " */", "run();"].join("\n"),
    );
    expect(stats).toEqual({ code: 1, comment: 3, blank: 0 });
  });

  it("tracks a block comment opened on a code line (regression)", async () => {
    // `foo(); /* note` opens a block comment after code. The following lines
    // until */ must be counted as comments, not code.
    const stats = await analyze(
      "d.js",
      ["foo(); /* note", "still inside comment", "*/", "bar();"].join("\n"),
    );
    // code: foo(); + bar();   comment: "still inside comment" + "*/"
    expect(stats).toEqual({ code: 2, comment: 2, blank: 0 });
  });

  it("handles Python # comments", async () => {
    const stats = await analyze(
      "e.py",
      ["x = 1", "# note", ""].join("\n"),
    );
    expect(stats).toEqual({ code: 1, comment: 1, blank: 1 });
  });

  it("returns zeros for an unreadable path", async () => {
    const stats = await collector.analyzeCodeLines(
      path.join(tmpDir, "does-not-exist.js"),
    );
    expect(stats).toEqual({ code: 0, comment: 0, blank: 0 });
  });
});
