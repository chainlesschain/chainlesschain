import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import grader from "../../src/lib/evolution/pm-result-grader.cjs";

const {
  capturePmExportBaseline,
  gradePmExportFile,
  gradePmProjectState,
  gradePmBoardExport,
} = grader;
const roots = [];
const hash = (text) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pm-grader-test-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    // Only remove exact directories created by this test, never a caller path.
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^cc-pm-grader-test-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fileCase(content = "# Requirements\n\n- Auth\n") {
  const root = workspace();
  const expected = {
    kind: "file-export",
    relativePath: "requirements.md",
    sha256: hash(content),
  };
  const baseline = capturePmExportBaseline(root, expected.relativePath);
  return { root, expected, baseline, content };
}

describe("PM independent export grader", () => {
  it("reads the new real file and reports a diagnostic, not promotion authority", () => {
    const f = fileCase();
    fs.writeFileSync(path.join(f.root, f.expected.relativePath), f.content);
    const result = gradePmExportFile({ ...f, executionSucceeded: true });
    expect(result).toMatchObject({
      pass: true,
      artifactCheckPassed: true,
      artifactDigest: hash(f.content),
      authenticated: false,
      qualifiesForPromotion: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => gradePmExportFile({ ...f, executionSucceeded: true })).toThrow(
      /fresh/,
    );
  });

  it.each(["", "wrong contents", "# Requirements\n"])(
    "rejects incorrect bytes %j despite execution success",
    (content) => {
      const f = fileCase();
      fs.writeFileSync(path.join(f.root, f.expected.relativePath), content);
      expect(
        gradePmExportFile({ ...f, executionSucceeded: true }),
      ).toMatchObject({ pass: false, reason: "content-mismatch" });
    },
  );

  it.each([false, undefined, "true", 1])(
    "keeps artifact success separate from execution %s",
    (executionSucceeded) => {
      const f = fileCase();
      fs.writeFileSync(path.join(f.root, f.expected.relativePath), f.content);
      expect(gradePmExportFile({ ...f, executionSucceeded })).toMatchObject({
        pass: false,
        artifactCheckPassed: true,
        reason: "execution-failed",
      });
    },
  );

  it("rejects an old correct file before execution", () => {
    const root = workspace();
    fs.writeFileSync(path.join(root, "old.md"), "already correct");
    expect(() => capturePmExportBaseline(root, "old.md")).toThrow(
      /already exists/,
    );
  });

  it("does not accept missing files, directories or oversized files", () => {
    for (const kind of ["missing", "directory", "oversized"]) {
      const f = fileCase();
      const target = path.join(f.root, f.expected.relativePath);
      if (kind === "directory") fs.mkdirSync(target);
      if (kind === "oversized")
        fs.writeFileSync(target, Buffer.alloc(1024 * 1024 + 1));
      const result = gradePmExportFile({ ...f, executionSucceeded: true });
      expect(result).toMatchObject({
        pass: false,
        reason: "artifact-unavailable-or-unsafe",
        artifactDigest: null,
      });
      expect(JSON.stringify(result)).not.toContain(f.root);
    }
  });

  it.each([
    "../outside",
    "/absolute",
    "a/../../b",
    "a\\b",
    "C:/outside",
    "report.md:stream",
    "a//b",
    "a/./b",
    "a\0b",
    ".. /outside",
    "file.md.",
    "NUL",
    "con.txt",
    "a?.md",
  ])("rejects unsafe path %j", (relative) => {
    expect(() => capturePmExportBaseline(workspace(), relative)).toThrow(
      /confined/,
    );
  });

  it("rejects forged handles and paths changed after the baseline", () => {
    const f = fileCase();
    expect(() =>
      gradePmExportFile({ ...f, baseline: {}, executionSucceeded: true }),
    ).toThrow(/host-captured/);
    expect(() =>
      gradePmExportFile({
        ...f,
        expected: { ...f.expected, relativePath: "other.md" },
        executionSucceeded: true,
      }),
    ).toThrow(/differs/);
  });

  it("rejects a directory junction/symlink introduced after baseline capture", () => {
    const root = workspace();
    const outside = workspace();
    fs.writeFileSync(path.join(outside, "result.md"), "outside-secret");
    const baseline = capturePmExportBaseline(root, "linked/result.md");
    fs.symlinkSync(
      outside,
      path.join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const expected = {
      kind: "file-export",
      relativePath: "linked/result.md",
      sha256: hash("outside-secret"),
    };
    expect(
      gradePmExportFile({ baseline, expected, executionSucceeded: true }).pass,
    ).toBe(false);
    expect(fs.readFileSync(path.join(outside, "result.md"), "utf8")).toBe(
      "outside-secret",
    );
  });

  it("accepts a new file within a real nested directory", () => {
    const root = workspace();
    const baseline = capturePmExportBaseline(root, "out/result.md");
    fs.mkdirSync(path.join(root, "out"));
    fs.writeFileSync(path.join(root, "out/result.md"), "nested");
    expect(
      gradePmExportFile({
        baseline,
        expected: {
          kind: "file-export",
          relativePath: "out/result.md",
          sha256: hash("nested"),
        },
        executionSucceeded: true,
      }).pass,
    ).toBe(true);
  });
});

describe("PM business outcome grading", () => {
  const expected = {
    kind: "project-state",
    id: "project-a",
    name: "Delivery",
    status: "completed",
  };
  it("checks exact project identity, name and final status", () => {
    const actual = {
      id: "project-a",
      name: "Delivery",
      status: "completed",
      extra: "not evaluated",
    };
    expect(
      gradePmProjectState({ actual, expected, executionSucceeded: true }).pass,
    ).toBe(true);
    for (const key of ["id", "name", "status"])
      expect(
        gradePmProjectState({
          actual: { ...actual, [key]: "wrong" },
          expected,
          executionSucceeded: true,
        }).pass,
      ).toBe(false);
    expect(
      gradePmProjectState({
        actual: { success: false },
        expected,
        executionSucceeded: true,
      }).pass,
    ).toBe(false);
    expect(
      gradePmProjectState({ actual, expected, executionSucceeded: false }).pass,
    ).toBe(false);
  });

  it("does not execute getters in observed business data", () => {
    const actual = Object.defineProperty({}, "id", {
      enumerable: true,
      get() {
        throw new Error("read getter");
      },
    });
    expect(
      gradePmProjectState({ actual, expected, executionSucceeded: true }).pass,
    ).toBe(false);
  });

  it("requires private expectation fields, not an empty always-passing check", () => {
    expect(() =>
      gradePmProjectState({
        actual: {},
        expected: {},
        executionSucceeded: true,
      }),
    ).toThrow();
  });

  it("checks board identity and exact nonduplicate task/sprint membership", () => {
    const actual = {
      board: { id: "b1" },
      tasks: [{ id: "t1" }, { id: "t2" }],
      sprints: [{ id: "s1" }],
    };
    const boardExpected = {
      boardId: "b1",
      taskIds: ["t2", "t1"],
      sprintIds: ["s1"],
    };
    const grade = (value) =>
      gradePmBoardExport({
        actual: value,
        expected: boardExpected,
        executionSucceeded: true,
      });
    expect(grade(actual).pass).toBe(true);
    for (const value of [
      null,
      { success: true },
      { ...actual, board: { id: "wrong" } },
      { ...actual, tasks: [] },
      { ...actual, tasks: [{ id: "t1" }, { id: "t1" }] },
      { ...actual, sprints: [{ id: "other" }] },
    ])
      expect(grade(value).pass).toBe(false);
    expect(() =>
      gradePmBoardExport({
        actual,
        expected: { boardId: "b1", taskIds: [], sprintIds: [] },
        executionSucceeded: true,
      }),
    ).toThrow();
  });
});
