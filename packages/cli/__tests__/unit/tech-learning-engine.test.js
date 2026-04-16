import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  TECH_TYPES,
  PRACTICE_LEVELS,
  ANTI_PATTERNS,
  ensureTechLearningTables,
  analyzeTechStack,
  getProfile,
  detectAntiPatterns,
  recordPractice,
  listPractices,
  getRecommendations,
  _resetState,
} from "../../src/lib/tech-learning-engine.js";

describe("tech-learning-engine", () => {
  let db;
  let tmpDir;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureTechLearningTables(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tle-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("schema", () => {
    it("ensureTechLearningTables is idempotent", () => {
      expect(() => ensureTechLearningTables(db)).not.toThrow();
      expect(() => ensureTechLearningTables(db)).not.toThrow();
    });
  });

  describe("constants", () => {
    it("TECH_TYPES is frozen with 6 entries", () => {
      expect(Object.values(TECH_TYPES)).toHaveLength(6);
      expect(Object.isFrozen(TECH_TYPES)).toBe(true);
    });

    it("PRACTICE_LEVELS is frozen with 4 entries", () => {
      expect(Object.values(PRACTICE_LEVELS)).toHaveLength(4);
      expect(Object.isFrozen(PRACTICE_LEVELS)).toBe(true);
    });

    it("ANTI_PATTERNS is frozen with 6 entries", () => {
      expect(Object.values(ANTI_PATTERNS)).toHaveLength(6);
      expect(Object.isFrozen(ANTI_PATTERNS)).toBe(true);
    });
  });

  describe("analyzeTechStack", () => {
    it("parses package.json + classifies framework/library/tool", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "demo",
          dependencies: {
            react: "^19.0.0",
            express: "^5.0.0",
            axios: "^1.6.0",
            "better-sqlite3": "^11.0.0",
          },
          devDependencies: {
            vite: "^5.0.0",
            vitest: "^3.0.0",
          },
        }),
      );

      const profile = analyzeTechStack(db, tmpDir);
      expect(profile.languages).toContain("javascript");
      expect(profile.frameworks).toEqual(
        expect.arrayContaining(["react", "express"]),
      );
      expect(profile.databases).toContain("better-sqlite3");
      expect(profile.tools).toEqual(expect.arrayContaining(["vite", "vitest"]));
      expect(profile.libraries).toContain("axios");
      expect(profile.totalDependencies).toBe(6);
    });

    it("parses requirements.txt with version markers", () => {
      fs.writeFileSync(
        path.join(tmpDir, "requirements.txt"),
        [
          "# comment",
          "flask==2.3.0",
          "fastapi>=0.100.0",
          "requests",
          "-e .",
        ].join("\n"),
      );

      const profile = analyzeTechStack(db, tmpDir);
      expect(profile.languages).toContain("python");
      expect(profile.frameworks).toEqual(
        expect.arrayContaining(["flask", "fastapi"]),
      );
      expect(profile.libraries).toContain("requests");
    });

    it("parses Cargo.toml dependencies", () => {
      fs.writeFileSync(
        path.join(tmpDir, "Cargo.toml"),
        [
          "[package]",
          'name = "demo"',
          "[dependencies]",
          'actix = "0.13"',
          'serde = { version = "1.0" }',
          "[dev-dependencies]",
          'mockall = "0.11"',
        ].join("\n"),
      );

      const profile = analyzeTechStack(db, tmpDir);
      expect(profile.languages).toContain("rust");
      expect(profile.frameworks).toContain("actix");
      expect(profile.libraries).toEqual(
        expect.arrayContaining(["serde", "mockall"]),
      );
    });

    it("parses go.mod require block", () => {
      fs.writeFileSync(
        path.join(tmpDir, "go.mod"),
        [
          "module example.com/demo",
          "go 1.21",
          "require (",
          "  github.com/gin-gonic/gin v1.9.0",
          "  github.com/stretchr/testify v1.8.0",
          ")",
        ].join("\n"),
      );

      const profile = analyzeTechStack(db, tmpDir);
      expect(profile.languages).toContain("go");
      expect(profile.totalDependencies).toBe(2);
    });

    it("returns empty-ish profile when no manifests present", () => {
      const profile = analyzeTechStack(db, tmpDir);
      expect(profile.languages).toEqual([]);
      expect(profile.frameworks).toEqual([]);
      expect(profile.totalDependencies).toBe(0);
    });

    it("strips internal _seq field", () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      const profile = analyzeTechStack(db, tmpDir);
      expect(profile).not.toHaveProperty("_seq");
    });

    it("persists to tech_stack_profiles table", () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      analyzeTechStack(db, tmpDir);
      const rows = db.prepare(`SELECT * FROM tech_stack_profiles`).all();
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0].languages)).toContain("javascript");
    });

    it("handles malformed package.json gracefully", () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{ not json");
      const profile = analyzeTechStack(db, tmpDir);
      expect(profile.languages).not.toContain("javascript");
    });

    it("getProfile returns most recent analysis", () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      analyzeTechStack(db, tmpDir);
      const p = getProfile(tmpDir);
      expect(p).toBeTruthy();
      expect(p.projectPath).toBe(path.resolve(tmpDir));
    });

    it("getProfile returns null for unknown path", () => {
      expect(getProfile("/nonexistent/path")).toBeNull();
    });
  });

  describe("detectAntiPatterns", () => {
    it("flags god_object when lines > 500", () => {
      const source = Array(600).fill("const x = 1;").join("\n");
      const r = detectAntiPatterns("virtual.js", { source });
      expect(r.totalFindings).toBeGreaterThan(0);
      expect(r.findings.some((f) => f.type === ANTI_PATTERNS.GOD_OBJECT)).toBe(
        true,
      );
    });

    it("flags god_object when functionCount > 20", () => {
      const source = Array(25)
        .fill(0)
        .map((_, i) => `function f${i}() { return ${i}; }`)
        .join("\n");
      const r = detectAntiPatterns("virtual.js", { source });
      expect(r.findings.some((f) => f.type === ANTI_PATTERNS.GOD_OBJECT)).toBe(
        true,
      );
    });

    it("flags long_method for brace-delimited functions > 80 body lines", () => {
      const body = Array(100).fill("  return 1;").join("\n");
      const source = `function big() {\n${body}\n}`;
      const r = detectAntiPatterns("virtual.js", { source });
      expect(r.findings.some((f) => f.type === ANTI_PATTERNS.LONG_METHOD)).toBe(
        true,
      );
    });

    it("flags tight_coupling when imports > threshold", () => {
      const lines = Array(25)
        .fill(0)
        .map((_, i) => `import x${i} from 'm${i}';`)
        .join("\n");
      const r = detectAntiPatterns("virtual.js", { source: lines });
      expect(
        r.findings.some((f) => f.type === ANTI_PATTERNS.TIGHT_COUPLING),
      ).toBe(true);
    });

    it("flags magic_numbers above threshold", () => {
      // Use letter identifiers so only the RHS non-benign numbers are counted.
      const letters = "abcdefghijklmnopqrst";
      const numbers = Array(20)
        .fill(0)
        .map((_, i) => `const ${letters[i]} = ${i + 500};`)
        .join("\n");
      const r = detectAntiPatterns("virtual.js", { source: numbers });
      expect(
        r.findings.some((f) => f.type === ANTI_PATTERNS.MAGIC_NUMBERS),
      ).toBe(true);
    });

    it("excludes benign numbers (0/1/-1/2/10/100)", () => {
      // Identifiers without digits so the only numbers are the RHS benign values.
      const source = [
        "const a = 0;",
        "const b = 1;",
        "const c = -1;",
        "const d = 2;",
        "const e = 10;",
        "const f = 100;",
      ]
        .concat(Array(30).fill("const g = 0;"))
        .join("\n");
      const r = detectAntiPatterns("virtual.js", { source });
      expect(
        r.findings.find((f) => f.type === ANTI_PATTERNS.MAGIC_NUMBERS),
      ).toBeFalsy();
    });

    it("flags spaghetti_code when indent depth > threshold", () => {
      let source = "";
      let indent = "";
      for (let i = 0; i < 10; i++) {
        source += `${indent}if (x) {\n`;
        indent += "  ";
      }
      const r = detectAntiPatterns("virtual.js", { source });
      expect(
        r.findings.some((f) => f.type === ANTI_PATTERNS.SPAGHETTI_CODE),
      ).toBe(true);
    });

    it("returns zero findings for clean files", () => {
      const source = "const x = 1;\nfunction hello() { return x; }\n";
      const r = detectAntiPatterns("virtual.js", { source });
      expect(r.totalFindings).toBe(0);
    });

    it("ignores magic numbers inside strings and comments", () => {
      const source = ["// 12345", '"54321"', "'99999'", "/* 77777 */"].join(
        "\n",
      );
      const r = detectAntiPatterns("virtual.js", { source });
      expect(
        r.findings.find((f) => f.type === ANTI_PATTERNS.MAGIC_NUMBERS),
      ).toBeFalsy();
    });

    it("assigns high severity at extreme thresholds", () => {
      const source = Array(900).fill("const x = 1;").join("\n");
      const r = detectAntiPatterns("virtual.js", { source });
      const god = r.findings.find((f) => f.type === ANTI_PATTERNS.GOD_OBJECT);
      expect(god.severity).toBe("high");
    });

    it("reads from actual file when source opt omitted", () => {
      const filePath = path.join(tmpDir, "sample.js");
      fs.writeFileSync(filePath, "const x = 1;\n");
      const r = detectAntiPatterns(filePath);
      expect(r.lines).toBeGreaterThan(0);
    });

    it("throws when file is missing and no source supplied", () => {
      expect(() => detectAntiPatterns(path.join(tmpDir, "missing.js"))).toThrow(
        "File not found",
      );
    });

    it("respects custom threshold overrides", () => {
      const source = Array(15)
        .fill(0)
        .map((_, i) => `import x${i} from 'm${i}';`)
        .join("\n");
      const r = detectAntiPatterns("virtual.js", {
        source,
        tightCouplingThreshold: 5,
      });
      expect(
        r.findings.some((f) => f.type === ANTI_PATTERNS.TIGHT_COUPLING),
      ).toBe(true);
    });
  });

  describe("recordPractice / listPractices", () => {
    it("records a practice with valid fields", () => {
      const p = recordPractice(db, {
        techType: "framework",
        techName: "react",
        patternName: "use-effect-cleanup",
        level: "intermediate",
        description: "Always return cleanup fn from useEffect",
      });
      expect(p.practiceId).toBeTruthy();
      expect(p).not.toHaveProperty("_seq");
      expect(p.techType).toBe("framework");
    });

    it("persists to learned_practices table", () => {
      recordPractice(db, {
        techType: "language",
        techName: "typescript",
        patternName: "branded-types",
        level: "advanced",
      });
      const rows = db.prepare(`SELECT * FROM learned_practices`).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].tech_type).toBe("language");
      expect(rows[0].pattern_name).toBe("branded-types");
    });

    it("throws on unknown tech type", () => {
      expect(() =>
        recordPractice(db, {
          techType: "bogus",
          techName: "x",
          patternName: "y",
          level: "beginner",
        }),
      ).toThrow("Unknown tech type");
    });

    it("throws on unknown level", () => {
      expect(() =>
        recordPractice(db, {
          techType: "library",
          techName: "x",
          patternName: "y",
          level: "wizard",
        }),
      ).toThrow("Unknown level");
    });

    it("throws when techName missing", () => {
      expect(() =>
        recordPractice(db, {
          techType: "library",
          techName: "",
          patternName: "y",
          level: "beginner",
        }),
      ).toThrow("techName is required");
    });

    it("throws when patternName missing", () => {
      expect(() =>
        recordPractice(db, {
          techType: "library",
          techName: "x",
          patternName: "",
          level: "beginner",
        }),
      ).toThrow("patternName is required");
    });

    it("listPractices filters by techType + level", () => {
      recordPractice(db, {
        techType: "framework",
        techName: "react",
        patternName: "p1",
        level: "beginner",
      });
      recordPractice(db, {
        techType: "framework",
        techName: "vue",
        patternName: "p2",
        level: "advanced",
      });
      recordPractice(db, {
        techType: "library",
        techName: "axios",
        patternName: "p3",
        level: "beginner",
      });

      const beginnerFw = listPractices({
        techType: "framework",
        level: "beginner",
      });
      expect(beginnerFw).toHaveLength(1);
      expect(beginnerFw[0].patternName).toBe("p1");
    });

    it("listPractices filters by techName (case-insensitive)", () => {
      recordPractice(db, {
        techType: "framework",
        techName: "React",
        patternName: "p1",
        level: "beginner",
      });
      const rows = listPractices({ techName: "react" });
      expect(rows).toHaveLength(1);
    });

    it("listPractices respects limit", () => {
      for (let i = 0; i < 5; i++) {
        recordPractice(db, {
          techType: "library",
          techName: `lib${i}`,
          patternName: `p${i}`,
          level: "beginner",
        });
      }
      expect(listPractices({ limit: 2 })).toHaveLength(2);
    });

    it("listPractices sorts most-recent-first", () => {
      const a = recordPractice(db, {
        techType: "library",
        techName: "a",
        patternName: "p",
        level: "beginner",
      });
      const b = recordPractice(db, {
        techType: "library",
        techName: "b",
        patternName: "p",
        level: "beginner",
      });
      const rows = listPractices();
      expect(rows[0].practiceId).toBe(b.practiceId);
      expect(rows[1].practiceId).toBe(a.practiceId);
    });
  });

  describe("getRecommendations", () => {
    beforeEach(() => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          dependencies: { react: "^19.0.0", express: "^5.0.0" },
        }),
      );
      analyzeTechStack(db, tmpDir);
    });

    it("matches practices against analyzed stack names", () => {
      recordPractice(db, {
        techType: "framework",
        techName: "react",
        patternName: "hooks-rules",
        level: "intermediate",
      });
      recordPractice(db, {
        techType: "framework",
        techName: "angular",
        patternName: "not-applicable",
        level: "intermediate",
      });
      const r = getRecommendations();
      expect(r.totalMatches).toBe(1);
      expect(r.recommendations[0].techName).toBe("react");
    });

    it("returns empty when no practices recorded", () => {
      const r = getRecommendations();
      expect(r.recommendations).toHaveLength(0);
    });

    it("accepts explicit stackNames override", () => {
      recordPractice(db, {
        techType: "library",
        techName: "axios",
        patternName: "interceptor",
        level: "intermediate",
      });
      const r = getRecommendations({ stackNames: ["axios"] });
      expect(r.totalMatches).toBe(1);
    });

    it("returns message when no profile and no stackNames given", () => {
      _resetState();
      const r = getRecommendations();
      expect(r.recommendations).toHaveLength(0);
      expect(r.message).toMatch(/No analyzed stack/);
    });

    it("sorts recommendations by level rank descending", () => {
      recordPractice(db, {
        techType: "framework",
        techName: "react",
        patternName: "p-beginner",
        level: "beginner",
      });
      recordPractice(db, {
        techType: "framework",
        techName: "react",
        patternName: "p-expert",
        level: "expert",
      });
      const r = getRecommendations();
      expect(r.recommendations[0].level).toBe("expert");
      expect(r.recommendations[1].level).toBe("beginner");
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        recordPractice(db, {
          techType: "framework",
          techName: "react",
          patternName: `p${i}`,
          level: "beginner",
        });
      }
      const r = getRecommendations({ limit: 2 });
      expect(r.recommendations).toHaveLength(2);
    });
  });
});
