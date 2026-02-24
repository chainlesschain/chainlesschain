/**
 * Spec Translator — NL→Spec JSON Translation Engine (v3.1)
 *
 * Converts natural language requirements into structured Spec JSON:
 * - Intent recognition (create-component, add-feature, fix-bug, refactor, etc.)
 * - Context completion via CKG (Code Knowledge Graph)
 * - Multi-round disambiguation with auto-questioning
 * - Spec validation and refinement
 * - History tracking for iterative improvement
 *
 * @module ai-engine/cowork/spec-translator
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const SPEC_STATUS = {
  DRAFT: "draft",
  TRANSLATING: "translating",
  AMBIGUOUS: "ambiguous",
  VALIDATED: "validated",
  GENERATING: "generating",
  VERIFYING: "verifying",
  COMPLETED: "completed",
  FAILED: "failed",
};

const INTENT_TYPES = {
  CREATE_COMPONENT: "create-component",
  ADD_FEATURE: "add-feature",
  FIX_BUG: "fix-bug",
  REFACTOR: "refactor",
  ADD_API: "add-api",
  ADD_TEST: "add-test",
  UPDATE_STYLE: "update-style",
  CONFIGURE: "configure",
  GENERAL: "general",
};

const INTENT_KEYWORDS = {
  [INTENT_TYPES.CREATE_COMPONENT]: [
    "创建",
    "新建",
    "实现",
    "添加",
    "开发",
    "create",
    "new",
    "implement",
    "build",
    "add",
    "组件",
    "页面",
    "视图",
    "component",
    "page",
    "view",
  ],
  [INTENT_TYPES.ADD_FEATURE]: [
    "功能",
    "特性",
    "支持",
    "feature",
    "capability",
    "增加",
    "扩展",
    "extend",
    "enhance",
  ],
  [INTENT_TYPES.FIX_BUG]: [
    "修复",
    "修改",
    "解决",
    "fix",
    "bug",
    "error",
    "问题",
    "异常",
    "报错",
    "issue",
    "problem",
  ],
  [INTENT_TYPES.REFACTOR]: [
    "重构",
    "优化",
    "改进",
    "refactor",
    "optimize",
    "整理",
    "清理",
    "simplify",
    "clean",
  ],
  [INTENT_TYPES.ADD_API]: [
    "API",
    "接口",
    "端点",
    "endpoint",
    "route",
    "REST",
    "GraphQL",
    "IPC",
    "handler",
  ],
  [INTENT_TYPES.ADD_TEST]: [
    "测试",
    "test",
    "spec",
    "单元测试",
    "集成测试",
    "unit test",
    "integration test",
    "e2e",
  ],
  [INTENT_TYPES.UPDATE_STYLE]: [
    "样式",
    "CSS",
    "主题",
    "style",
    "theme",
    "布局",
    "layout",
    "UI",
    "界面",
  ],
  [INTENT_TYPES.CONFIGURE]: [
    "配置",
    "设置",
    "config",
    "setting",
    "环境",
    "参数",
    "environment",
  ],
};

const TECH_PATTERNS = {
  vue: /vue|组件|component|\.vue|pinia|composable/i,
  react: /react|jsx|tsx|hook|redux/i,
  electron: /electron|ipc|main process|renderer/i,
  node: /node|express|koa|fastify|server/i,
  database: /数据库|database|sql|sqlite|table|schema/i,
  api: /api|rest|graphql|endpoint|route/i,
  css: /css|scss|less|tailwind|style/i,
  test: /test|vitest|jest|mocha|cypress/i,
};

const DEFAULT_CONFIG = {
  maxRefineRounds: 5,
  ambiguityThreshold: 0.6,
  completenessThreshold: 0.7,
  historyLimit: 100,
  enableCKGContext: true,
  enableLLMEnhancement: true,
};

// ============================================================
// SpecTranslator Class
// ============================================================

class SpecTranslator extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this.ckg = null;
    this.llmService = null;
    this.instinctManager = null;
    this.config = { ...DEFAULT_CONFIG };
    this.stats = {
      totalTranslations: 0,
      successfulTranslations: 0,
      averageRefineRounds: 0,
      intentDistribution: {},
    };
  }

  /**
   * Initialize with database and dependencies
   * @param {Object} db - Database instance
   * @param {Object} deps - Dependencies
   * @param {Object} [deps.ckg] - Code Knowledge Graph instance
   * @param {Object} [deps.llmService] - LLM service instance
   * @param {Object} [deps.instinctManager] - Instinct manager instance
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    this.ckg = deps.ckg || null;
    this.llmService = deps.llmService || null;
    this.instinctManager = deps.instinctManager || null;

    logger.info("[SpecTranslator] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Translate natural language to Spec JSON
   * @param {string} description - NL requirement description
   * @param {Object} [options] - Translation options
   * @param {string} [options.directory] - Target directory context
   * @param {Object} [options.additionalContext] - Extra context
   * @returns {Object} Translation result with spec
   */
  async translate(description, options = {}) {
    if (!this.initialized) {
      throw new Error("SpecTranslator not initialized");
    }

    const specId = `spec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      // Step 1: Classify intent
      const intent = this._classifyIntent(description);

      // Step 2: Extract key entities from description
      const entities = this._extractEntities(description);

      // Step 3: Detect tech stack
      const techStack = this._detectTechStack(description);

      // Step 4: Get CKG context if available
      let ckgContext = null;
      if (this.config.enableCKGContext && this.ckg?.initialized) {
        ckgContext = this._getCKGContext(description, options.directory);
      }

      // Step 5: Get instinct patterns
      let instinctPatterns = null;
      if (this.instinctManager?.initialized) {
        instinctPatterns = this._getInstinctPatterns(intent, techStack);
      }

      // Step 6: Check for ambiguities
      const ambiguities = this._detectAmbiguities(
        description,
        intent,
        entities,
      );

      // Step 7: Build initial spec
      const spec = {
        id: specId,
        intent,
        description,
        entities,
        techStack,
        features: entities.features || [],
        dependencies: ckgContext?.dependencies || [],
        constraints: entities.constraints || [],
        acceptanceCriteria: this._extractAcceptanceCriteria(description),
        priority: this._inferPriority(description),
        complexity: this._estimateComplexity(description, entities),
        ckgContext: ckgContext
          ? { modules: ckgContext.modules, patterns: ckgContext.patterns }
          : null,
        instinctHints: instinctPatterns,
        directory: options.directory || null,
        ambiguities,
        completeness: 0,
        status: SPEC_STATUS.DRAFT,
      };

      // Step 8: Compute completeness score
      spec.completeness = this._computeCompletenessScore(spec);

      // Step 9: LLM enhancement if available
      if (this.config.enableLLMEnhancement && this.llmService) {
        await this._enhanceWithLLM(spec);
      }

      // Mark as ambiguous or validated
      if (
        ambiguities.length > 0 &&
        spec.completeness < this.config.ambiguityThreshold
      ) {
        spec.status = SPEC_STATUS.AMBIGUOUS;
      } else if (spec.completeness >= this.config.completenessThreshold) {
        spec.status = SPEC_STATUS.VALIDATED;
      }

      // Persist
      this._saveSpec(spec);

      // Update stats
      this.stats.totalTranslations++;
      this.stats.intentDistribution[intent] =
        (this.stats.intentDistribution[intent] || 0) + 1;

      this.emit("spec:translated", {
        specId,
        intent,
        completeness: spec.completeness,
      });
      logger.info(
        `[SpecTranslator] Translated: ${specId} intent=${intent} completeness=${spec.completeness.toFixed(2)}`,
      );

      return spec;
    } catch (error) {
      logger.error(`[SpecTranslator] Translation error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate spec completeness
   * @param {Object} spec - Spec to validate
   * @returns {Object} Validation result
   */
  validateSpec(spec) {
    if (!spec) {
      return { valid: false, errors: ["Spec is null"] };
    }

    const errors = [];
    const warnings = [];

    if (!spec.description || spec.description.trim().length < 5) {
      errors.push("Description is too short or missing");
    }
    if (!spec.intent || spec.intent === INTENT_TYPES.GENERAL) {
      warnings.push("Intent could not be clearly identified");
    }
    if (!spec.features || spec.features.length === 0) {
      warnings.push(
        "No features extracted — consider refining the description",
      );
    }
    if (!spec.acceptanceCriteria || spec.acceptanceCriteria.length === 0) {
      warnings.push("No acceptance criteria detected");
    }
    if (spec.ambiguities && spec.ambiguities.length > 0) {
      warnings.push(`${spec.ambiguities.length} ambiguities detected`);
    }

    const completeness = this._computeCompletenessScore(spec);

    return {
      valid:
        errors.length === 0 &&
        completeness >= this.config.completenessThreshold,
      errors,
      warnings,
      completeness,
      suggestions: this._generateSuggestions(spec, errors, warnings),
    };
  }

  /**
   * Refine spec with additional information
   * @param {string} specId - Spec ID
   * @param {Object} refinements - Refinement data
   * @returns {Object} Updated spec
   */
  async refineSpec(specId, refinements = {}) {
    if (!this.initialized) {
      throw new Error("SpecTranslator not initialized");
    }

    const spec = this._getSpec(specId);
    if (!spec) {
      throw new Error(`Spec not found: ${specId}`);
    }

    if (spec.refine_count >= this.config.maxRefineRounds) {
      throw new Error(
        `Max refine rounds (${this.config.maxRefineRounds}) reached`,
      );
    }

    // Apply refinements
    if (refinements.description) {
      spec.description = `${spec.description}\n\n补充说明: ${refinements.description}`;
      const newEntities = this._extractEntities(refinements.description);
      spec.features = [
        ...new Set([...spec.features, ...(newEntities.features || [])]),
      ];
      spec.constraints = [
        ...new Set([...spec.constraints, ...(newEntities.constraints || [])]),
      ];
    }

    if (refinements.features) {
      spec.features = [...new Set([...spec.features, ...refinements.features])];
    }

    if (refinements.acceptanceCriteria) {
      spec.acceptanceCriteria = [
        ...spec.acceptanceCriteria,
        ...refinements.acceptanceCriteria,
      ];
    }

    if (refinements.techStack) {
      spec.techStack = { ...spec.techStack, ...refinements.techStack };
    }

    if (refinements.resolvedAmbiguities) {
      spec.ambiguities = spec.ambiguities.filter(
        (a) => !refinements.resolvedAmbiguities.includes(a.id),
      );
    }

    // Recompute completeness
    spec.completeness = this._computeCompletenessScore(spec);
    spec.refine_count = (spec.refine_count || 0) + 1;

    if (
      spec.completeness >= this.config.completenessThreshold &&
      spec.ambiguities.length === 0
    ) {
      spec.status = SPEC_STATUS.VALIDATED;
    }

    // Persist update
    this._updateSpec(spec);

    this.emit("spec:refined", {
      specId,
      completeness: spec.completeness,
      round: spec.refine_count,
    });
    logger.info(
      `[SpecTranslator] Refined: ${specId} round=${spec.refine_count} completeness=${spec.completeness.toFixed(2)}`,
    );

    return spec;
  }

  /**
   * Get translation history
   * @param {number} [limit] - Max entries
   * @returns {Array} Translation history
   */
  getHistory(limit) {
    if (!this.db) {
      return [];
    }
    const max = limit || this.config.historyLimit;
    try {
      const rows = this.db
        .prepare(
          `SELECT id, description, spec_json, status, refine_count, created_at, completed_at
           FROM nl_programs ORDER BY created_at DESC LIMIT ?`,
        )
        .all(max);
      return rows.map((r) => ({
        ...r,
        spec_json: JSON.parse(r.spec_json || "{}"),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get stats
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Get config
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update config
   */
  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Intent Classification
  // ============================================================

  _classifyIntent(description) {
    const lower = description.toLowerCase();
    const scores = {};

    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw.toLowerCase())) {
          score += kw.length > 3 ? 2 : 1;
        }
      }
      if (score > 0) {
        scores[intent] = score;
      }
    }

    if (Object.keys(scores).length === 0) {
      return INTENT_TYPES.GENERAL;
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return sorted[0][0];
  }

  // ============================================================
  // Entity Extraction
  // ============================================================

  _extractEntities(description) {
    const features = [];
    const constraints = [];
    const names = [];

    // Extract features from comma/、-separated lists
    const featurePatterns = [
      /(?:支持|包含|具有|包括|带有|需要|实现)[\s:：]*([^。.!！\n]+)/g,
      /(?:support|include|with|need|implement)[\s:]*([^.\n]+)/gi,
    ];

    for (const pattern of featurePatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const items = match[1].split(/[,，、和与及and]/);
        for (const item of items) {
          const trimmed = item.trim();
          if (trimmed.length > 1 && trimmed.length < 50) {
            features.push(trimmed);
          }
        }
      }
    }

    // Extract named entities (PascalCase, quoted strings)
    const namePatterns = [
      /[「」""]([^「」""]+)[「」""]/g,
      /(?:名为|叫做|named|called)\s+(\S+)/g,
      /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g,
    ];

    for (const pattern of namePatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        names.push(match[1].trim());
      }
    }

    // Extract constraints
    const constraintPatterns = [
      /(?:不(?:能|要|超过)|限制|最多|至少|必须|应该)([^。.!！\n]+)/g,
      /(?:must not|should not|at most|at least|must|should)([^.\n]+)/gi,
    ];

    for (const pattern of constraintPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        constraints.push(match[1].trim());
      }
    }

    return {
      features: [...new Set(features)],
      constraints: [...new Set(constraints)],
      names: [...new Set(names)],
    };
  }

  // ============================================================
  // Tech Stack Detection
  // ============================================================

  _detectTechStack(description) {
    const detected = {};
    for (const [tech, pattern] of Object.entries(TECH_PATTERNS)) {
      if (pattern.test(description)) {
        detected[tech] = true;
      }
    }
    return detected;
  }

  // ============================================================
  // CKG Context
  // ============================================================

  _getCKGContext(description, directory) {
    try {
      if (!this.ckg?.initialized) {
        return null;
      }

      const modules = [];
      const patterns = [];
      const dependencies = [];

      // Search CKG for related entities
      const entities = this.ckg.searchEntities
        ? this.ckg.searchEntities(description, { limit: 10 })
        : [];

      for (const entity of entities) {
        if (entity.type === "module" || entity.type === "class") {
          modules.push({
            name: entity.name,
            type: entity.type,
            path: entity.filePath,
          });
        }
        // Collect import relationships as dependencies
        if (entity.relationships) {
          for (const rel of entity.relationships) {
            if (rel.type === "imports" || rel.type === "depends_on") {
              dependencies.push(rel.target);
            }
          }
        }
      }

      // Get architecture patterns from CKG if available
      if (this.ckg.getHotspots) {
        const hotspots = this.ckg.getHotspots(5);
        for (const hs of hotspots) {
          patterns.push({
            name: hs.name,
            centrality: hs.centrality,
          });
        }
      }

      return { modules, patterns, dependencies: [...new Set(dependencies)] };
    } catch (error) {
      logger.warn(`[SpecTranslator] CKG context error: ${error.message}`);
      return null;
    }
  }

  // ============================================================
  // Instinct Patterns
  // ============================================================

  _getInstinctPatterns(intent, techStack) {
    try {
      if (!this.instinctManager?.initialized) {
        return null;
      }

      const categories = ["CODING_PATTERN", "STYLE", "ARCHITECTURE"];
      const patterns = [];

      for (const category of categories) {
        const instincts = this.instinctManager.getByCategory
          ? this.instinctManager.getByCategory(category, { limit: 3 })
          : [];
        for (const inst of instincts) {
          if (inst.confidence > 0.5) {
            patterns.push({
              category,
              pattern: inst.pattern,
              confidence: inst.confidence,
            });
          }
        }
      }

      return patterns.length > 0 ? patterns : null;
    } catch {
      return null;
    }
  }

  // ============================================================
  // Ambiguity Detection
  // ============================================================

  _detectAmbiguities(description, intent, entities) {
    const ambiguities = [];
    let id = 0;

    // Too short description
    if (description.length < 20) {
      ambiguities.push({
        id: `amb-${++id}`,
        type: "insufficient-detail",
        message: "描述过短，请提供更多细节",
        suggestion: "请描述具体的功能需求、输入输出、交互方式等",
      });
    }

    // No features detected
    if (!entities.features || entities.features.length === 0) {
      ambiguities.push({
        id: `amb-${++id}`,
        type: "no-features",
        message: "未检测到具体功能需求",
        suggestion: "请列出需要实现的具体功能，例如：'支持搜索、分页、排序'",
      });
    }

    // Vague intent
    if (intent === INTENT_TYPES.GENERAL) {
      ambiguities.push({
        id: `amb-${++id}`,
        type: "vague-intent",
        message: "无法明确识别开发意图",
        suggestion: "请说明是创建新组件、添加功能、修复问题还是重构代码",
      });
    }

    // Multiple possible tech stacks
    const techKeys = Object.keys(this._detectTechStack(description));
    if (techKeys.length === 0) {
      ambiguities.push({
        id: `amb-${++id}`,
        type: "unknown-tech",
        message: "未检测到技术栈信息",
        suggestion: "请指明使用的技术（如 Vue、React、Node.js 等）",
      });
    }

    return ambiguities;
  }

  // ============================================================
  // Acceptance Criteria Extraction
  // ============================================================

  _extractAcceptanceCriteria(description) {
    const criteria = [];

    const patterns = [
      /(?:验收标准|验收条件|AC)[：:\s]*([^。.!！\n]+)/g,
      /(?:应该|必须|需要能够)([^。.!！\n]{5,})/g,
      /(?:should|must|shall)\s+([^.\n]{5,})/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const criterion = match[1].trim();
        if (criterion.length > 3 && criterion.length < 200) {
          criteria.push(criterion);
        }
      }
    }

    return [...new Set(criteria)];
  }

  // ============================================================
  // Priority & Complexity Estimation
  // ============================================================

  _inferPriority(description) {
    const lower = description.toLowerCase();
    if (/紧急|urgent|critical|p0|asap|立即/.test(lower)) {
      return "critical";
    }
    if (/重要|important|high|p1|优先/.test(lower)) {
      return "high";
    }
    if (/低优先|low|p3|不急|可以以后/.test(lower)) {
      return "low";
    }
    return "medium";
  }

  _estimateComplexity(description, entities) {
    let score = 0;

    // Feature count
    const featureCount = entities.features?.length || 0;
    score += Math.min(featureCount * 0.15, 0.6);

    // Description length suggests complexity
    if (description.length > 500) {
      score += 0.2;
    } else if (description.length > 200) {
      score += 0.1;
    }

    // Constraint count
    score += Math.min((entities.constraints?.length || 0) * 0.1, 0.3);

    // Tech stack breadth
    const techCount = Object.keys(this._detectTechStack(description)).length;
    score += Math.min(techCount * 0.05, 0.2);

    const normalized = Math.min(score, 1);
    if (normalized > 0.7) {
      return "high";
    }
    if (normalized > 0.4) {
      return "medium";
    }
    return "low";
  }

  // ============================================================
  // Completeness Score
  // ============================================================

  _computeCompletenessScore(spec) {
    let score = 0;
    const weights = {
      description: 0.15,
      intent: 0.15,
      features: 0.2,
      techStack: 0.1,
      acceptanceCriteria: 0.15,
      constraints: 0.05,
      ckgContext: 0.1,
      noAmbiguities: 0.1,
    };

    if (spec.description && spec.description.length >= 10) {
      score += weights.description;
    }
    if (spec.intent && spec.intent !== INTENT_TYPES.GENERAL) {
      score += weights.intent;
    }
    if (spec.features && spec.features.length > 0) {
      score += weights.features * Math.min(spec.features.length / 3, 1);
    }
    if (spec.techStack && Object.keys(spec.techStack).length > 0) {
      score += weights.techStack;
    }
    if (spec.acceptanceCriteria && spec.acceptanceCriteria.length > 0) {
      score +=
        weights.acceptanceCriteria *
        Math.min(spec.acceptanceCriteria.length / 2, 1);
    }
    if (spec.constraints && spec.constraints.length > 0) {
      score += weights.constraints;
    }
    if (spec.ckgContext && spec.ckgContext.modules?.length > 0) {
      score += weights.ckgContext;
    }
    if (!spec.ambiguities || spec.ambiguities.length === 0) {
      score += weights.noAmbiguities;
    }

    return Math.round(score * 100) / 100;
  }

  // ============================================================
  // Suggestion Generation
  // ============================================================

  _generateSuggestions(spec, errors, warnings) {
    const suggestions = [];

    if (spec.ambiguities?.length > 0) {
      for (const amb of spec.ambiguities) {
        suggestions.push(amb.suggestion);
      }
    }

    if (!spec.features || spec.features.length === 0) {
      suggestions.push(
        "尝试列出具体的功能点，例如：'支持分页、支持按姓名搜索'",
      );
    }

    if (!spec.acceptanceCriteria || spec.acceptanceCriteria.length === 0) {
      suggestions.push("添加验收标准，例如：'用户应该能够通过关键词搜索结果'");
    }

    return suggestions;
  }

  // ============================================================
  // LLM Enhancement
  // ============================================================

  async _enhanceWithLLM(spec) {
    try {
      if (!this.llmService) {
        return;
      }

      const prompt = `Analyze this software requirement and enhance the spec:

Description: ${spec.description}
Intent: ${spec.intent}
Features: ${JSON.stringify(spec.features)}
Tech Stack: ${JSON.stringify(spec.techStack)}

Please provide:
1. Any missing features that should be considered
2. Suggested component/module names
3. Data model hints
4. Integration points with existing code

Respond in JSON format.`;

      const result = await this.llmService.query(prompt, {
        systemPrompt:
          "You are a requirement analysis assistant. Respond only in valid JSON.",
        temperature: 0.3,
      });

      if (result) {
        try {
          const enhanced =
            typeof result === "string" ? JSON.parse(result) : result;
          if (enhanced.additionalFeatures) {
            spec.features = [
              ...new Set([...spec.features, ...enhanced.additionalFeatures]),
            ];
          }
          if (enhanced.suggestedNames) {
            spec.entities = spec.entities || {};
            spec.entities.suggestedNames = enhanced.suggestedNames;
          }
          if (enhanced.dataModel) {
            spec.dataModel = enhanced.dataModel;
          }
          spec.llmEnhanced = true;
        } catch {
          // LLM response not valid JSON — skip
        }
      }
    } catch (error) {
      logger.warn(`[SpecTranslator] LLM enhancement failed: ${error.message}`);
    }
  }

  // ============================================================
  // Persistence
  // ============================================================

  _saveSpec(spec) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT INTO nl_programs (id, description, spec_json, status, refine_count, created_at)
           VALUES (?, ?, ?, ?, 0, datetime('now'))`,
        )
        .run(spec.id, spec.description, JSON.stringify(spec), spec.status);
    } catch (error) {
      logger.warn(`[SpecTranslator] Save error: ${error.message}`);
    }
  }

  _updateSpec(spec) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `UPDATE nl_programs SET spec_json = ?, status = ?, refine_count = ?
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(spec),
          spec.status,
          spec.refine_count || 0,
          spec.id,
        );
    } catch (error) {
      logger.warn(`[SpecTranslator] Update error: ${error.message}`);
    }
  }

  _getSpec(specId) {
    if (!this.db) {
      return null;
    }
    try {
      const row = this.db
        .prepare("SELECT spec_json FROM nl_programs WHERE id = ?")
        .get(specId);
      return row ? JSON.parse(row.spec_json) : null;
    } catch {
      return null;
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getSpecTranslator() {
  if (!instance) {
    instance = new SpecTranslator();
  }
  return instance;
}

module.exports = {
  SpecTranslator,
  getSpecTranslator,
  SPEC_STATUS,
  INTENT_TYPES,
};
