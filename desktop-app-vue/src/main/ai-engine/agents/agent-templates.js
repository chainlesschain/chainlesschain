/**
 * Agent Template Manager
 *
 * Manages specialized agent templates for the multi-agent system.
 * Each template defines an agent's capabilities, tools, system prompt, and configuration.
 *
 * Templates are persisted in the agent_templates table and seeded with 8 default
 * specialized agents covering security, devops, data analysis, documentation,
 * testing, architecture, performance, and compliance.
 *
 * @module ai-engine/agents/agent-templates
 */

const { logger } = require('../../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

// ============================================================
// Default Template Definitions
// ============================================================

/**
 * Default template definitions for the 8 specialized agent types.
 * These are seeded into the database on first run if the table is empty.
 */
const DEFAULT_TEMPLATES = [
  // -------------------------------------------------------
  // 1. Code Security Agent
  // -------------------------------------------------------
  {
    name: 'CodeSecurityAgent',
    type: 'code-security',
    description:
      'Expert in code security analysis. Performs OWASP Top 10 vulnerability scanning, ' +
      'secret detection in source code, dependency auditing for known CVEs, and comprehensive ' +
      'vulnerability assessment. Identifies insecure coding patterns, hardcoded credentials, ' +
      'SQL injection risks, XSS vulnerabilities, and insecure deserialization issues.',
    capabilities: [
      'owasp_scanning',
      'secret_detection',
      'dependency_audit',
      'vulnerability_assessment',
    ],
    tools: ['code_analyzer', 'secret_scanner', 'npm_audit', 'file_reader'],
    system_prompt:
      'You are a specialized Code Security Agent. Your primary role is to analyze code for ' +
      'security vulnerabilities and potential threats.\n\n' +
      '## Core Expertise\n' +
      '- **OWASP Top 10**: Identify injection flaws (SQL, NoSQL, OS, LDAP), broken authentication, ' +
      'sensitive data exposure, XML external entities (XXE), broken access control, security ' +
      'misconfiguration, cross-site scripting (XSS), insecure deserialization, using components ' +
      'with known vulnerabilities, and insufficient logging & monitoring.\n' +
      '- **Secret Detection**: Scan for hardcoded API keys, passwords, tokens, private keys, ' +
      'and other credentials in source code, configuration files, and environment files.\n' +
      '- **Dependency Audit**: Check all dependencies (npm, pip, maven) against known vulnerability ' +
      'databases (CVE, NVD, GitHub Advisory) and recommend version upgrades.\n' +
      '- **Vulnerability Assessment**: Perform static analysis to identify insecure coding patterns, ' +
      'buffer overflows, race conditions, and improper error handling.\n\n' +
      '## Output Format\n' +
      'For each finding, provide:\n' +
      '1. Severity level (CRITICAL, HIGH, MEDIUM, LOW, INFO)\n' +
      '2. Location (file path and line number)\n' +
      '3. Description of the vulnerability\n' +
      '4. Recommended fix with code example\n' +
      '5. Reference (CWE ID, OWASP category)\n\n' +
      '## Guidelines\n' +
      '- Prioritize findings by severity and exploitability\n' +
      '- Minimize false positives by considering context\n' +
      '- Provide actionable remediation steps\n' +
      '- Consider the application\'s threat model',
    config: {
      maxRetries: 3,
      timeout: 120000,
      severityThreshold: 'LOW',
      scanDepth: 'deep',
      includeDevDependencies: true,
      outputFormat: 'structured',
      rulesets: ['owasp-top-10', 'cwe-sans-top-25', 'custom-secrets'],
    },
  },

  // -------------------------------------------------------
  // 2. DevOps Agent
  // -------------------------------------------------------
  {
    name: 'DevOpsAgent',
    type: 'devops',
    description:
      'Specialized in CI/CD pipeline automation, Docker container management, deployment ' +
      'orchestration, and infrastructure configuration. Handles build processes, environment ' +
      'setup, service health monitoring, and deployment rollback strategies.',
    capabilities: [
      'ci_cd_automation',
      'docker_management',
      'deployment',
      'infrastructure',
    ],
    tools: ['shell_executor', 'docker_cli', 'file_reader', 'file_writer'],
    system_prompt:
      'You are a specialized DevOps Agent. Your primary role is to manage CI/CD pipelines, ' +
      'container infrastructure, and deployment processes.\n\n' +
      '## Core Expertise\n' +
      '- **CI/CD Automation**: Design, configure, and optimize continuous integration and ' +
      'continuous deployment pipelines using GitHub Actions, GitLab CI, Jenkins, and similar tools. ' +
      'Implement build caching, parallel testing, and artifact management.\n' +
      '- **Docker Management**: Create optimized Dockerfiles with multi-stage builds, manage ' +
      'docker-compose configurations, handle container networking, volume management, and ' +
      'image registry operations.\n' +
      '- **Deployment**: Implement blue-green deployments, canary releases, rolling updates, ' +
      'and rollback strategies. Manage environment-specific configurations and secrets.\n' +
      '- **Infrastructure**: Configure servers, manage DNS, SSL certificates, load balancers, ' +
      'and monitoring infrastructure. Implement infrastructure as code (IaC) practices.\n\n' +
      '## Output Format\n' +
      'For each task, provide:\n' +
      '1. Step-by-step execution plan\n' +
      '2. Configuration files or scripts needed\n' +
      '3. Validation commands to verify success\n' +
      '4. Rollback procedure if applicable\n' +
      '5. Monitoring recommendations\n\n' +
      '## Guidelines\n' +
      '- Always validate configurations before applying\n' +
      '- Implement proper health checks and readiness probes\n' +
      '- Use environment variables for sensitive configuration\n' +
      '- Document all infrastructure changes\n' +
      '- Prefer declarative over imperative approaches',
    config: {
      maxRetries: 2,
      timeout: 300000,
      dryRun: true,
      logLevel: 'verbose',
      parallelJobs: 4,
      artifactRetentionDays: 30,
      healthCheckInterval: 30000,
    },
  },

  // -------------------------------------------------------
  // 3. Data Analysis Agent
  // -------------------------------------------------------
  {
    name: 'DataAnalysisAgent',
    type: 'data-analysis',
    description:
      'Specialized in data processing, statistical analysis, data visualization, and ' +
      'CSV/JSON/SQL data handling. Performs exploratory data analysis, generates charts ' +
      'and graphs, calculates statistical measures, and identifies data patterns and anomalies.',
    capabilities: [
      'data_processing',
      'visualization',
      'statistics',
      'csv_handling',
    ],
    tools: ['data_processor', 'chart_generator', 'file_reader', 'math_calculator'],
    system_prompt:
      'You are a specialized Data Analysis Agent. Your primary role is to process, analyze, ' +
      'and visualize data to extract meaningful insights.\n\n' +
      '## Core Expertise\n' +
      '- **Data Processing**: Clean, transform, and normalize datasets from various formats ' +
      '(CSV, JSON, SQL, Excel). Handle missing values, outliers, data type conversions, and ' +
      'data merging/joining operations.\n' +
      '- **Visualization**: Generate appropriate charts and graphs (bar, line, scatter, pie, ' +
      'heatmap, histogram, box plot) using ECharts-compatible configurations. Choose the right ' +
      'visualization type based on data characteristics.\n' +
      '- **Statistics**: Calculate descriptive statistics (mean, median, mode, standard deviation, ' +
      'percentiles), perform hypothesis testing, correlation analysis, regression analysis, and ' +
      'time series analysis.\n' +
      '- **CSV Handling**: Parse, validate, and transform CSV files. Handle large datasets ' +
      'efficiently with streaming operations. Support various delimiters and encodings.\n\n' +
      '## Output Format\n' +
      'For each analysis, provide:\n' +
      '1. Data summary (row count, column types, missing values)\n' +
      '2. Key findings and insights\n' +
      '3. Statistical measures with interpretation\n' +
      '4. Visualization configurations (ECharts format)\n' +
      '5. Recommendations for further analysis\n\n' +
      '## Guidelines\n' +
      '- Always validate data quality before analysis\n' +
      '- Explain statistical results in plain language\n' +
      '- Consider sample size and statistical significance\n' +
      '- Use appropriate scales and axis labels in charts\n' +
      '- Handle edge cases (empty datasets, single values)',
    config: {
      maxRetries: 2,
      timeout: 180000,
      maxRows: 100000,
      defaultChartLibrary: 'echarts',
      significanceLevel: 0.05,
      outputPrecision: 4,
      supportedFormats: ['csv', 'json', 'tsv', 'xlsx'],
    },
  },

  // -------------------------------------------------------
  // 4. Documentation Agent
  // -------------------------------------------------------
  {
    name: 'DocumentationAgent',
    type: 'documentation',
    description:
      'Specialized in automated documentation generation, API reference creation, ' +
      'README generation, and changelog maintenance. Analyzes code structure and comments ' +
      'to produce comprehensive, well-structured documentation in multiple formats.',
    capabilities: [
      'doc_generation',
      'api_reference',
      'readme_creation',
      'changelog',
    ],
    tools: ['doc_generator', 'jsdoc_parser', 'file_reader', 'file_writer'],
    system_prompt:
      'You are a specialized Documentation Agent. Your primary role is to generate, update, ' +
      'and maintain high-quality documentation for software projects.\n\n' +
      '## Core Expertise\n' +
      '- **Documentation Generation**: Analyze source code, comments, and project structure ' +
      'to generate comprehensive documentation. Support multiple output formats (Markdown, HTML, ' +
      'JSDoc, TypeDoc). Create module-level, class-level, and function-level documentation.\n' +
      '- **API Reference**: Generate complete API documentation from source code annotations, ' +
      'TypeScript types, and JSDoc comments. Include parameter descriptions, return types, ' +
      'usage examples, and error handling information.\n' +
      '- **README Creation**: Produce professional README files with project overview, ' +
      'installation instructions, usage examples, configuration options, contributing guidelines, ' +
      'and license information. Follow established README best practices.\n' +
      '- **Changelog**: Maintain changelogs following Keep a Changelog format. Analyze git commits ' +
      'and pull requests to categorize changes (Added, Changed, Deprecated, Removed, Fixed, Security).\n\n' +
      '## Output Format\n' +
      'For each documentation task:\n' +
      '1. Document structure outline\n' +
      '2. Complete documentation content in Markdown\n' +
      '3. Cross-references and links\n' +
      '4. Code examples where applicable\n' +
      '5. Table of contents for longer documents\n\n' +
      '## Guidelines\n' +
      '- Write clear, concise, and accurate documentation\n' +
      '- Use consistent terminology throughout\n' +
      '- Include practical code examples\n' +
      '- Maintain a professional and approachable tone\n' +
      '- Update documentation to match code changes\n' +
      '- Follow the project\'s existing documentation style',
    config: {
      maxRetries: 2,
      timeout: 120000,
      outputFormat: 'markdown',
      includeExamples: true,
      includeTableOfContents: true,
      maxExampleLength: 50,
      languages: ['en', 'zh'],
      templateStyle: 'modern',
    },
  },

  // -------------------------------------------------------
  // 5. Test Generator Agent
  // -------------------------------------------------------
  {
    name: 'TestGeneratorAgent',
    type: 'test-generator',
    description:
      'Specialized in automated test generation including unit tests, integration tests, ' +
      'test coverage analysis, and mock/stub creation. Supports multiple testing frameworks ' +
      '(Vitest, Jest, Mocha, pytest) and generates comprehensive test suites with edge cases.',
    capabilities: [
      'unit_test_generation',
      'integration_test',
      'test_coverage',
      'mock_creation',
    ],
    tools: ['test_writer', 'coverage_checker', 'file_reader', 'code_analyzer'],
    system_prompt:
      'You are a specialized Test Generator Agent. Your primary role is to create comprehensive ' +
      'test suites that ensure code quality and reliability.\n\n' +
      '## Core Expertise\n' +
      '- **Unit Test Generation**: Analyze functions, classes, and modules to generate thorough ' +
      'unit tests. Cover happy paths, edge cases, boundary conditions, error handling, and ' +
      'negative test cases. Support Vitest, Jest, Mocha, and pytest frameworks.\n' +
      '- **Integration Testing**: Create tests that verify interactions between multiple ' +
      'components, services, or modules. Test API endpoints, database operations, and ' +
      'inter-process communication.\n' +
      '- **Test Coverage**: Analyze existing test coverage, identify untested code paths, and ' +
      'generate targeted tests to improve coverage metrics (statement, branch, function, line).\n' +
      '- **Mock Creation**: Generate appropriate mocks, stubs, and fixtures for external ' +
      'dependencies, API calls, database connections, and file system operations. Support ' +
      'vi.mock, jest.mock, sinon, and MockK patterns.\n\n' +
      '## Output Format\n' +
      'For each test file:\n' +
      '1. Test file path following project conventions\n' +
      '2. Import statements and setup\n' +
      '3. describe/it blocks with clear descriptions\n' +
      '4. Assertions with meaningful error messages\n' +
      '5. Cleanup and teardown where needed\n\n' +
      '## Guidelines\n' +
      '- Follow the AAA pattern (Arrange, Act, Assert)\n' +
      '- Write descriptive test names that explain the expected behavior\n' +
      '- Test one behavior per test case\n' +
      '- Avoid testing implementation details\n' +
      '- Use factories or builders for complex test data\n' +
      '- Ensure tests are deterministic and independent',
    config: {
      maxRetries: 2,
      timeout: 120000,
      framework: 'vitest',
      coverageThreshold: 80,
      includeEdgeCases: true,
      mockStrategy: 'auto',
      testNamingConvention: 'descriptive',
      maxTestsPerFunction: 10,
    },
  },

  // -------------------------------------------------------
  // 6. Architect Agent
  // -------------------------------------------------------
  {
    name: 'ArchitectAgent',
    type: 'architect',
    description:
      'Specialized in system design, architectural pattern analysis, dependency management, ' +
      'and API design. Evaluates software architecture for scalability, maintainability, ' +
      'and adherence to design principles (SOLID, DRY, KISS).',
    capabilities: [
      'system_design',
      'pattern_analysis',
      'dependency_management',
      'api_design',
    ],
    tools: ['code_analyzer', 'dependency_graph', 'file_reader', 'diagram_generator'],
    system_prompt:
      'You are a specialized Architect Agent. Your primary role is to analyze, design, and ' +
      'improve software architecture.\n\n' +
      '## Core Expertise\n' +
      '- **System Design**: Evaluate and propose system architectures. Consider scalability, ' +
      'reliability, maintainability, and performance requirements. Design microservices, ' +
      'monoliths, event-driven, and layered architectures as appropriate.\n' +
      '- **Pattern Analysis**: Identify design patterns in existing code (Singleton, Factory, ' +
      'Observer, Strategy, Repository, etc.). Recommend appropriate patterns for new features. ' +
      'Detect anti-patterns and suggest refactoring strategies.\n' +
      '- **Dependency Management**: Analyze module dependencies, identify circular dependencies, ' +
      'evaluate coupling and cohesion metrics, and recommend dependency injection strategies. ' +
      'Generate dependency graphs and module relationship maps.\n' +
      '- **API Design**: Design RESTful APIs, GraphQL schemas, and IPC interfaces following ' +
      'best practices. Define resource naming conventions, versioning strategies, error handling ' +
      'patterns, and pagination approaches.\n\n' +
      '## Output Format\n' +
      'For each architectural analysis:\n' +
      '1. Current architecture assessment\n' +
      '2. Identified issues and risks\n' +
      '3. Recommended improvements with rationale\n' +
      '4. Architecture diagrams (Mermaid format)\n' +
      '5. Migration path if changes are needed\n\n' +
      '## Guidelines\n' +
      '- Follow SOLID principles\n' +
      '- Prefer composition over inheritance\n' +
      '- Design for testability\n' +
      '- Consider backward compatibility\n' +
      '- Document architectural decisions (ADR format)\n' +
      '- Balance ideal architecture with pragmatic constraints',
    config: {
      maxRetries: 2,
      timeout: 180000,
      analysisDepth: 'comprehensive',
      diagramFormat: 'mermaid',
      metricsEnabled: true,
      maxModuleDepth: 10,
      couplingThreshold: 0.7,
      complexityThreshold: 20,
    },
  },

  // -------------------------------------------------------
  // 7. Performance Agent
  // -------------------------------------------------------
  {
    name: 'PerformanceAgent',
    type: 'performance',
    description:
      'Specialized in application profiling, performance optimization, benchmarking, and ' +
      'memory analysis. Identifies performance bottlenecks, memory leaks, inefficient algorithms, ' +
      'and provides optimization recommendations with measurable improvements.',
    capabilities: [
      'profiling',
      'optimization',
      'benchmarking',
      'memory_analysis',
    ],
    tools: ['profiler', 'benchmark_runner', 'file_reader', 'code_analyzer'],
    system_prompt:
      'You are a specialized Performance Agent. Your primary role is to identify and resolve ' +
      'performance issues in software applications.\n\n' +
      '## Core Expertise\n' +
      '- **Profiling**: Analyze CPU and memory profiles to identify hotspots, slow functions, ' +
      'and resource-intensive operations. Use flame graphs, call trees, and allocation tracking ' +
      'to pinpoint issues.\n' +
      '- **Optimization**: Recommend and implement performance improvements including algorithm ' +
      'optimization (time/space complexity), caching strategies, lazy loading, code splitting, ' +
      'database query optimization, and render performance for UI applications.\n' +
      '- **Benchmarking**: Design and execute meaningful benchmarks. Compare performance across ' +
      'different implementations, measure throughput, latency percentiles (p50, p95, p99), and ' +
      'resource utilization.\n' +
      '- **Memory Analysis**: Detect memory leaks, excessive allocations, and retain cycles. ' +
      'Analyze heap snapshots, track object lifecycles, and recommend memory-efficient data ' +
      'structures and patterns.\n\n' +
      '## Output Format\n' +
      'For each performance analysis:\n' +
      '1. Performance baseline measurements\n' +
      '2. Identified bottlenecks with impact assessment\n' +
      '3. Optimization recommendations prioritized by impact/effort\n' +
      '4. Before/after comparison with metrics\n' +
      '5. Monitoring recommendations for ongoing tracking\n\n' +
      '## Guidelines\n' +
      '- Always measure before and after optimization\n' +
      '- Focus on the most impactful bottlenecks first\n' +
      '- Consider the tradeoffs of each optimization\n' +
      '- Use representative workloads for benchmarking\n' +
      '- Avoid premature optimization\n' +
      '- Document performance budgets and thresholds',
    config: {
      maxRetries: 2,
      timeout: 300000,
      sampleRate: 1000,
      memorySnapshotInterval: 60000,
      benchmarkIterations: 100,
      warmupIterations: 10,
      reportFormat: 'detailed',
      thresholds: {
        cpuUsage: 80,
        memoryUsage: 85,
        responseTime: 2000,
        heapGrowthRate: 5,
      },
    },
  },

  // -------------------------------------------------------
  // 8. Compliance Agent
  // -------------------------------------------------------
  {
    name: 'ComplianceAgent',
    type: 'compliance',
    description:
      'Specialized in regulatory compliance checking including GDPR data protection, ' +
      'OWASP security compliance, open source license validation, and organizational policy ' +
      'enforcement. Generates compliance reports and remediation plans.',
    capabilities: [
      'gdpr_compliance',
      'owasp_compliance',
      'license_check',
      'policy_validation',
    ],
    tools: ['compliance_checker', 'policy_validator', 'file_reader', 'code_analyzer'],
    system_prompt:
      'You are a specialized Compliance Agent. Your primary role is to ensure software ' +
      'projects meet regulatory, security, and organizational compliance requirements.\n\n' +
      '## Core Expertise\n' +
      '- **GDPR Compliance**: Verify data protection practices including data minimization, ' +
      'purpose limitation, storage limitation, consent management, right to erasure implementation, ' +
      'data portability support, and privacy by design principles. Check for proper data processing ' +
      'agreements and privacy notices.\n' +
      '- **OWASP Compliance**: Validate adherence to OWASP Application Security Verification ' +
      'Standard (ASVS). Check authentication, session management, access control, input validation, ' +
      'cryptographic practices, error handling, data protection, communication security, and ' +
      'HTTP security configuration.\n' +
      '- **License Check**: Scan all dependencies for license compatibility. Identify copyleft ' +
      'licenses (GPL, AGPL), permissive licenses (MIT, Apache, BSD), and proprietary licenses. ' +
      'Detect license conflicts and ensure compliance with organizational licensing policies.\n' +
      '- **Policy Validation**: Enforce organizational coding standards, naming conventions, ' +
      'documentation requirements, and deployment policies. Validate configuration files against ' +
      'security baselines and best practices.\n\n' +
      '## Output Format\n' +
      'For each compliance check:\n' +
      '1. Compliance status (PASS, FAIL, WARNING, NOT_APPLICABLE)\n' +
      '2. Detailed findings per requirement\n' +
      '3. Evidence and references\n' +
      '4. Remediation steps for non-compliant items\n' +
      '5. Compliance score and summary\n\n' +
      '## Guidelines\n' +
      '- Be thorough but avoid false positives\n' +
      '- Reference specific regulatory articles and standards\n' +
      '- Prioritize findings by regulatory risk\n' +
      '- Consider the application\'s data sensitivity classification\n' +
      '- Provide clear, actionable remediation steps\n' +
      '- Track compliance status over time',
    config: {
      maxRetries: 2,
      timeout: 180000,
      frameworks: ['gdpr', 'owasp-asvs', 'cwe-top-25'],
      licenseWhitelist: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'],
      licenseBlacklist: ['GPL-3.0', 'AGPL-3.0'],
      policyVersion: '1.0.0',
      reportFormat: 'structured',
      autoRemediate: false,
    },
  },
];

// ============================================================
// AgentTemplateManager Class
// ============================================================

/**
 * AgentTemplateManager - Manages specialized agent templates
 *
 * Provides CRUD operations for agent templates stored in the agent_templates table.
 * On initialization, seeds the database with 8 default specialized agent templates
 * if the table is empty.
 *
 * @class AgentTemplateManager
 */
class AgentTemplateManager {
  /**
   * Create an AgentTemplateManager instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance with getDatabase() method
   */
  constructor({ database }) {
    this.database = database;
    this._initialized = false;
    this._initPromise = null;

    logger.info('[AgentTemplateManager] Instance created');
  }

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Initialize the template manager.
   * Seeds default templates into the database if the agent_templates table is empty.
   * This method is idempotent - calling it multiple times will only seed once.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) {
      return;
    }

    // Prevent concurrent initialization
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = this._doInitialize();
    await this._initPromise;
    this._initPromise = null;
  }

  /**
   * Internal initialization logic
   * @private
   * @returns {Promise<void>}
   */
  async _doInitialize() {
    try {
      await this.initDefaultTemplates();
      this._initialized = true;
      logger.info('[AgentTemplateManager] Initialization complete');
    } catch (error) {
      logger.error('[AgentTemplateManager] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Seed 8 default templates into the database if the table is currently empty.
   * Existing templates are preserved; seeding only occurs when the table has zero rows.
   *
   * @returns {Promise<{seeded: boolean, count: number}>}
   */
  async initDefaultTemplates() {
    try {
      const db = this.database.getDatabase();

      // Check if templates already exist
      const existing = db
        .prepare('SELECT COUNT(*) as count FROM agent_templates')
        .get();

      if (existing.count > 0) {
        logger.info(
          `[AgentTemplateManager] ${existing.count} templates already exist, skipping seed`
        );
        return { seeded: false, count: existing.count };
      }

      // Seed default templates
      const insertStmt = db.prepare(`
        INSERT INTO agent_templates (
          id, name, type, description, capabilities, tools,
          system_prompt, config, version, enabled, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      let seededCount = 0;

      const insertMany = db.transaction(() => {
        for (const template of DEFAULT_TEMPLATES) {
          const id = uuidv4();
          insertStmt.run(
            id,
            template.name,
            template.type,
            template.description,
            JSON.stringify(template.capabilities),
            JSON.stringify(template.tools),
            template.system_prompt,
            JSON.stringify(template.config),
            '1.0.0',
            1,
            now
          );
          seededCount++;
        }
      });

      insertMany();

      logger.info(
        `[AgentTemplateManager] Seeded ${seededCount} default templates`
      );
      return { seeded: true, count: seededCount };
    } catch (error) {
      logger.error(
        '[AgentTemplateManager] Failed to seed default templates:',
        error
      );
      throw error;
    }
  }

  // ============================================================
  // Query Operations
  // ============================================================

  /**
   * List agent templates with optional filters.
   *
   * @param {Object} [filters={}] - Filter criteria
   * @param {string} [filters.type] - Filter by agent type (e.g., 'code-security', 'devops')
   * @param {boolean} [filters.enabled] - Filter by enabled status (true/false)
   * @param {string} [filters.search] - Search in name and description
   * @param {string} [filters.sortBy='created_at'] - Sort field
   * @param {string} [filters.sortOrder='DESC'] - Sort order ('ASC' or 'DESC')
   * @param {number} [filters.limit=50] - Maximum number of results
   * @param {number} [filters.offset=0] - Result offset for pagination
   * @returns {Promise<{templates: Array, total: number}>}
   */
  async listTemplates(filters = {}) {
    try {
      const db = this.database.getDatabase();

      // Build WHERE clause
      const conditions = [];
      const params = [];

      if (filters.type) {
        conditions.push('type = ?');
        params.push(filters.type);
      }

      if (filters.enabled !== undefined && filters.enabled !== null) {
        conditions.push('enabled = ?');
        params.push(filters.enabled ? 1 : 0);
      }

      if (filters.search) {
        conditions.push('(name LIKE ? OR description LIKE ?)');
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Validate sort parameters to prevent SQL injection
      const allowedSortFields = [
        'created_at',
        'name',
        'type',
        'version',
        'enabled',
      ];
      const sortBy = allowedSortFields.includes(filters.sortBy)
        ? filters.sortBy
        : 'created_at';
      const sortOrder =
        filters.sortOrder && filters.sortOrder.toUpperCase() === 'ASC'
          ? 'ASC'
          : 'DESC';

      const limit = Math.min(Math.max(parseInt(filters.limit) || 50, 1), 200);
      const offset = Math.max(parseInt(filters.offset) || 0, 0);

      // Get total count
      const countRow = db
        .prepare(`SELECT COUNT(*) as total FROM agent_templates ${whereClause}`)
        .get(...params);

      // Get paginated results
      const templates = db
        .prepare(
          `SELECT * FROM agent_templates ${whereClause}
           ORDER BY ${sortBy} ${sortOrder}
           LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);

      // Parse JSON fields
      const parsed = templates.map((t) => this._parseTemplateRow(t));

      return { templates: parsed, total: countRow.total };
    } catch (error) {
      logger.error('[AgentTemplateManager] Failed to list templates:', error);
      throw error;
    }
  }

  /**
   * Get a single template by ID.
   *
   * @param {string} id - Template UUID
   * @returns {Promise<Object|null>} The template object or null if not found
   */
  async getTemplate(id) {
    try {
      if (!id) {
        throw new Error('Template ID is required');
      }

      const db = this.database.getDatabase();
      const row = db
        .prepare('SELECT * FROM agent_templates WHERE id = ?')
        .get(id);

      if (!row) {
        return null;
      }

      return this._parseTemplateRow(row);
    } catch (error) {
      logger.error(
        `[AgentTemplateManager] Failed to get template ${id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Find a template by its type identifier.
   *
   * @param {string} type - Agent type (e.g., 'code-security', 'devops')
   * @returns {Promise<Object|null>} The template object or null if not found
   */
  async getTemplateByType(type) {
    try {
      if (!type) {
        throw new Error('Template type is required');
      }

      const db = this.database.getDatabase();
      const row = db
        .prepare('SELECT * FROM agent_templates WHERE type = ? AND enabled = 1')
        .get(type);

      if (!row) {
        return null;
      }

      return this._parseTemplateRow(row);
    } catch (error) {
      logger.error(
        `[AgentTemplateManager] Failed to get template by type ${type}:`,
        error
      );
      throw error;
    }
  }

  // ============================================================
  // Mutation Operations
  // ============================================================

  /**
   * Create a new agent template.
   *
   * @param {Object} data - Template data
   * @param {string} data.name - Template name (required)
   * @param {string} data.type - Agent type identifier (required, must be unique)
   * @param {string} [data.description] - Human-readable description
   * @param {Array<string>} data.capabilities - List of capability identifiers (required)
   * @param {Array<string>} data.tools - List of tool identifiers (required)
   * @param {string} [data.system_prompt] - System prompt for the agent
   * @param {Object} [data.config] - Additional configuration
   * @param {string} [data.version='1.0.0'] - Template version
   * @param {boolean} [data.enabled=true] - Whether the template is enabled
   * @returns {Promise<Object>} The created template
   */
  async createTemplate(data) {
    try {
      // Validate required fields
      this._validateTemplateData(data);

      const db = this.database.getDatabase();

      // Check for duplicate type
      const existingType = db
        .prepare('SELECT id FROM agent_templates WHERE type = ?')
        .get(data.type);

      if (existingType) {
        throw new Error(
          `Template with type '${data.type}' already exists (id: ${existingType.id})`
        );
      }

      const id = uuidv4();
      const now = Date.now();

      db.prepare(
        `INSERT INTO agent_templates (
          id, name, type, description, capabilities, tools,
          system_prompt, config, version, enabled, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        data.name,
        data.type,
        data.description || null,
        JSON.stringify(data.capabilities),
        JSON.stringify(data.tools),
        data.system_prompt || null,
        data.config ? JSON.stringify(data.config) : null,
        data.version || '1.0.0',
        data.enabled !== false ? 1 : 0,
        now
      );

      const created = await this.getTemplate(id);
      logger.info(
        `[AgentTemplateManager] Created template: ${data.name} (${data.type})`
      );
      return created;
    } catch (error) {
      logger.error('[AgentTemplateManager] Failed to create template:', error);
      throw error;
    }
  }

  /**
   * Update an existing agent template.
   *
   * @param {string} id - Template UUID
   * @param {Object} updates - Fields to update
   * @param {string} [updates.name] - Updated name
   * @param {string} [updates.description] - Updated description
   * @param {Array<string>} [updates.capabilities] - Updated capabilities
   * @param {Array<string>} [updates.tools] - Updated tools
   * @param {string} [updates.system_prompt] - Updated system prompt
   * @param {Object} [updates.config] - Updated configuration
   * @param {string} [updates.version] - Updated version
   * @param {boolean} [updates.enabled] - Updated enabled status
   * @returns {Promise<Object|null>} The updated template or null if not found
   */
  async updateTemplate(id, updates) {
    try {
      if (!id) {
        throw new Error('Template ID is required');
      }

      if (!updates || Object.keys(updates).length === 0) {
        throw new Error('No updates provided');
      }

      const db = this.database.getDatabase();

      // Check if template exists
      const existing = db
        .prepare('SELECT * FROM agent_templates WHERE id = ?')
        .get(id);

      if (!existing) {
        return null;
      }

      // Build dynamic UPDATE query
      const setClauses = [];
      const params = [];

      const allowedFields = [
        'name',
        'description',
        'system_prompt',
        'version',
      ];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          setClauses.push(`${field} = ?`);
          params.push(updates[field]);
        }
      }

      // Handle JSON fields
      if (updates.capabilities !== undefined) {
        if (!Array.isArray(updates.capabilities)) {
          throw new Error('capabilities must be an array');
        }
        setClauses.push('capabilities = ?');
        params.push(JSON.stringify(updates.capabilities));
      }

      if (updates.tools !== undefined) {
        if (!Array.isArray(updates.tools)) {
          throw new Error('tools must be an array');
        }
        setClauses.push('tools = ?');
        params.push(JSON.stringify(updates.tools));
      }

      if (updates.config !== undefined) {
        setClauses.push('config = ?');
        params.push(JSON.stringify(updates.config));
      }

      // Handle boolean field
      if (updates.enabled !== undefined) {
        setClauses.push('enabled = ?');
        params.push(updates.enabled ? 1 : 0);
      }

      if (setClauses.length === 0) {
        throw new Error('No valid update fields provided');
      }

      params.push(id);

      db.prepare(
        `UPDATE agent_templates SET ${setClauses.join(', ')} WHERE id = ?`
      ).run(...params);

      const updated = await this.getTemplate(id);
      logger.info(
        `[AgentTemplateManager] Updated template: ${updated.name} (${id})`
      );
      return updated;
    } catch (error) {
      logger.error(
        `[AgentTemplateManager] Failed to update template ${id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Delete a template by ID.
   * Default (seeded) templates cannot be deleted to ensure system integrity.
   *
   * @param {string} id - Template UUID
   * @param {Object} [options={}] - Delete options
   * @param {boolean} [options.force=false] - Force delete even for default templates
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteTemplate(id, options = {}) {
    try {
      if (!id) {
        throw new Error('Template ID is required');
      }

      const db = this.database.getDatabase();

      // Check if template exists
      const existing = db
        .prepare('SELECT * FROM agent_templates WHERE id = ?')
        .get(id);

      if (!existing) {
        return { success: false, error: 'TEMPLATE_NOT_FOUND' };
      }

      // Check if this is a default template
      if (!options.force) {
        const isDefault = DEFAULT_TEMPLATES.some(
          (dt) => dt.type === existing.type && dt.name === existing.name
        );

        if (isDefault) {
          return {
            success: false,
            error: 'CANNOT_DELETE_DEFAULT',
            message:
              'Default templates cannot be deleted. Use { force: true } to override.',
          };
        }
      }

      // Check for active agent instances using this template
      const activeInstances = db
        .prepare(
          `SELECT COUNT(*) as count FROM agent_task_history
           WHERE template_type = ? AND completed_at IS NULL`
        )
        .get(existing.type);

      if (activeInstances && activeInstances.count > 0) {
        return {
          success: false,
          error: 'TEMPLATE_IN_USE',
          message: `Template has ${activeInstances.count} active agent tasks. Terminate them first.`,
        };
      }

      db.prepare('DELETE FROM agent_templates WHERE id = ?').run(id);

      logger.info(
        `[AgentTemplateManager] Deleted template: ${existing.name} (${id})`
      );
      return { success: true };
    } catch (error) {
      logger.error(
        `[AgentTemplateManager] Failed to delete template ${id}:`,
        error
      );
      throw error;
    }
  }

  // ============================================================
  // Bulk Operations
  // ============================================================

  /**
   * Get all enabled templates grouped by type.
   *
   * @returns {Promise<Object>} Map of type -> template
   */
  async getEnabledTemplatesByType() {
    try {
      const db = this.database.getDatabase();
      const rows = db
        .prepare('SELECT * FROM agent_templates WHERE enabled = 1')
        .all();

      const result = {};
      for (const row of rows) {
        const parsed = this._parseTemplateRow(row);
        result[parsed.type] = parsed;
      }

      return result;
    } catch (error) {
      logger.error(
        '[AgentTemplateManager] Failed to get enabled templates:',
        error
      );
      throw error;
    }
  }

  /**
   * Toggle the enabled status of a template.
   *
   * @param {string} id - Template UUID
   * @returns {Promise<Object|null>} The updated template or null if not found
   */
  async toggleTemplate(id) {
    try {
      const db = this.database.getDatabase();

      const existing = db
        .prepare('SELECT * FROM agent_templates WHERE id = ?')
        .get(id);

      if (!existing) {
        return null;
      }

      const newEnabled = existing.enabled ? 0 : 1;
      db.prepare('UPDATE agent_templates SET enabled = ? WHERE id = ?').run(
        newEnabled,
        id
      );

      const updated = await this.getTemplate(id);
      logger.info(
        `[AgentTemplateManager] Toggled template ${existing.name}: enabled=${newEnabled}`
      );
      return updated;
    } catch (error) {
      logger.error(
        `[AgentTemplateManager] Failed to toggle template ${id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Clone an existing template with a new name and type.
   *
   * @param {string} sourceId - ID of the template to clone
   * @param {Object} overrides - Fields to override in the clone
   * @param {string} overrides.name - New template name (required)
   * @param {string} overrides.type - New agent type (required)
   * @returns {Promise<Object>} The cloned template
   */
  async cloneTemplate(sourceId, overrides = {}) {
    try {
      if (!overrides.name || !overrides.type) {
        throw new Error('Name and type are required for cloning');
      }

      const source = await this.getTemplate(sourceId);
      if (!source) {
        throw new Error(`Source template not found: ${sourceId}`);
      }

      const cloneData = {
        name: overrides.name,
        type: overrides.type,
        description: overrides.description || source.description,
        capabilities: overrides.capabilities || source.capabilities,
        tools: overrides.tools || source.tools,
        system_prompt: overrides.system_prompt || source.system_prompt,
        config: overrides.config || source.config,
        version: overrides.version || '1.0.0',
        enabled: overrides.enabled !== undefined ? overrides.enabled : true,
      };

      const cloned = await this.createTemplate(cloneData);
      logger.info(
        `[AgentTemplateManager] Cloned template ${source.name} -> ${cloneData.name}`
      );
      return cloned;
    } catch (error) {
      logger.error(
        `[AgentTemplateManager] Failed to clone template ${sourceId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Export all templates as a JSON-serializable array.
   * Useful for backup and migration.
   *
   * @returns {Promise<Array>} Array of template objects
   */
  async exportTemplates() {
    try {
      const { templates } = await this.listTemplates({ limit: 200 });
      logger.info(
        `[AgentTemplateManager] Exported ${templates.length} templates`
      );
      return templates;
    } catch (error) {
      logger.error('[AgentTemplateManager] Failed to export templates:', error);
      throw error;
    }
  }

  /**
   * Import templates from an array, skipping any that conflict on type.
   *
   * @param {Array} templates - Array of template data objects
   * @param {Object} [options={}] - Import options
   * @param {boolean} [options.overwrite=false] - Overwrite existing templates with same type
   * @returns {Promise<{imported: number, skipped: number, errors: Array}>}
   */
  async importTemplates(templates, options = {}) {
    try {
      if (!Array.isArray(templates)) {
        throw new Error('Templates must be an array');
      }

      let imported = 0;
      let skipped = 0;
      const errors = [];

      for (const template of templates) {
        try {
          const existing = await this.getTemplateByType(template.type);

          if (existing) {
            if (options.overwrite) {
              await this.updateTemplate(existing.id, template);
              imported++;
            } else {
              skipped++;
            }
          } else {
            await this.createTemplate(template);
            imported++;
          }
        } catch (err) {
          errors.push({
            template: template.name || template.type,
            error: err.message,
          });
        }
      }

      logger.info(
        `[AgentTemplateManager] Import complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors`
      );
      return { imported, skipped, errors };
    } catch (error) {
      logger.error('[AgentTemplateManager] Failed to import templates:', error);
      throw error;
    }
  }

  /**
   * Reset templates to defaults by removing all custom templates and re-seeding.
   *
   * @returns {Promise<{cleared: number, seeded: number}>}
   */
  async resetToDefaults() {
    try {
      const db = this.database.getDatabase();

      // Count existing templates
      const { count } = db
        .prepare('SELECT COUNT(*) as count FROM agent_templates')
        .get();

      // Clear all templates
      db.prepare('DELETE FROM agent_templates').run();

      // Re-seed defaults
      this._initialized = false;
      const { count: seeded } = await this.initDefaultTemplates();

      logger.info(
        `[AgentTemplateManager] Reset to defaults: cleared ${count}, seeded ${seeded}`
      );
      return { cleared: count, seeded };
    } catch (error) {
      logger.error('[AgentTemplateManager] Failed to reset to defaults:', error);
      throw error;
    }
  }

  // ============================================================
  // Capability Queries
  // ============================================================

  /**
   * Find templates that have a specific capability.
   *
   * @param {string} capability - Capability identifier (e.g., 'owasp_scanning')
   * @returns {Promise<Array>} Templates with the specified capability
   */
  async findByCapability(capability) {
    try {
      if (!capability) {
        throw new Error('Capability is required');
      }

      const db = this.database.getDatabase();

      // SQLite JSON search - capabilities is stored as JSON array string
      const rows = db
        .prepare(
          `SELECT * FROM agent_templates
           WHERE enabled = 1 AND capabilities LIKE ?`
        )
        .all(`%"${capability}"%`);

      return rows.map((r) => this._parseTemplateRow(r));
    } catch (error) {
      logger.error(
        `[AgentTemplateManager] Failed to find by capability ${capability}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Find templates that include a specific tool.
   *
   * @param {string} tool - Tool identifier (e.g., 'code_analyzer')
   * @returns {Promise<Array>} Templates that use the specified tool
   */
  async findByTool(tool) {
    try {
      if (!tool) {
        throw new Error('Tool identifier is required');
      }

      const db = this.database.getDatabase();

      const rows = db
        .prepare(
          `SELECT * FROM agent_templates
           WHERE enabled = 1 AND tools LIKE ?`
        )
        .all(`%"${tool}"%`);

      return rows.map((r) => this._parseTemplateRow(r));
    } catch (error) {
      logger.error(
        `[AgentTemplateManager] Failed to find by tool ${tool}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get a summary of all available capabilities across all enabled templates.
   *
   * @returns {Promise<Object>} Map of capability -> Array of template types
   */
  async getCapabilitySummary() {
    try {
      const db = this.database.getDatabase();
      const rows = db
        .prepare(
          'SELECT type, capabilities FROM agent_templates WHERE enabled = 1'
        )
        .all();

      const summary = {};

      for (const row of rows) {
        let capabilities;
        try {
          capabilities = JSON.parse(row.capabilities);
        } catch {
          continue;
        }

        for (const cap of capabilities) {
          if (!summary[cap]) {
            summary[cap] = [];
          }
          summary[cap].push(row.type);
        }
      }

      return summary;
    } catch (error) {
      logger.error(
        '[AgentTemplateManager] Failed to get capability summary:',
        error
      );
      throw error;
    }
  }

  /**
   * Get a summary of all available tools across all enabled templates.
   *
   * @returns {Promise<Object>} Map of tool -> Array of template types
   */
  async getToolSummary() {
    try {
      const db = this.database.getDatabase();
      const rows = db
        .prepare(
          'SELECT type, tools FROM agent_templates WHERE enabled = 1'
        )
        .all();

      const summary = {};

      for (const row of rows) {
        let tools;
        try {
          tools = JSON.parse(row.tools);
        } catch {
          continue;
        }

        for (const tool of tools) {
          if (!summary[tool]) {
            summary[tool] = [];
          }
          summary[tool].push(row.type);
        }
      }

      return summary;
    } catch (error) {
      logger.error(
        '[AgentTemplateManager] Failed to get tool summary:',
        error
      );
      throw error;
    }
  }

  // ============================================================
  // Version Management
  // ============================================================

  /**
   * Bump the version of a template.
   *
   * @param {string} id - Template UUID
   * @param {'major'|'minor'|'patch'} level - Version bump level
   * @returns {Promise<Object|null>} Updated template or null if not found
   */
  async bumpVersion(id, level = 'patch') {
    try {
      const template = await this.getTemplate(id);
      if (!template) {
        return null;
      }

      const currentVersion = template.version || '1.0.0';
      const parts = currentVersion.split('.').map(Number);

      switch (level) {
        case 'major':
          parts[0]++;
          parts[1] = 0;
          parts[2] = 0;
          break;
        case 'minor':
          parts[1]++;
          parts[2] = 0;
          break;
        case 'patch':
        default:
          parts[2]++;
          break;
      }

      const newVersion = parts.join('.');
      return await this.updateTemplate(id, { version: newVersion });
    } catch (error) {
      logger.error(
        `[AgentTemplateManager] Failed to bump version for ${id}:`,
        error
      );
      throw error;
    }
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get template usage statistics by joining with agent_task_history.
   *
   * @returns {Promise<Array>} Usage stats per template type
   */
  async getTemplateUsageStats() {
    try {
      const db = this.database.getDatabase();

      const stats = db
        .prepare(
          `SELECT
            t.type,
            t.name,
            t.enabled,
            COUNT(h.id) as total_tasks,
            SUM(CASE WHEN h.success = 1 THEN 1 ELSE 0 END) as successful_tasks,
            SUM(CASE WHEN h.success = 0 THEN 1 ELSE 0 END) as failed_tasks,
            AVG(h.completed_at - h.started_at) as avg_duration_ms,
            SUM(h.tokens_used) as total_tokens
          FROM agent_templates t
          LEFT JOIN agent_task_history h ON t.type = h.template_type
          GROUP BY t.type, t.name, t.enabled
          ORDER BY total_tasks DESC`
        )
        .all();

      return stats.map((s) => ({
        type: s.type,
        name: s.name,
        enabled: Boolean(s.enabled),
        totalTasks: s.total_tasks || 0,
        successfulTasks: s.successful_tasks || 0,
        failedTasks: s.failed_tasks || 0,
        successRate:
          s.total_tasks > 0
            ? ((s.successful_tasks / s.total_tasks) * 100).toFixed(2) + '%'
            : 'N/A',
        avgDurationMs: s.avg_duration_ms ? Math.round(s.avg_duration_ms) : null,
        totalTokens: s.total_tokens || 0,
      }));
    } catch (error) {
      logger.error(
        '[AgentTemplateManager] Failed to get usage stats:',
        error
      );
      throw error;
    }
  }

  /**
   * Get overall template system statistics.
   *
   * @returns {Promise<Object>}
   */
  async getSystemStats() {
    try {
      const db = this.database.getDatabase();

      const templateStats = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled,
            SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) as disabled
          FROM agent_templates`
        )
        .get();

      const taskStats = db
        .prepare(
          `SELECT
            COUNT(*) as total_tasks,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
            SUM(tokens_used) as total_tokens,
            AVG(completed_at - started_at) as avg_duration
          FROM agent_task_history
          WHERE completed_at IS NOT NULL`
        )
        .get();

      // Get distinct agent types
      const types = db
        .prepare('SELECT DISTINCT type FROM agent_templates')
        .all()
        .map((r) => r.type);

      return {
        templates: {
          total: templateStats.total || 0,
          enabled: templateStats.enabled || 0,
          disabled: templateStats.disabled || 0,
          types,
        },
        tasks: {
          total: taskStats.total_tasks || 0,
          successful: taskStats.successful || 0,
          failed: taskStats.failed || 0,
          successRate:
            taskStats.total_tasks > 0
              ? (
                  (taskStats.successful / taskStats.total_tasks) *
                  100
                ).toFixed(2) + '%'
              : 'N/A',
          totalTokens: taskStats.total_tokens || 0,
          avgDurationMs: taskStats.avg_duration
            ? Math.round(taskStats.avg_duration)
            : null,
        },
      };
    } catch (error) {
      logger.error(
        '[AgentTemplateManager] Failed to get system stats:',
        error
      );
      throw error;
    }
  }

  // ============================================================
  // Validation Helpers
  // ============================================================

  /**
   * Validate template data before insert or update.
   * @private
   * @param {Object} data - Template data to validate
   * @throws {Error} If validation fails
   */
  _validateTemplateData(data) {
    if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
      throw new Error('Template name is required and must be a non-empty string');
    }

    if (!data.type || typeof data.type !== 'string' || data.type.trim() === '') {
      throw new Error('Template type is required and must be a non-empty string');
    }

    // Validate type format: lowercase alphanumeric with hyphens
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(data.type) && data.type.length > 1) {
      throw new Error(
        'Template type must be lowercase alphanumeric with hyphens (e.g., "code-security")'
      );
    }

    if (!Array.isArray(data.capabilities) || data.capabilities.length === 0) {
      throw new Error(
        'capabilities must be a non-empty array of strings'
      );
    }

    for (const cap of data.capabilities) {
      if (typeof cap !== 'string' || cap.trim() === '') {
        throw new Error('Each capability must be a non-empty string');
      }
    }

    if (!Array.isArray(data.tools) || data.tools.length === 0) {
      throw new Error('tools must be a non-empty array of strings');
    }

    for (const tool of data.tools) {
      if (typeof tool !== 'string' || tool.trim() === '') {
        throw new Error('Each tool must be a non-empty string');
      }
    }

    // Validate version format if provided
    if (data.version && !/^\d+\.\d+\.\d+$/.test(data.version)) {
      throw new Error('Version must follow semver format (e.g., "1.0.0")');
    }
  }

  /**
   * Parse a raw database row into a structured template object.
   * Deserializes JSON fields (capabilities, tools, config).
   *
   * @private
   * @param {Object} row - Raw database row
   * @returns {Object} Parsed template object
   */
  _parseTemplateRow(row) {
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      capabilities: this._safeJsonParse(row.capabilities, []),
      tools: this._safeJsonParse(row.tools, []),
      system_prompt: row.system_prompt,
      config: this._safeJsonParse(row.config, {}),
      version: row.version || '1.0.0',
      enabled: Boolean(row.enabled),
      created_at: row.created_at,
    };
  }

  /**
   * Safely parse a JSON string, returning a default value on failure.
   *
   * @private
   * @param {string} jsonStr - JSON string to parse
   * @param {*} defaultValue - Default value if parsing fails
   * @returns {*} Parsed value or default
   */
  _safeJsonParse(jsonStr, defaultValue) {
    if (!jsonStr) return defaultValue;
    try {
      return JSON.parse(jsonStr);
    } catch {
      logger.warn(
        `[AgentTemplateManager] Failed to parse JSON: ${jsonStr.substring(0, 100)}`
      );
      return defaultValue;
    }
  }
}

module.exports = { AgentTemplateManager, DEFAULT_TEMPLATES };
