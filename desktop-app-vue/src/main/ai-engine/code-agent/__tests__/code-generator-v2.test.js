import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { CodeGeneratorV2 } = require("../code-generator-v2");

describe("CodeGeneratorV2", () => {
  let generator;
  let db;

  beforeEach(() => {
    generator = new CodeGeneratorV2();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // --- Initialization ---

  it("should start uninitialized", () => {
    expect(generator.initialized).toBe(false);
    expect(generator._generationHistory).toHaveLength(0);
    expect(generator._reviewHistory).toHaveLength(0);
  });

  it("should initialize with database", async () => {
    await generator.initialize(db);
    expect(generator.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalled();
  });

  it("should skip double initialization", async () => {
    await generator.initialize(db);
    const callCount = db.exec.mock.calls.length;
    await generator.initialize(db);
    expect(db.exec.mock.calls.length).toBe(callCount);
  });

  // --- Generate ---

  it("should generate code with default language", async () => {
    await generator.initialize(db);
    const result = await generator.generate("create a hello world function");
    expect(result.id).toMatch(/^gen-/);
    expect(result.language).toBe("javascript");
    expect(result.output.code).toContain("hello world");
    expect(result.output.explanation).toBeDefined();
  });

  it("should generate code with specified language", async () => {
    await generator.initialize(db);
    const result = await generator.generate("sort algorithm", {
      language: "python",
    });
    expect(result.language).toBe("python");
    expect(result.output.code).toContain("python");
  });

  it("should include tests when requested", async () => {
    await generator.initialize(db);
    const result = await generator.generate("utility function", {
      includeTests: true,
    });
    expect(result.output.tests).not.toBeNull();
  });

  it("should not include tests by default", async () => {
    await generator.initialize(db);
    const result = await generator.generate("utility function");
    expect(result.output.tests).toBeNull();
  });

  it("should track generation history", async () => {
    await generator.initialize(db);
    await generator.generate("func 1");
    await generator.generate("func 2");
    expect(generator._generationHistory).toHaveLength(2);
  });

  it("should persist generation to database", async () => {
    await generator.initialize(db);
    await generator.generate("test");
    expect(db.prepare).toHaveBeenCalled();
    expect(db._prep.run).toHaveBeenCalled();
  });

  it("should delegate to injected llmManager and mark llmUsed", async () => {
    const llmManager = {
      query: vi
        .fn()
        .mockResolvedValue({ text: "function add(a,b){return a+b}" }),
    };
    await generator.initialize(db, { llmManager });
    const result = await generator.generate("add two numbers", {
      language: "javascript",
    });
    expect(llmManager.query).toHaveBeenCalledOnce();
    expect(result.output.code).toBe("function add(a,b){return a+b}");
    expect(result.metadata.llmUsed).toBe(true);
  });

  it("should fall back to stub when llmManager throws", async () => {
    const llmManager = {
      query: vi.fn().mockRejectedValue(new Error("LLM down")),
    };
    await generator.initialize(db, { llmManager });
    const result = await generator.generate("hello world", {
      language: "python",
    });
    expect(result.output.code).toContain("hello world");
    expect(result.output.code).toContain("python");
    expect(result.metadata.llmUsed).toBe(false);
  });

  // --- Review ---

  it("should review clean code with high score", async () => {
    await generator.initialize(db);
    const result = await generator.review(
      "function add(a, b) { return a + b; }",
    );
    expect(result.score).toBe(0.95);
    expect(result.issues).toHaveLength(0);
  });

  it("should detect eval() usage", async () => {
    await generator.initialize(db);
    const result = await generator.review('const x = eval("1+1");');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe("high");
    expect(result.issues[0].message).toContain("eval()");
    expect(result.score).toBeLessThan(0.95);
  });

  it("should suggest removing TODO comments", async () => {
    await generator.initialize(db);
    const result = await generator.review("// TODO: fix this\nfunction x() {}");
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].type).toBe("cleanup");
  });

  it("should track review history", async () => {
    await generator.initialize(db);
    await generator.review("code1");
    await generator.review("code2");
    expect(generator._reviewHistory).toHaveLength(2);
  });

  // --- Fix ---

  it("should return fix result structure", async () => {
    await generator.initialize(db);
    const result = await generator.fix("broken code", [{ message: "bug" }]);
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("original");
    expect(result).toHaveProperty("fixed");
    expect(result).toHaveProperty("changes");
  });

  // --- Scaffold ---

  it("should scaffold a valid template", async () => {
    await generator.initialize(db);
    const result = await generator.scaffold("react", { name: "my-app" });
    expect(result.template).toBe("react");
    expect(result.projectName).toBe("my-app");
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files.some((f) => f.path === "package.json")).toBe(true);
  });

  it("should scaffold all supported templates", async () => {
    await generator.initialize(db);
    for (const tmpl of ["react", "vue", "express", "fastapi", "spring-boot"]) {
      const result = await generator.scaffold(tmpl, { name: "proj" });
      expect(result.files.length).toBeGreaterThan(0);
    }
  });

  it("should throw for invalid template", async () => {
    await generator.initialize(db);
    await expect(generator.scaffold("unknown-framework")).rejects.toThrow(
      "Unknown template",
    );
  });

  // --- CI/CD ---

  it("should configure github-actions CI/CD", async () => {
    await generator.initialize(db);
    const result = await generator.configureCICD("node", {
      platform: "github-actions",
    });
    expect(result.platform).toBe("github-actions");
    expect(result.file).toBe(".github/workflows/ci.yml");
    expect(result.content).toContain("actions/checkout");
  });

  it("should configure gitlab-ci", async () => {
    await generator.initialize(db);
    const result = await generator.configureCICD("node", {
      platform: "gitlab-ci",
    });
    expect(result.platform).toBe("gitlab-ci");
    expect(result.file).toBe(".gitlab-ci.yml");
  });

  it("should default to github-actions", async () => {
    await generator.initialize(db);
    const result = await generator.configureCICD("node");
    expect(result.platform).toBe("github-actions");
  });

  // --- Git Analysis ---

  it("should return git analysis structure", async () => {
    await generator.initialize(db);
    const result = await generator.analyzeGit("/repo");
    expect(result.repoPath).toBe("/repo");
    expect(result).toHaveProperty("branches");
    expect(result).toHaveProperty("recentCommits");
  });

  // --- Explain ---

  it("should explain code and detect complexity", async () => {
    await generator.initialize(db);
    const shortCode = "const x = 1;";
    const result = await generator.explain(shortCode);
    expect(result.complexity).toBe("low");
    expect(result).toHaveProperty("explanation");
  });

  // --- Refactor ---

  it("should return refactor result with strategy", async () => {
    await generator.initialize(db);
    const result = await generator.refactor("old code", {
      strategy: "extract-method",
    });
    expect(result.strategy).toBe("extract-method");
    expect(result).toHaveProperty("original");
    expect(result).toHaveProperty("refactored");
  });

  it("should default to clean-code strategy", async () => {
    await generator.initialize(db);
    const result = await generator.refactor("code");
    expect(result.strategy).toBe("clean-code");
  });
});
