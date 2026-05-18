/**
 * Agent Capabilities - Capability definitions and tool sets per agent type
 *
 * Provides the mapping between capabilities and tools. Each agent type has a
 * defined set of capabilities, and each capability specifies which tools are
 * required or optional for its execution.
 *
 * Usage:
 *   const { AgentCapabilities, CAPABILITY_DEFINITIONS } = require('./agent-capabilities');
 *   const caps = AgentCapabilities.getCapabilitiesForType('security');
 *   const tools = AgentCapabilities.getToolsForCapabilities(['owasp_scanning', 'secret_detection']);
 *
 * @module ai-engine/agents/agent-capabilities
 */

const { logger } = require('../../utils/logger.js');

// ============================================================================
// Capability Definitions
// ============================================================================

/**
 * Map of capability name to its definition.
 * Each capability belongs to a category and declares required/optional tools.
 *
 * @type {Object.<string, {name: string, description: string, category: string, requiredTools: string[], optionalTools: string[]}>}
 */
const CAPABILITY_DEFINITIONS = {
  // ---- Security ----
  owasp_scanning: {
    name: 'OWASP Scanning',
    description: 'Scan code for OWASP Top 10 vulnerabilities',
    category: 'security',
    requiredTools: ['code_analyzer'],
    optionalTools: ['file_reader'],
  },
  secret_detection: {
    name: 'Secret Detection',
    description: 'Detect hardcoded secrets, API keys, passwords',
    category: 'security',
    requiredTools: ['secret_scanner'],
    optionalTools: ['file_reader'],
  },
  dependency_audit: {
    name: 'Dependency Audit',
    description: 'Audit project dependencies for known vulnerabilities',
    category: 'security',
    requiredTools: ['npm_audit'],
    optionalTools: ['file_reader', 'shell_executor'],
  },
  vulnerability_assessment: {
    name: 'Vulnerability Assessment',
    description: 'Comprehensive vulnerability assessment of the codebase',
    category: 'security',
    requiredTools: ['code_analyzer', 'secret_scanner'],
    optionalTools: ['npm_audit', 'file_reader'],
  },

  // ---- DevOps ----
  ci_cd_automation: {
    name: 'CI/CD Automation',
    description: 'Automate CI/CD pipeline configuration and management',
    category: 'devops',
    requiredTools: ['shell_executor', 'file_writer'],
    optionalTools: ['file_reader', 'docker_cli'],
  },
  docker_management: {
    name: 'Docker Management',
    description: 'Manage Docker containers, images, and compose configurations',
    category: 'devops',
    requiredTools: ['docker_cli'],
    optionalTools: ['shell_executor', 'file_reader', 'file_writer'],
  },
  deployment: {
    name: 'Deployment',
    description: 'Deploy applications to various environments',
    category: 'devops',
    requiredTools: ['shell_executor'],
    optionalTools: ['docker_cli', 'file_reader', 'file_writer'],
  },
  infrastructure: {
    name: 'Infrastructure',
    description: 'Manage infrastructure configuration and provisioning',
    category: 'devops',
    requiredTools: ['shell_executor', 'file_writer'],
    optionalTools: ['docker_cli', 'file_reader'],
  },

  // ---- Data ----
  data_processing: {
    name: 'Data Processing',
    description: 'Process, clean, and transform data sets',
    category: 'data',
    requiredTools: ['data_processor'],
    optionalTools: ['file_reader', 'file_writer', 'math_calculator'],
  },
  visualization: {
    name: 'Visualization',
    description: 'Generate charts, graphs, and visual representations of data',
    category: 'data',
    requiredTools: ['chart_generator'],
    optionalTools: ['data_processor', 'file_writer'],
  },
  statistics: {
    name: 'Statistics',
    description: 'Perform statistical analysis and computations',
    category: 'data',
    requiredTools: ['math_calculator', 'data_processor'],
    optionalTools: ['chart_generator', 'file_reader'],
  },
  csv_handling: {
    name: 'CSV Handling',
    description: 'Read, write, and manipulate CSV files',
    category: 'data',
    requiredTools: ['data_processor', 'file_reader'],
    optionalTools: ['file_writer', 'math_calculator'],
  },

  // ---- Documentation ----
  doc_generation: {
    name: 'Documentation Generation',
    description: 'Generate project documentation from source code',
    category: 'documentation',
    requiredTools: ['doc_generator'],
    optionalTools: ['jsdoc_parser', 'file_reader', 'file_writer'],
  },
  api_reference: {
    name: 'API Reference',
    description: 'Generate API reference documentation',
    category: 'documentation',
    requiredTools: ['doc_generator', 'jsdoc_parser'],
    optionalTools: ['file_reader', 'file_writer'],
  },
  readme_creation: {
    name: 'README Creation',
    description: 'Create and update project README files',
    category: 'documentation',
    requiredTools: ['doc_generator'],
    optionalTools: ['file_reader', 'file_writer'],
  },
  changelog: {
    name: 'Changelog',
    description: 'Generate and maintain changelogs from commit history',
    category: 'documentation',
    requiredTools: ['doc_generator'],
    optionalTools: ['shell_executor', 'file_reader', 'file_writer'],
  },

  // ---- Testing ----
  unit_test_generation: {
    name: 'Unit Test Generation',
    description: 'Generate unit test cases for source code',
    category: 'testing',
    requiredTools: ['test_writer'],
    optionalTools: ['code_analyzer', 'file_reader', 'file_writer'],
  },
  integration_test: {
    name: 'Integration Test',
    description: 'Generate integration test suites',
    category: 'testing',
    requiredTools: ['test_writer'],
    optionalTools: ['code_analyzer', 'shell_executor', 'file_reader'],
  },
  test_coverage: {
    name: 'Test Coverage',
    description: 'Analyze and report test coverage metrics',
    category: 'testing',
    requiredTools: ['coverage_checker'],
    optionalTools: ['test_writer', 'shell_executor', 'file_reader'],
  },
  mock_creation: {
    name: 'Mock Creation',
    description: 'Create test mocks, stubs, and fixtures',
    category: 'testing',
    requiredTools: ['test_writer'],
    optionalTools: ['code_analyzer', 'file_reader', 'file_writer'],
  },

  // ---- Architecture ----
  system_design: {
    name: 'System Design',
    description: 'Design system architecture and component relationships',
    category: 'architecture',
    requiredTools: ['dependency_graph', 'diagram_generator'],
    optionalTools: ['code_analyzer', 'file_reader'],
  },
  pattern_analysis: {
    name: 'Pattern Analysis',
    description: 'Analyze code patterns and suggest architectural improvements',
    category: 'architecture',
    requiredTools: ['code_analyzer', 'dependency_graph'],
    optionalTools: ['diagram_generator', 'file_reader'],
  },
  dependency_management: {
    name: 'Dependency Management',
    description: 'Analyze and optimize project dependency structure',
    category: 'architecture',
    requiredTools: ['dependency_graph'],
    optionalTools: ['npm_audit', 'file_reader', 'code_analyzer'],
  },
  api_design: {
    name: 'API Design',
    description: 'Design and document API interfaces',
    category: 'architecture',
    requiredTools: ['doc_generator', 'diagram_generator'],
    optionalTools: ['code_analyzer', 'file_reader', 'file_writer'],
  },

  // ---- Performance ----
  profiling: {
    name: 'Profiling',
    description: 'Profile application performance and identify bottlenecks',
    category: 'performance',
    requiredTools: ['profiler'],
    optionalTools: ['code_analyzer', 'benchmark_runner'],
  },
  optimization: {
    name: 'Optimization',
    description: 'Optimize code for better performance',
    category: 'performance',
    requiredTools: ['profiler', 'code_analyzer'],
    optionalTools: ['benchmark_runner', 'file_reader', 'file_writer'],
  },
  benchmarking: {
    name: 'Benchmarking',
    description: 'Run benchmarks and compare performance metrics',
    category: 'performance',
    requiredTools: ['benchmark_runner'],
    optionalTools: ['profiler', 'chart_generator', 'file_writer'],
  },
  memory_analysis: {
    name: 'Memory Analysis',
    description: 'Analyze memory usage patterns and detect leaks',
    category: 'performance',
    requiredTools: ['profiler'],
    optionalTools: ['code_analyzer', 'chart_generator'],
  },

  // ---- Compliance ----
  gdpr_compliance: {
    name: 'GDPR Compliance',
    description: 'Check code and data handling for GDPR compliance',
    category: 'compliance',
    requiredTools: ['compliance_checker'],
    optionalTools: ['code_analyzer', 'file_reader', 'policy_validator'],
  },
  owasp_compliance: {
    name: 'OWASP Compliance',
    description: 'Verify adherence to OWASP security standards',
    category: 'compliance',
    requiredTools: ['compliance_checker', 'code_analyzer'],
    optionalTools: ['secret_scanner', 'policy_validator'],
  },
  license_check: {
    name: 'License Check',
    description: 'Check project dependencies for license compliance',
    category: 'compliance',
    requiredTools: ['compliance_checker'],
    optionalTools: ['npm_audit', 'file_reader'],
  },
  policy_validation: {
    name: 'Policy Validation',
    description: 'Validate project policies and configuration rules',
    category: 'compliance',
    requiredTools: ['policy_validator'],
    optionalTools: ['compliance_checker', 'file_reader'],
  },
};

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Map of tool name to its definition.
 * Tools are the atomic units that capabilities compose together.
 *
 * @type {Object.<string, {name: string, description: string, category: string}>}
 */
const TOOL_DEFINITIONS = {
  code_analyzer: {
    name: 'Code Analyzer',
    description: 'Analyze source code structure and patterns',
    category: 'analysis',
  },
  secret_scanner: {
    name: 'Secret Scanner',
    description: 'Scan for hardcoded secrets',
    category: 'security',
  },
  npm_audit: {
    name: 'NPM Audit',
    description: 'Audit npm dependencies',
    category: 'security',
  },
  file_reader: {
    name: 'File Reader',
    description: 'Read file contents',
    category: 'io',
  },
  file_writer: {
    name: 'File Writer',
    description: 'Write file contents',
    category: 'io',
  },
  shell_executor: {
    name: 'Shell Executor',
    description: 'Execute shell commands',
    category: 'system',
  },
  docker_cli: {
    name: 'Docker CLI',
    description: 'Docker container management',
    category: 'devops',
  },
  data_processor: {
    name: 'Data Processor',
    description: 'Process and transform data',
    category: 'data',
  },
  chart_generator: {
    name: 'Chart Generator',
    description: 'Generate charts and visualizations',
    category: 'visualization',
  },
  math_calculator: {
    name: 'Math Calculator',
    description: 'Mathematical computations',
    category: 'data',
  },
  doc_generator: {
    name: 'Doc Generator',
    description: 'Generate documentation',
    category: 'documentation',
  },
  jsdoc_parser: {
    name: 'JSDoc Parser',
    description: 'Parse JSDoc comments',
    category: 'documentation',
  },
  test_writer: {
    name: 'Test Writer',
    description: 'Write test cases',
    category: 'testing',
  },
  coverage_checker: {
    name: 'Coverage Checker',
    description: 'Check test coverage',
    category: 'testing',
  },
  dependency_graph: {
    name: 'Dependency Graph',
    description: 'Analyze dependency relationships',
    category: 'analysis',
  },
  diagram_generator: {
    name: 'Diagram Generator',
    description: 'Generate diagrams',
    category: 'visualization',
  },
  profiler: {
    name: 'Profiler',
    description: 'Profile code performance',
    category: 'performance',
  },
  benchmark_runner: {
    name: 'Benchmark Runner',
    description: 'Run benchmarks',
    category: 'performance',
  },
  compliance_checker: {
    name: 'Compliance Checker',
    description: 'Check compliance rules',
    category: 'compliance',
  },
  policy_validator: {
    name: 'Policy Validator',
    description: 'Validate policies',
    category: 'compliance',
  },
};

// ============================================================================
// Agent Type to Capabilities Mapping
// ============================================================================

/**
 * Maps each agent type to its set of capabilities.
 * Agent types correspond to specialized roles in the multi-agent system.
 *
 * @type {Object.<string, {description: string, capabilities: string[], priority: number}>}
 */
const AGENT_TYPE_CAPABILITIES = {
  security: {
    description: 'Security analysis and vulnerability detection',
    capabilities: [
      'owasp_scanning',
      'secret_detection',
      'dependency_audit',
      'vulnerability_assessment',
    ],
    priority: 10,
  },
  devops: {
    description: 'CI/CD, Docker, deployment, and infrastructure management',
    capabilities: [
      'ci_cd_automation',
      'docker_management',
      'deployment',
      'infrastructure',
    ],
    priority: 8,
  },
  'data-analysis': {
    description: 'Data processing, visualization, and statistical analysis',
    capabilities: [
      'data_processing',
      'visualization',
      'statistics',
      'csv_handling',
    ],
    priority: 8,
  },
  document: {
    description: 'Documentation generation, API references, and changelogs',
    capabilities: [
      'doc_generation',
      'api_reference',
      'readme_creation',
      'changelog',
    ],
    priority: 7,
  },
  testing: {
    description: 'Test generation, coverage analysis, and mock creation',
    capabilities: [
      'unit_test_generation',
      'integration_test',
      'test_coverage',
      'mock_creation',
    ],
    priority: 9,
  },
  'code-generation': {
    description: 'Code generation, architecture design, and pattern analysis',
    capabilities: [
      'system_design',
      'pattern_analysis',
      'dependency_management',
      'api_design',
    ],
    priority: 10,
  },
  performance: {
    description: 'Profiling, optimization, benchmarking, and memory analysis',
    capabilities: [
      'profiling',
      'optimization',
      'benchmarking',
      'memory_analysis',
    ],
    priority: 7,
  },
  compliance: {
    description: 'Regulatory compliance, license checking, and policy validation',
    capabilities: [
      'gdpr_compliance',
      'owasp_compliance',
      'license_check',
      'policy_validation',
    ],
    priority: 6,
  },
};

// ============================================================================
// AgentCapabilities Class
// ============================================================================

/**
 * AgentCapabilities provides helper methods for querying and matching
 * agent capabilities against required tool sets.
 */
class AgentCapabilities {
  /**
   * Get all capabilities for a given agent type.
   *
   * @param {string} agentType - The agent type key (e.g., 'security', 'devops')
   * @returns {Object[]|null} Array of capability definitions, or null if type not found
   */
  static getCapabilitiesForType(agentType) {
    const agentConfig = AGENT_TYPE_CAPABILITIES[agentType];
    if (!agentConfig) {
      logger.warn(`[AgentCapabilities] Unknown agent type: ${agentType}`);
      return null;
    }

    const capabilities = [];
    for (const capName of agentConfig.capabilities) {
      const capDef = CAPABILITY_DEFINITIONS[capName];
      if (capDef) {
        capabilities.push({
          id: capName,
          ...capDef,
        });
      } else {
        logger.warn(`[AgentCapabilities] Capability not found: ${capName}`);
      }
    }

    return capabilities;
  }

  /**
   * Get all tools (required + optional, deduplicated) for a list of capabilities.
   *
   * @param {string[]} capabilities - Array of capability names
   * @returns {{required: Object[], optional: Object[], all: Object[]}} Tool sets
   */
  static getToolsForCapabilities(capabilities) {
    const requiredSet = new Set();
    const optionalSet = new Set();

    for (const capName of capabilities) {
      const capDef = CAPABILITY_DEFINITIONS[capName];
      if (!capDef) {
        logger.warn(`[AgentCapabilities] Capability not found when resolving tools: ${capName}`);
        continue;
      }

      for (const tool of capDef.requiredTools) {
        requiredSet.add(tool);
      }
      for (const tool of (capDef.optionalTools || [])) {
        optionalSet.add(tool);
      }
    }

    // Remove any tool from optional that is already required
    for (const tool of requiredSet) {
      optionalSet.delete(tool);
    }

    const resolveTools = (toolNames) => {
      return Array.from(toolNames).map((name) => {
        const def = TOOL_DEFINITIONS[name];
        return def
          ? { id: name, ...def }
          : { id: name, name, description: 'Unknown tool', category: 'unknown' };
      });
    };

    const required = resolveTools(requiredSet);
    const optional = resolveTools(optionalSet);

    return {
      required,
      optional,
      all: [...required, ...optional],
    };
  }

  /**
   * Score how well a set of available capabilities matches a set of required capabilities.
   *
   * Returns a score between 0 and 1:
   *   - 1.0 means all required capabilities are available
   *   - 0.0 means no overlap at all
   *   - Partial matches (substring containment) contribute half weight
   *
   * @param {string[]} required - Capability names that are needed
   * @param {string[]} available - Capability names that are offered
   * @returns {number} Match score between 0 and 1
   */
  static matchCapabilities(required, available) {
    if (!required || required.length === 0) {
      return 1.0;
    }
    if (!available || available.length === 0) {
      return 0.0;
    }

    const availableSet = new Set(available);
    let totalScore = 0;

    for (const reqCap of required) {
      // Exact match
      if (availableSet.has(reqCap)) {
        totalScore += 1.0;
        continue;
      }

      // Partial match: check if any available capability contains or is contained
      // by the required capability name (substring matching)
      let bestPartial = 0;
      for (const avCap of available) {
        if (reqCap.includes(avCap) || avCap.includes(reqCap)) {
          bestPartial = Math.max(bestPartial, 0.5);
        }
      }

      // Category-level match: same category counts for a smaller partial score
      if (bestPartial === 0) {
        const reqDef = CAPABILITY_DEFINITIONS[reqCap];
        if (reqDef) {
          for (const avCap of available) {
            const avDef = CAPABILITY_DEFINITIONS[avCap];
            if (avDef && avDef.category === reqDef.category) {
              bestPartial = Math.max(bestPartial, 0.25);
            }
          }
        }
      }

      totalScore += bestPartial;
    }

    return Math.min(1.0, totalScore / required.length);
  }

  /**
   * Find the best agent type for a given set of required capabilities.
   *
   * Evaluates each agent type's capabilities against the required list and
   * returns the one with the highest match score. Ties are broken by priority.
   *
   * @param {string[]} requiredCapabilities - Capabilities that need to be fulfilled
   * @returns {{agentType: string, score: number, priority: number}|null} Best match or null
   */
  static findBestAgentType(requiredCapabilities) {
    if (!requiredCapabilities || requiredCapabilities.length === 0) {
      logger.warn('[AgentCapabilities] No required capabilities provided');
      return null;
    }

    let bestMatch = null;
    let bestScore = 0;
    let bestPriority = -1;

    for (const [agentType, config] of Object.entries(AGENT_TYPE_CAPABILITIES)) {
      const score = AgentCapabilities.matchCapabilities(
        requiredCapabilities,
        config.capabilities
      );

      if (score > bestScore || (score === bestScore && config.priority > bestPriority)) {
        bestScore = score;
        bestPriority = config.priority;
        bestMatch = {
          agentType,
          score,
          priority: config.priority,
          description: config.description,
          capabilities: config.capabilities,
        };
      }
    }

    if (bestMatch && bestMatch.score > 0) {
      logger.debug(
        `[AgentCapabilities] Best agent type for [${requiredCapabilities.join(', ')}]: ` +
        `${bestMatch.agentType} (score: ${bestMatch.score.toFixed(2)}, priority: ${bestMatch.priority})`
      );
      return bestMatch;
    }

    logger.warn(
      `[AgentCapabilities] No matching agent type found for: [${requiredCapabilities.join(', ')}]`
    );
    return null;
  }

  /**
   * Get all capability categories.
   *
   * @returns {string[]} Sorted list of unique category names
   */
  static getCategories() {
    const categories = new Set();
    for (const capDef of Object.values(CAPABILITY_DEFINITIONS)) {
      categories.add(capDef.category);
    }
    return Array.from(categories).sort();
  }

  /**
   * Get all capabilities belonging to a specific category.
   *
   * @param {string} category - The category to filter by
   * @returns {Object[]} Array of capability definitions with their ids
   */
  static getCapabilitiesByCategory(category) {
    const results = [];
    for (const [capName, capDef] of Object.entries(CAPABILITY_DEFINITIONS)) {
      if (capDef.category === category) {
        results.push({
          id: capName,
          ...capDef,
        });
      }
    }
    return results;
  }

  /**
   * Get all registered agent types and their configurations.
   *
   * @returns {Object[]} Array of agent type info objects
   */
  static getAgentTypes() {
    return Object.entries(AGENT_TYPE_CAPABILITIES).map(([type, config]) => ({
      type,
      ...config,
    }));
  }

  /**
   * Get a single capability definition by name.
   *
   * @param {string} capabilityName - The capability identifier
   * @returns {Object|null} The capability definition or null
   */
  static getCapability(capabilityName) {
    const def = CAPABILITY_DEFINITIONS[capabilityName];
    if (!def) {
      return null;
    }
    return { id: capabilityName, ...def };
  }

  /**
   * Get a single tool definition by name.
   *
   * @param {string} toolName - The tool identifier
   * @returns {Object|null} The tool definition or null
   */
  static getTool(toolName) {
    const def = TOOL_DEFINITIONS[toolName];
    if (!def) {
      return null;
    }
    return { id: toolName, ...def };
  }

  /**
   * Get all tools grouped by category.
   *
   * @returns {Object.<string, Object[]>} Map of category to tool definitions
   */
  static getToolsByCategory() {
    const grouped = {};
    for (const [toolName, toolDef] of Object.entries(TOOL_DEFINITIONS)) {
      const cat = toolDef.category;
      if (!grouped[cat]) {
        grouped[cat] = [];
      }
      grouped[cat].push({ id: toolName, ...toolDef });
    }
    return grouped;
  }

  /**
   * Validate that all capabilities referenced by agent types exist in CAPABILITY_DEFINITIONS
   * and all tools referenced by capabilities exist in TOOL_DEFINITIONS.
   *
   * Useful for startup health checks.
   *
   * @returns {{valid: boolean, errors: string[]}} Validation result
   */
  static validate() {
    const errors = [];

    // Check agent type capabilities exist
    for (const [agentType, config] of Object.entries(AGENT_TYPE_CAPABILITIES)) {
      for (const capName of config.capabilities) {
        if (!CAPABILITY_DEFINITIONS[capName]) {
          errors.push(`Agent type "${agentType}" references undefined capability: "${capName}"`);
        }
      }
    }

    // Check capability tools exist
    for (const [capName, capDef] of Object.entries(CAPABILITY_DEFINITIONS)) {
      for (const toolName of capDef.requiredTools) {
        if (!TOOL_DEFINITIONS[toolName]) {
          errors.push(`Capability "${capName}" references undefined required tool: "${toolName}"`);
        }
      }
      for (const toolName of (capDef.optionalTools || [])) {
        if (!TOOL_DEFINITIONS[toolName]) {
          errors.push(`Capability "${capName}" references undefined optional tool: "${toolName}"`);
        }
      }
    }

    if (errors.length > 0) {
      logger.error('[AgentCapabilities] Validation failed:', errors);
    } else {
      logger.debug('[AgentCapabilities] Validation passed');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Export a summary of all definitions for debugging or documentation.
   *
   * @returns {Object} Complete summary of capabilities, tools, and agent types
   */
  static exportSummary() {
    return {
      capabilities: Object.entries(CAPABILITY_DEFINITIONS).map(([id, def]) => ({
        id,
        ...def,
      })),
      tools: Object.entries(TOOL_DEFINITIONS).map(([id, def]) => ({
        id,
        ...def,
      })),
      agentTypes: AgentCapabilities.getAgentTypes(),
      categories: AgentCapabilities.getCategories(),
      stats: {
        totalCapabilities: Object.keys(CAPABILITY_DEFINITIONS).length,
        totalTools: Object.keys(TOOL_DEFINITIONS).length,
        totalAgentTypes: Object.keys(AGENT_TYPE_CAPABILITIES).length,
        totalCategories: AgentCapabilities.getCategories().length,
      },
    };
  }
}

module.exports = {
  AgentCapabilities,
  CAPABILITY_DEFINITIONS,
  TOOL_DEFINITIONS,
  AGENT_TYPE_CAPABILITIES,
};
