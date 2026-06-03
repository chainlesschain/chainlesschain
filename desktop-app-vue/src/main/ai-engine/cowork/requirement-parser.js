/**
 * Requirement Parser — NL Requirement → Structured Spec JSON (v3.0)
 *
 * Parses natural language requirement descriptions into structured
 * specification JSON with:
 * - User stories extraction
 * - Acceptance criteria generation
 * - Boundary condition identification
 * - Dependency detection (from CKG)
 * - Technology stack inference
 *
 * @module ai-engine/cowork/requirement-parser
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const REQUIREMENT_TYPES = {
  FEATURE: "feature",
  BUGFIX: "bugfix",
  REFACTOR: "refactor",
  OPTIMIZATION: "optimization",
  SECURITY: "security",
  DOCUMENTATION: "documentation",
};

const SPEC_STATUS = {
  DRAFT: "draft",
  PARSED: "parsed",
  VALIDATED: "validated",
  REFINED: "refined",
  FAILED: "failed",
};

/**
 * Keywords used to classify requirement type
 */
const TYPE_KEYWORDS = {
  [REQUIREMENT_TYPES.BUGFIX]: [
    "fix",
    "bug",
    "error",
    "crash",
    "broken",
    "修复",
    "错误",
    "崩溃",
    "异常",
    "问题",
  ],
  [REQUIREMENT_TYPES.REFACTOR]: [
    "refactor",
    "重构",
    "优化代码",
    "整理",
    "clean up",
    "restructure",
  ],
  [REQUIREMENT_TYPES.OPTIMIZATION]: [
    "optimize",
    "performance",
    "speed",
    "性能",
    "优化",
    "加速",
    "缓存",
  ],
  [REQUIREMENT_TYPES.SECURITY]: [
    "security",
    "vulnerability",
    "auth",
    "安全",
    "漏洞",
    "认证",
    "权限",
    "加密",
  ],
  [REQUIREMENT_TYPES.DOCUMENTATION]: [
    "document",
    "readme",
    "文档",
    "注释",
    "说明",
  ],
};

/**
 * Common technology patterns for auto-detection
 */
const TECH_PATTERNS = {
  vue: /\b(vue|组件|component|页面|page|模板|template)\b/i,
  react: /\b(react|jsx|hook|useState|useEffect)\b/i,
  api: /\b(api|endpoint|接口|rest|graphql|请求|request)\b/i,
  database: /\b(database|数据库|table|表|sql|query|查询)\b/i,
  auth: /\b(auth|login|登录|认证|token|jwt|oauth|session)\b/i,
  test: /\b(test|测试|spec|assertion|mock|coverage)\b/i,
  ui: /\b(ui|界面|按钮|button|表单|form|列表|list|表格|table|分页|pagination)\b/i,
  storage: /\b(storage|存储|file|文件|upload|上传|download|下载)\b/i,
};

// ============================================================
// RequirementParser Class
// ============================================================

class RequirementParser {
  constructor() {
    this.db = null;
    this.initialized = false;

    // Dependencies
    this._codeKnowledgeGraph = null;
    this._llmService = null;

    // Cache
    this._parseHistory = [];
  }

  /**
   * Initialize with database and optional dependencies
   * @param {Object} db - Database instance
   * @param {Object} [deps] - Optional dependencies
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    this._codeKnowledgeGraph = deps.codeKnowledgeGraph || null;
    this._llmService = deps.llmService || null;

    this.initialized = true;
    logger.info("[RequirementParser] Initialized");
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Parse natural language requirement into structured Spec JSON
   * @param {string} requirement - NL requirement description
   * @param {Object} [options] - Parse options
   * @returns {Object} Structured specification
   */
  async parse(requirement, options = {}) {
    if (!requirement || typeof requirement !== "string") {
      throw new Error("Requirement must be a non-empty string");
    }

    const specId = `spec-${uuidv4().slice(0, 8)}`;
    const context = options.context || {};

    logger.info(
      `[RequirementParser] Parsing requirement: ${requirement.slice(0, 80)}...`,
    );

    try {
      // Step 1: Classify requirement type
      const type = this._classifyType(requirement);

      // Step 2: Extract user stories
      const userStories = this._extractUserStories(requirement);

      // Step 3: Extract acceptance criteria
      const acceptanceCriteria = this._extractAcceptanceCriteria(requirement);

      // Step 4: Detect technology concerns
      const techStack = this._detectTechStack(requirement);

      // Step 5: Identify boundary conditions
      const boundaryConditions = this._identifyBoundaryConditions(requirement);

      // Step 6: Extract dependencies from CKG (if available)
      const dependencies = await this._extractDependencies(
        requirement,
        context,
      );

      // Step 7: Build spec structure
      const spec = {
        id: specId,
        type,
        summary: this._extractSummary(requirement),
        description: requirement,
        userStories,
        acceptanceCriteria,
        techStack,
        boundaryConditions,
        dependencies,
        priority: this._inferPriority(requirement),
        complexity: this._estimateComplexity(requirement),
        context,
        status: SPEC_STATUS.PARSED,
        parsedAt: new Date().toISOString(),
      };

      // Step 8: LLM enhancement (if available)
      if (this._llmService) {
        try {
          const enhanced = await this._enhanceWithLLM(requirement, spec);
          Object.assign(spec, enhanced);
        } catch (llmError) {
          logger.warn(
            `[RequirementParser] LLM enhancement failed: ${llmError.message}`,
          );
        }
      }

      // Cache
      this._parseHistory.push({
        id: specId,
        requirement: requirement.slice(0, 200),
        type,
        parsedAt: spec.parsedAt,
      });
      if (this._parseHistory.length > 100) {
        this._parseHistory = this._parseHistory.slice(-50);
      }

      logger.info(
        `[RequirementParser] Parsed: ${specId} (${type}, ${userStories.length} stories, ${acceptanceCriteria.length} criteria)`,
      );

      return spec;
    } catch (error) {
      logger.error(`[RequirementParser] Parse error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate a spec for completeness
   * @param {Object} spec - Specification to validate
   * @returns {Object} Validation result
   */
  validateSpec(spec) {
    const issues = [];

    if (!spec.summary) {
      issues.push({ field: "summary", message: "Missing summary" });
    }
    if (!spec.userStories || spec.userStories.length === 0) {
      issues.push({
        field: "userStories",
        message: "No user stories extracted",
      });
    }
    if (!spec.acceptanceCriteria || spec.acceptanceCriteria.length === 0) {
      issues.push({
        field: "acceptanceCriteria",
        message: "No acceptance criteria defined",
      });
    }
    if (!spec.techStack || spec.techStack.length === 0) {
      issues.push({
        field: "techStack",
        message: "No technology stack detected",
      });
    }

    const isValid = issues.length === 0;
    if (isValid) {
      spec.status = SPEC_STATUS.VALIDATED;
    }

    return {
      valid: isValid,
      issues,
      completenessScore: this._computeCompletenessScore(spec),
    };
  }

  /**
   * Refine spec with additional context or corrections
   * @param {Object} spec - Original spec
   * @param {Object} refinements - Refinements to apply
   * @returns {Object} Refined spec
   */
  refineSpec(spec, refinements = {}) {
    const refined = { ...spec };

    if (refinements.userStories) {
      refined.userStories = [
        ...refined.userStories,
        ...refinements.userStories,
      ];
    }
    if (refinements.acceptanceCriteria) {
      refined.acceptanceCriteria = [
        ...refined.acceptanceCriteria,
        ...refinements.acceptanceCriteria,
      ];
    }
    if (refinements.boundaryConditions) {
      refined.boundaryConditions = [
        ...refined.boundaryConditions,
        ...refinements.boundaryConditions,
      ];
    }
    if (refinements.techStack) {
      refined.techStack = [
        ...new Set([...refined.techStack, ...refinements.techStack]),
      ];
    }
    if (refinements.dependencies) {
      refined.dependencies = [
        ...refined.dependencies,
        ...refinements.dependencies,
      ];
    }
    if (refinements.priority) {
      refined.priority = refinements.priority;
    }

    refined.status = SPEC_STATUS.REFINED;
    refined.refinedAt = new Date().toISOString();
    refined.refinementCount = (refined.refinementCount || 0) + 1;

    return refined;
  }

  /**
   * Get parse history
   * @param {number} [limit=20]
   * @returns {Array}
   */
  getHistory(limit = 20) {
    return this._parseHistory.slice(-limit);
  }

  // ============================================================
  // Analysis Methods
  // ============================================================

  /**
   * Classify requirement type from text
   * @private
   */
  _classifyType(text) {
    const lowerText = text.toLowerCase();

    for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
      const matchCount = keywords.filter((kw) =>
        lowerText.includes(kw.toLowerCase()),
      ).length;
      if (matchCount >= 2) {
        return type;
      }
    }

    // Single keyword match
    for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
      if (keywords.some((kw) => lowerText.includes(kw.toLowerCase()))) {
        return type;
      }
    }

    return REQUIREMENT_TYPES.FEATURE;
  }

  /**
   * Extract user stories from requirement text
   * @private
   */
  _extractUserStories(text) {
    const stories = [];

    // Pattern: "As a ... I want ... so that ..."
    const asAPattern =
      /(?:as\s+a|作为)\s+([^,，]+)[,，]\s*(?:I\s+want|我想要?|我需要|我希望)\s+([^,，。.]+)/gi;
    let match;
    while ((match = asAPattern.exec(text)) !== null) {
      stories.push({
        role: match[1].trim(),
        want: match[2].trim(),
        format: "user-story",
      });
    }

    // If no explicit stories found, generate from requirement
    if (stories.length === 0) {
      const actions = this._extractActions(text);
      for (const action of actions) {
        stories.push({
          role: "user",
          want: action,
          format: "inferred",
        });
      }
    }

    return stories;
  }

  /**
   * Extract acceptance criteria from requirement text
   * @private
   */
  _extractAcceptanceCriteria(text) {
    const criteria = [];

    // Pattern: numbered or bulleted items
    const bulletPattern = /(?:^|\n)\s*[-•*]\s*(.+)/g;
    let match;
    while ((match = bulletPattern.exec(text)) !== null) {
      criteria.push({
        description: match[1].trim(),
        format: "bullet",
      });
    }

    // Pattern: "should" / "must" / "需要" / "应该" clauses
    const shouldPattern =
      /(?:should|must|需要|应该|必须|要求)\s+([^。.!！;；]+)/gi;
    while ((match = shouldPattern.exec(text)) !== null) {
      const desc = match[1].trim();
      if (desc.length > 5 && !criteria.some((c) => c.description === desc)) {
        criteria.push({
          description: desc,
          format: "inferred",
        });
      }
    }

    // Pattern: "支持" / "support" clauses
    const supportPattern = /(?:支持|support)\s+([^。.!！;；,，]+)/gi;
    while ((match = supportPattern.exec(text)) !== null) {
      const desc = `支持 ${match[1].trim()}`;
      if (!criteria.some((c) => c.description === desc)) {
        criteria.push({
          description: desc,
          format: "inferred",
        });
      }
    }

    return criteria;
  }

  /**
   * Detect technology stack from requirement text
   * @private
   */
  _detectTechStack(text) {
    const detected = [];
    for (const [tech, pattern] of Object.entries(TECH_PATTERNS)) {
      if (pattern.test(text)) {
        detected.push(tech);
      }
    }
    return detected;
  }

  /**
   * Identify boundary conditions and edge cases
   * @private
   */
  _identifyBoundaryConditions(text) {
    const conditions = [];

    // Look for numeric limits
    const numericPattern =
      /(\d+)\s*(个|条|项|次|秒|分钟|小时|ms|sec|min|hour|items?|records?|pages?|rows?)/gi;
    let match;
    while ((match = numericPattern.exec(text)) !== null) {
      conditions.push({
        type: "limit",
        value: parseInt(match[1]),
        unit: match[2],
        raw: match[0],
      });
    }

    // Look for error handling mentions
    const errorPattern =
      /(?:error|错误|失败|异常|超时|timeout|edge case|边界)/gi;
    if (errorPattern.test(text)) {
      conditions.push({
        type: "error-handling",
        description: "Error handling and edge cases mentioned",
      });
    }

    // Look for performance constraints
    const perfPattern =
      /(?:less than|小于|不超过|<)\s*(\d+)\s*(ms|秒|seconds?)/gi;
    while ((match = perfPattern.exec(text)) !== null) {
      conditions.push({
        type: "performance",
        value: parseInt(match[1]),
        unit: match[2],
        raw: match[0],
      });
    }

    return conditions;
  }

  /**
   * Extract dependencies from Code Knowledge Graph
   * @private
   */
  async _extractDependencies(requirement, context) {
    if (!this._codeKnowledgeGraph?.initialized) {
      return [];
    }

    try {
      const techStack = this._detectTechStack(requirement);
      const dependencies = [];

      // Query CKG for related modules based on tech stack
      for (const tech of techStack) {
        const entities = this._codeKnowledgeGraph._entities;
        if (entities) {
          for (const [, entity] of entities) {
            if (
              entity.type === "module" &&
              entity.name?.toLowerCase().includes(tech)
            ) {
              dependencies.push({
                type: "module",
                name: entity.name,
                filePath: entity.filePath,
                source: "ckg",
              });
            }
          }
        }
      }

      // Limit to top 10
      return dependencies.slice(0, 10);
    } catch (error) {
      logger.warn(
        `[RequirementParser] CKG dependency extraction failed: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Extract action verbs/phrases from text
   * @private
   */
  _extractActions(text) {
    const actions = [];

    // Chinese action patterns
    const cnActionPattern =
      /(?:实现|创建|添加|开发|构建|设计|集成|支持|提供|完成|生成|优化)\s*([^。.!！;；,，]{3,40})/g;
    let match;
    while ((match = cnActionPattern.exec(text)) !== null) {
      actions.push(match[0].trim());
    }

    // English action patterns
    const enActionPattern =
      /(?:implement|create|add|develop|build|design|integrate|support|provide)\s+([^.!;,]{3,60})/gi;
    while ((match = enActionPattern.exec(text)) !== null) {
      actions.push(match[0].trim());
    }

    // Deduplicate
    return [...new Set(actions)].slice(0, 10);
  }

  /**
   * Extract a summary (first sentence or first N chars)
   * @private
   */
  _extractSummary(text) {
    // First sentence
    const sentenceEnd = text.search(/[。.!！\n]/);
    if (sentenceEnd > 0 && sentenceEnd < 200) {
      return text.slice(0, sentenceEnd).trim();
    }
    // First 100 chars
    return text.slice(0, 100).trim() + (text.length > 100 ? "..." : "");
  }

  /**
   * Infer priority from requirement text
   * @private
   */
  _inferPriority(text) {
    const lowerText = text.toLowerCase();
    if (/\b(urgent|critical|asap|紧急|关键|尽快|立即)\b/.test(lowerText)) {
      return "critical";
    }
    if (/\b(high|important|重要|高优先|优先)\b/.test(lowerText)) {
      return "high";
    }
    if (/\b(low|minor|低优先|可选|后续)\b/.test(lowerText)) {
      return "low";
    }
    return "medium";
  }

  /**
   * Estimate complexity from requirement text
   * @private
   */
  _estimateComplexity(text) {
    let score = 0;

    // Length contributes to complexity
    score += Math.min(text.length / 100, 3);

    // Number of distinct features/actions
    const actions = this._extractActions(text);
    score += Math.min(actions.length, 5);

    // Technology breadth
    const techStack = this._detectTechStack(text);
    score += techStack.length;

    // Integration keywords
    const integrationKeywords = [
      "integrate",
      "connect",
      "sync",
      "集成",
      "连接",
      "同步",
      "对接",
    ];
    const integrationCount = integrationKeywords.filter((kw) =>
      text.toLowerCase().includes(kw),
    ).length;
    score += integrationCount * 2;

    if (score <= 3) {
      return "low";
    }
    if (score <= 7) {
      return "medium";
    }
    if (score <= 12) {
      return "high";
    }
    return "very-high";
  }

  /**
   * Compute completeness score for a spec
   * @private
   */
  _computeCompletenessScore(spec) {
    let score = 0;
    const weights = {
      summary: 15,
      userStories: 25,
      acceptanceCriteria: 25,
      techStack: 15,
      boundaryConditions: 10,
      dependencies: 10,
    };

    if (spec.summary) {
      score += weights.summary;
    }
    if (spec.userStories?.length > 0) {
      score += Math.min(
        (spec.userStories.length / 3) * weights.userStories,
        weights.userStories,
      );
    }
    if (spec.acceptanceCriteria?.length > 0) {
      score += Math.min(
        (spec.acceptanceCriteria.length / 3) * weights.acceptanceCriteria,
        weights.acceptanceCriteria,
      );
    }
    if (spec.techStack?.length > 0) {
      score += weights.techStack;
    }
    if (spec.boundaryConditions?.length > 0) {
      score += weights.boundaryConditions;
    }
    if (spec.dependencies?.length > 0) {
      score += weights.dependencies;
    }

    return Math.round(score);
  }

  /**
   * Enhance spec using LLM service
   * @private
   */
  async _enhanceWithLLM(requirement, spec) {
    const prompt = `Given this software requirement:
"${requirement}"

Current parsed spec:
- Type: ${spec.type}
- User Stories: ${spec.userStories.length}
- Acceptance Criteria: ${spec.acceptanceCriteria.length}
- Tech Stack: ${spec.techStack.join(", ")}

Please provide:
1. Any missing user stories (JSON array of {role, want})
2. Any missing acceptance criteria (JSON array of {description})
3. Suggested file structure (JSON array of file paths)
4. Estimated effort in hours

Respond in JSON format.`;

    const response = await this._llmService.query(prompt);

    try {
      const parsed = JSON.parse(response);
      return {
        llmEnhanced: true,
        suggestedFileStructure: parsed.fileStructure || [],
        estimatedEffortHours: parsed.estimatedEffort || null,
      };
    } catch {
      return { llmEnhanced: false };
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getRequirementParser() {
  if (!instance) {
    instance = new RequirementParser();
  }
  return instance;
}

module.exports = {
  RequirementParser,
  getRequirementParser,
  REQUIREMENT_TYPES,
  SPEC_STATUS,
};
