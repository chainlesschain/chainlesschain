/**
 * RequirementParser 单元测试
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { RequirementParser, REQUIREMENT_TYPES, SPEC_STATUS } = require("../requirement-parser");

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
  };
}

describe("RequirementParser", () => {
  let parser;
  let db;

  beforeEach(() => {
    parser = new RequirementParser();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await parser.initialize(db);
      expect(parser.initialized).toBe(true);
    });

    it("should accept optional CKG and LLM deps", async () => {
      const mockCKG = { initialized: true };
      const mockLLM = { query: vi.fn() };
      await parser.initialize(db, { codeKnowledgeGraph: mockCKG, llmService: mockLLM });
      expect(parser.initialized).toBe(true);
    });

    it("should be idempotent", async () => {
      await parser.initialize(db);
      await parser.initialize(db);
      expect(parser.initialized).toBe(true);
    });
  });

  describe("parse()", () => {
    beforeEach(async () => {
      await parser.initialize(db);
    });

    it("should throw for non-string requirement", async () => {
      await expect(parser.parse(null)).rejects.toThrow();
      await expect(parser.parse(123)).rejects.toThrow();
    });

    it("should parse a simple requirement and return spec", async () => {
      const spec = await parser.parse("Implement a user login page with email and password");
      expect(spec).toBeTruthy();
      expect(spec.id).toBeTruthy();
      expect(spec.description).toBeTruthy();
      expect(spec.status).toBe(SPEC_STATUS.PARSED);
    });

    it("should classify a feature requirement", async () => {
      const spec = await parser.parse("Add a new feature for user profile management");
      expect(spec.type).toBeTruthy();
    });

    it("should include parsedAt timestamp", async () => {
      const spec = await parser.parse("implement search functionality");
      expect(spec.parsedAt).toBeTruthy();
    });

    it("should extract tech stack hints from requirement", async () => {
      const spec = await parser.parse("Create a Vue component with REST API integration");
      expect(spec.techStack).toBeTruthy();
    });

    it("should include priority and complexity", async () => {
      const spec = await parser.parse("Fix critical authentication bug immediately");
      expect(spec.priority).toBeTruthy();
      expect(spec.complexity).toBeTruthy();
    });
  });

  describe("validateSpec()", () => {
    beforeEach(async () => {
      await parser.initialize(db);
    });

    it("should validate a well-formed spec", async () => {
      const spec = await parser.parse("Implement user registration with email validation");
      const validation = parser.validateSpec(spec);
      expect(validation).toHaveProperty("valid");
      expect(validation).toHaveProperty("errors");
      expect(typeof validation.valid).toBe("boolean");
    });

    it("should return errors for empty spec", () => {
      const validation = parser.validateSpec({ description: "", type: "feature" });
      expect(validation.valid).toBe(false);
      expect(Array.isArray(validation.errors)).toBe(true);
    });

    it("should include completeness score", async () => {
      const spec = await parser.parse("Add pagination to user list with 10 items per page");
      const validation = parser.validateSpec(spec);
      expect(validation).toHaveProperty("completeness");
    });
  });

  describe("refineSpec()", () => {
    beforeEach(async () => {
      await parser.initialize(db);
    });

    it("should return a refined spec with additional info", async () => {
      const spec = await parser.parse("create login page");
      const refined = parser.refineSpec(spec, {
        additionalRequirements: "Must support OAuth 2.0",
        priority: "high",
      });
      expect(refined).toBeTruthy();
    });
  });

  describe("getHistory()", () => {
    beforeEach(async () => {
      await parser.initialize(db);
    });

    it("should return an array", () => {
      const history = parser.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe("Constants", () => {
    it("REQUIREMENT_TYPES should have FEATURE and BUG_FIX", () => {
      expect(Object.values(REQUIREMENT_TYPES)).toContain(
        expect.stringMatching(/feature|bug/i)
      );
    });

    it("SPEC_STATUS should have PARSED", () => {
      expect(SPEC_STATUS.PARSED).toBeTruthy();
    });
  });
});
