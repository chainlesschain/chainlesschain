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
  PROFILE_MATURITY_V2,
  LEARNING_RUN_V2,
  TLE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER,
  TLE_DEFAULT_MAX_STUDYING_RUNS_PER_LEARNER,
  TLE_DEFAULT_PROFILE_STALE_MS,
  TLE_DEFAULT_RUN_STUCK_MS,
  getMaxActiveProfilesPerOwnerV2,
  setMaxActiveProfilesPerOwnerV2,
  getMaxStudyingRunsPerLearnerV2,
  setMaxStudyingRunsPerLearnerV2,
  getProfileStaleMsV2,
  setProfileStaleMsV2,
  getRunStuckMsV2,
  setRunStuckMsV2,
  getActiveProfileCountV2,
  getStudyingRunCountV2,
  createProfileV2,
  getProfileV2,
  listProfilesV2,
  setProfileMaturityV2,
  activateProfileV2,
  markProfileStaleV2,
  archiveProfileV2,
  touchProfileV2,
  enqueueRunV2,
  getRunV2,
  listRunsV2,
  setRunStatusV2,
  startRunV2,
  completeRunV2,
  abandonRunV2,
  failRunV2,
  autoMarkStaleProfilesV2,
  autoFailStuckRunsV2,
  getTechLearningStatsV2,
  _resetStateV2,
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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface Tests — Tech Learning Engine V2
 * ═══════════════════════════════════════════════════════════════ */

describe("tech-learning-engine V2", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enums", () => {
    it("PROFILE_MATURITY_V2 has 4 states and is frozen", () => {
      expect(Object.isFrozen(PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.values(PROFILE_MATURITY_V2).sort()).toEqual([
        "active",
        "archived",
        "draft",
        "stale",
      ]);
    });
    it("LEARNING_RUN_V2 has 5 states and is frozen", () => {
      expect(Object.isFrozen(LEARNING_RUN_V2)).toBe(true);
      expect(Object.values(LEARNING_RUN_V2).sort()).toEqual([
        "abandoned",
        "completed",
        "failed",
        "queued",
        "studying",
      ]);
    });
  });

  describe("defaults", () => {
    it("exposes default constants", () => {
      expect(TLE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER).toBe(10);
      expect(TLE_DEFAULT_MAX_STUDYING_RUNS_PER_LEARNER).toBe(5);
      expect(TLE_DEFAULT_PROFILE_STALE_MS).toBe(60 * 24 * 60 * 60 * 1000);
      expect(TLE_DEFAULT_RUN_STUCK_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
    it("getters match defaults after reset", () => {
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(10);
      expect(getMaxStudyingRunsPerLearnerV2()).toBe(5);
      expect(getProfileStaleMsV2()).toBe(TLE_DEFAULT_PROFILE_STALE_MS);
      expect(getRunStuckMsV2()).toBe(TLE_DEFAULT_RUN_STUCK_MS);
    });
  });

  describe("config setters", () => {
    it("accept positive ints, reject zero/NaN/negative", () => {
      expect(setMaxActiveProfilesPerOwnerV2(3)).toBe(3);
      expect(setMaxStudyingRunsPerLearnerV2(2)).toBe(2);
      expect(setProfileStaleMsV2(1000)).toBe(1000);
      expect(setRunStuckMsV2(500)).toBe(500);
      expect(() => setMaxActiveProfilesPerOwnerV2(0)).toThrow(
        /positive integer/,
      );
      expect(() => setMaxStudyingRunsPerLearnerV2(-1)).toThrow(
        /positive integer/,
      );
      expect(() => setProfileStaleMsV2(NaN)).toThrow(/positive integer/);
      expect(() => setRunStuckMsV2("foo")).toThrow(/positive integer/);
    });
    it("floors non-integer positive inputs", () => {
      expect(setMaxActiveProfilesPerOwnerV2(3.7)).toBe(3);
    });
  });

  describe("createProfileV2", () => {
    it("creates a profile in draft", () => {
      const p = createProfileV2({
        id: "p1",
        owner: "alice",
        stackName: "react-stack",
      });
      expect(p.status).toBe(PROFILE_MATURITY_V2.DRAFT);
      expect(p.activatedAt).toBeNull();
      expect(p.owner).toBe("alice");
      expect(p.stackName).toBe("react-stack");
    });
    it("requires id, owner, stackName", () => {
      expect(() => createProfileV2({ owner: "a", stackName: "s" })).toThrow(
        /id is required/,
      );
      expect(() => createProfileV2({ id: "p1", stackName: "s" })).toThrow(
        /owner is required/,
      );
      expect(() => createProfileV2({ id: "p1", owner: "a" })).toThrow(
        /stackName is required/,
      );
    });
    it("rejects duplicate id", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      expect(() =>
        createProfileV2({ id: "p1", owner: "a", stackName: "s" }),
      ).toThrow(/already exists/);
    });
    it("copies metadata defensively", () => {
      const meta = { tag: "x" };
      const p = createProfileV2({
        id: "p1",
        owner: "a",
        stackName: "s",
        metadata: meta,
      });
      meta.tag = "y";
      expect(getProfileV2("p1").metadata.tag).toBe("x");
      p.metadata.tag = "z";
      expect(getProfileV2("p1").metadata.tag).toBe("x");
    });
  });

  describe("getProfileV2 / listProfilesV2", () => {
    it("returns null for unknown id", () => {
      expect(getProfileV2("nope")).toBeNull();
    });
    it("filters by owner and status", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s1" });
      createProfileV2({ id: "p2", owner: "a", stackName: "s2" });
      createProfileV2({ id: "p3", owner: "b", stackName: "s3" });
      activateProfileV2("p1");
      expect(listProfilesV2({ owner: "a" })).toHaveLength(2);
      expect(listProfilesV2({ owner: "b" })).toHaveLength(1);
      expect(
        listProfilesV2({ status: PROFILE_MATURITY_V2.ACTIVE }),
      ).toHaveLength(1);
    });
  });

  describe("setProfileMaturityV2 state machine", () => {
    it("draft → active", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      const p = setProfileMaturityV2("p1", PROFILE_MATURITY_V2.ACTIVE);
      expect(p.status).toBe(PROFILE_MATURITY_V2.ACTIVE);
      expect(p.activatedAt).toBeTypeOf("number");
    });
    it("active → stale", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      activateProfileV2("p1");
      const p = markProfileStaleV2("p1");
      expect(p.status).toBe(PROFILE_MATURITY_V2.STALE);
    });
    it("stale → active (recovery)", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      activateProfileV2("p1");
      markProfileStaleV2("p1");
      const p = activateProfileV2("p1");
      expect(p.status).toBe(PROFILE_MATURITY_V2.ACTIVE);
    });
    it("any non-terminal → archived", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      archiveProfileV2("p1");
      expect(getProfileV2("p1").status).toBe(PROFILE_MATURITY_V2.ARCHIVED);

      createProfileV2({ id: "p2", owner: "a", stackName: "s" });
      activateProfileV2("p2");
      archiveProfileV2("p2");
      expect(getProfileV2("p2").status).toBe(PROFILE_MATURITY_V2.ARCHIVED);
    });
    it("archived is terminal", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      archiveProfileV2("p1");
      expect(() => activateProfileV2("p1")).toThrow(/cannot transition/);
      expect(() => markProfileStaleV2("p1")).toThrow(/cannot transition/);
    });
    it("draft cannot go directly to stale", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      expect(() => markProfileStaleV2("p1")).toThrow(/cannot transition/);
    });
    it("throws on unknown id", () => {
      expect(() =>
        setProfileMaturityV2("nope", PROFILE_MATURITY_V2.ACTIVE),
      ).toThrow(/not found/);
    });
    it("stamps activatedAt once", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      const p1 = activateProfileV2("p1");
      const first = p1.activatedAt;
      markProfileStaleV2("p1");
      const p2 = activateProfileV2("p1");
      expect(p2.activatedAt).toBe(first);
    });
    it("merges reason and metadata patch", () => {
      createProfileV2({
        id: "p1",
        owner: "a",
        stackName: "s",
        metadata: { a: 1 },
      });
      const p = activateProfileV2("p1", {
        reason: "ready",
        metadata: { b: 2 },
      });
      expect(p.reason).toBe("ready");
      expect(p.metadata).toEqual({ a: 1, b: 2 });
    });
  });

  describe("getActiveProfileCountV2 / cap", () => {
    it("excludes draft and archived", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s1" });
      createProfileV2({ id: "p2", owner: "a", stackName: "s2" });
      activateProfileV2("p2");
      createProfileV2({ id: "p3", owner: "a", stackName: "s3" });
      archiveProfileV2("p3");
      expect(getActiveProfileCountV2("a")).toBe(1);
    });
    it("counts active and stale", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s1" });
      activateProfileV2("p1");
      createProfileV2({ id: "p2", owner: "a", stackName: "s2" });
      activateProfileV2("p2");
      markProfileStaleV2("p2");
      expect(getActiveProfileCountV2("a")).toBe(2);
    });
    it("requires owner", () => {
      expect(() => getActiveProfileCountV2()).toThrow(/owner is required/);
    });
    it("activation blocked when cap reached", () => {
      setMaxActiveProfilesPerOwnerV2(2);
      createProfileV2({ id: "p1", owner: "a", stackName: "s1" });
      activateProfileV2("p1");
      createProfileV2({ id: "p2", owner: "a", stackName: "s2" });
      activateProfileV2("p2");
      createProfileV2({ id: "p3", owner: "a", stackName: "s3" });
      expect(() => activateProfileV2("p3")).toThrow(/max active profile cap/);
    });
    it("stale→active recovery bypasses cap (already counted)", () => {
      setMaxActiveProfilesPerOwnerV2(1);
      createProfileV2({ id: "p1", owner: "a", stackName: "s1" });
      activateProfileV2("p1");
      markProfileStaleV2("p1");
      expect(() => activateProfileV2("p1")).not.toThrow();
    });
  });

  describe("touchProfileV2", () => {
    it("updates lastTouchedAt", async () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      activateProfileV2("p1");
      const before = getProfileV2("p1").lastTouchedAt;
      await new Promise((r) => setTimeout(r, 5));
      const after = touchProfileV2("p1").lastTouchedAt;
      expect(after).toBeGreaterThan(before);
    });
    it("throws on terminal profile", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      archiveProfileV2("p1");
      expect(() => touchProfileV2("p1")).toThrow(/terminal/);
    });
    it("throws on unknown id", () => {
      expect(() => touchProfileV2("nope")).toThrow(/not found/);
    });
  });

  describe("enqueueRunV2", () => {
    it("creates a run in queued", () => {
      const r = enqueueRunV2({ id: "r1", learner: "bob", topic: "rust" });
      expect(r.status).toBe(LEARNING_RUN_V2.QUEUED);
      expect(r.startedAt).toBeNull();
      expect(r.endedAt).toBeNull();
    });
    it("requires id, learner, topic", () => {
      expect(() => enqueueRunV2({ learner: "b", topic: "t" })).toThrow(
        /id is required/,
      );
      expect(() => enqueueRunV2({ id: "r1", topic: "t" })).toThrow(
        /learner is required/,
      );
      expect(() => enqueueRunV2({ id: "r1", learner: "b" })).toThrow(
        /topic is required/,
      );
    });
    it("rejects duplicate id", () => {
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      expect(() =>
        enqueueRunV2({ id: "r1", learner: "b", topic: "t" }),
      ).toThrow(/already/);
    });
  });

  describe("run state machine", () => {
    it("queued → studying", () => {
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      const r = startRunV2("r1");
      expect(r.status).toBe(LEARNING_RUN_V2.STUDYING);
      expect(r.startedAt).toBeTypeOf("number");
    });
    it("studying → completed", () => {
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      startRunV2("r1");
      const r = completeRunV2("r1");
      expect(r.status).toBe(LEARNING_RUN_V2.COMPLETED);
      expect(r.endedAt).toBeTypeOf("number");
    });
    it("studying → failed", () => {
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      startRunV2("r1");
      const r = failRunV2("r1", { reason: "broken" });
      expect(r.status).toBe(LEARNING_RUN_V2.FAILED);
      expect(r.reason).toBe("broken");
    });
    it("queued → abandoned", () => {
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      const r = abandonRunV2("r1");
      expect(r.status).toBe(LEARNING_RUN_V2.ABANDONED);
    });
    it("terminals do not transition", () => {
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      startRunV2("r1");
      completeRunV2("r1");
      expect(() => failRunV2("r1")).toThrow(/cannot transition/);
      expect(() => abandonRunV2("r1")).toThrow(/cannot transition/);
    });
    it("stamps startedAt once", () => {
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      const r1 = startRunV2("r1");
      expect(r1.startedAt).toBeTypeOf("number");
    });
    it("throws on unknown id", () => {
      expect(() => startRunV2("nope")).toThrow(/not found/);
    });
    it("cannot queued → completed directly", () => {
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      expect(() => completeRunV2("r1")).toThrow(/cannot transition/);
    });
  });

  describe("studying-run cap", () => {
    it("per-learner cap blocks start", () => {
      setMaxStudyingRunsPerLearnerV2(2);
      for (let i = 1; i <= 3; i++) {
        enqueueRunV2({ id: `r${i}`, learner: "b", topic: "t" });
      }
      startRunV2("r1");
      startRunV2("r2");
      expect(() => startRunV2("r3")).toThrow(/max studying run cap/);
    });
    it("completion frees the slot", () => {
      setMaxStudyingRunsPerLearnerV2(1);
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      enqueueRunV2({ id: "r2", learner: "b", topic: "t" });
      startRunV2("r1");
      expect(() => startRunV2("r2")).toThrow(/max studying run cap/);
      completeRunV2("r1");
      expect(() => startRunV2("r2")).not.toThrow();
    });
    it("getStudyingRunCountV2 requires learner", () => {
      expect(() => getStudyingRunCountV2()).toThrow(/learner is required/);
    });
  });

  describe("listRunsV2", () => {
    it("filters by learner and status", () => {
      enqueueRunV2({ id: "r1", learner: "a", topic: "t" });
      enqueueRunV2({ id: "r2", learner: "a", topic: "t" });
      enqueueRunV2({ id: "r3", learner: "b", topic: "t" });
      startRunV2("r1");
      expect(listRunsV2({ learner: "a" })).toHaveLength(2);
      expect(listRunsV2({ status: LEARNING_RUN_V2.STUDYING })).toHaveLength(1);
      expect(
        listRunsV2({ learner: "b", status: LEARNING_RUN_V2.QUEUED }),
      ).toHaveLength(1);
    });
  });

  describe("autoMarkStaleProfilesV2", () => {
    it("flips only active profiles past stale threshold", () => {
      setProfileStaleMsV2(1000);
      createProfileV2({ id: "p1", owner: "a", stackName: "s1" });
      activateProfileV2("p1");
      createProfileV2({ id: "p2", owner: "a", stackName: "s2" });
      activateProfileV2("p2");
      touchProfileV2("p2");
      const now = Date.now() + 5000;
      const flipped = autoMarkStaleProfilesV2({ now });
      expect(flipped).toEqual(expect.arrayContaining(["p1", "p2"]));
      expect(getProfileV2("p1").status).toBe(PROFILE_MATURITY_V2.STALE);
    });
    it("ignores non-active profiles", () => {
      setProfileStaleMsV2(10);
      createProfileV2({ id: "p1", owner: "a", stackName: "s1" });
      const now = Date.now() + 100000;
      const flipped = autoMarkStaleProfilesV2({ now });
      expect(flipped).toEqual([]);
    });
    it("returns empty when nothing stale", () => {
      setProfileStaleMsV2(1000 * 1000);
      createProfileV2({ id: "p1", owner: "a", stackName: "s1" });
      activateProfileV2("p1");
      expect(autoMarkStaleProfilesV2()).toEqual([]);
    });
  });

  describe("autoFailStuckRunsV2", () => {
    it("fails only studying runs past stuck threshold", () => {
      setRunStuckMsV2(500);
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      startRunV2("r1");
      enqueueRunV2({ id: "r2", learner: "b", topic: "t" });
      startRunV2("r2");
      const now = Date.now() + 5000;
      const failed = autoFailStuckRunsV2({ now });
      expect(failed).toEqual(expect.arrayContaining(["r1", "r2"]));
      expect(getRunV2("r1").status).toBe(LEARNING_RUN_V2.FAILED);
      expect(getRunV2("r1").reason).toMatch(/auto-fail/);
    });
    it("ignores queued runs", () => {
      setRunStuckMsV2(10);
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      const now = Date.now() + 100000;
      expect(autoFailStuckRunsV2({ now })).toEqual([]);
    });
  });

  describe("getTechLearningStatsV2", () => {
    it("reports totals + zero-initialized status buckets", () => {
      const s = getTechLearningStatsV2();
      expect(s.totalProfilesV2).toBe(0);
      expect(s.totalRunsV2).toBe(0);
      expect(s.profilesByStatus.draft).toBe(0);
      expect(s.profilesByStatus.active).toBe(0);
      expect(s.profilesByStatus.stale).toBe(0);
      expect(s.profilesByStatus.archived).toBe(0);
      expect(s.runsByStatus.queued).toBe(0);
      expect(s.runsByStatus.studying).toBe(0);
      expect(s.runsByStatus.completed).toBe(0);
    });
    it("counts by status after mutations", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s1" });
      activateProfileV2("p1");
      createProfileV2({ id: "p2", owner: "a", stackName: "s2" });
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      startRunV2("r1");
      const s = getTechLearningStatsV2();
      expect(s.totalProfilesV2).toBe(2);
      expect(s.profilesByStatus.active).toBe(1);
      expect(s.profilesByStatus.draft).toBe(1);
      expect(s.runsByStatus.studying).toBe(1);
    });
  });

  describe("_resetStateV2", () => {
    it("clears maps and restores defaults", () => {
      createProfileV2({ id: "p1", owner: "a", stackName: "s" });
      enqueueRunV2({ id: "r1", learner: "b", topic: "t" });
      setMaxActiveProfilesPerOwnerV2(99);
      _resetStateV2();
      expect(getTechLearningStatsV2().totalProfilesV2).toBe(0);
      expect(getTechLearningStatsV2().totalRunsV2).toBe(0);
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(10);
    });
  });
});
