/**
 * Pipeline Templates - 预置流水线模板
 *
 * 10 个常用工作流模板，覆盖开发、安全、数据、媒体等场景。
 *
 * @module ai-engine/cowork/skills/pipeline-templates
 * @version 1.1.0
 */

const PIPELINE_TEMPLATES = [
  {
    id: "tpl-data-report",
    name: "Data Report Pipeline",
    description: "从网页抓取数据，分析，生成图表和文档报告",
    category: "data",
    tags: ["data", "report", "automation"],
    isTemplate: true,
    variables: { url: "", outputFormat: "markdown" },
    steps: [
      {
        name: "scrape",
        type: "skill",
        skillId: "web-scraping",
        inputMapping: { url: "${url}", format: "json" },
        outputVariable: "scrapedData",
      },
      {
        name: "analyze",
        type: "skill",
        skillId: "data-analysis",
        inputMapping: { data: "${scrape.result}", operation: "summarize" },
        outputVariable: "analysisResult",
      },
      {
        name: "chart",
        type: "skill",
        skillId: "chart-creator",
        inputMapping: { data: "${analyze.result}", chartType: "auto" },
        outputVariable: "chartOutput",
      },
      {
        name: "report",
        type: "skill",
        skillId: "doc-generator",
        inputMapping: {
          content: "${analyze.result}",
          charts: "${chart.result}",
          format: "${outputFormat}",
        },
        outputVariable: "finalReport",
      },
    ],
  },
  {
    id: "tpl-code-review",
    name: "Code Review Pipeline",
    description: "代码审查 → 安全扫描 → Lint修复 → 生成报告",
    category: "development",
    tags: ["code-review", "security", "lint"],
    isTemplate: true,
    variables: { files: [], language: "auto" },
    steps: [
      {
        name: "review",
        type: "skill",
        skillId: "code-review",
        inputMapping: { files: "${files}", language: "${language}" },
        outputVariable: "reviewResult",
      },
      {
        name: "security",
        type: "skill",
        skillId: "security-audit",
        inputMapping: { files: "${files}", severity: "medium" },
        outputVariable: "securityResult",
      },
      {
        name: "lint",
        type: "skill",
        skillId: "lint-and-fix",
        inputMapping: { files: "${files}", autoFix: true },
        outputVariable: "lintResult",
      },
      {
        name: "report",
        type: "skill",
        skillId: "doc-generator",
        inputMapping: {
          content: {
            review: "${review.result}",
            security: "${security.result}",
            lint: "${lint.result}",
          },
          format: "markdown",
          template: "code-review-report",
        },
        outputVariable: "finalReport",
      },
    ],
  },
  {
    id: "tpl-release",
    name: "Release Pipeline",
    description: "生成测试 → 运行测试 → 生成变更日志 → 发布",
    category: "development",
    tags: ["release", "test", "changelog"],
    isTemplate: true,
    variables: { version: "", branch: "main" },
    steps: [
      {
        name: "genTests",
        type: "skill",
        skillId: "test-generator",
        inputMapping: { scope: "changed", branch: "${branch}" },
        outputVariable: "generatedTests",
      },
      {
        name: "runTests",
        type: "skill",
        skillId: "test-and-fix",
        inputMapping: { tests: "${genTests.result}", autoFix: true },
        outputVariable: "testResults",
        retries: 1,
      },
      {
        name: "changelog",
        type: "skill",
        skillId: "changelog-generator",
        inputMapping: { version: "${version}", branch: "${branch}" },
        outputVariable: "changelog",
      },
      {
        name: "release",
        type: "skill",
        skillId: "release-manager",
        inputMapping: {
          version: "${version}",
          changelog: "${changelog.result}",
          testReport: "${runTests.result}",
        },
        outputVariable: "releaseResult",
      },
    ],
  },
  {
    id: "tpl-research",
    name: "Research Pipeline",
    description: "网络调研 → 数据分析 → 知识图谱 → 报告生成",
    category: "knowledge",
    tags: ["research", "knowledge", "analysis"],
    isTemplate: true,
    variables: { topic: "", depth: "medium" },
    steps: [
      {
        name: "scrape",
        type: "skill",
        skillId: "web-scraping",
        inputMapping: { query: "${topic}", depth: "${depth}" },
        outputVariable: "rawData",
      },
      {
        name: "analyze",
        type: "skill",
        skillId: "data-analysis",
        inputMapping: { data: "${scrape.result}", operation: "insights" },
        outputVariable: "insights",
      },
      {
        name: "graph",
        type: "skill",
        skillId: "knowledge-graph",
        inputMapping: { data: "${analyze.result}", topic: "${topic}" },
        outputVariable: "knowledgeGraph",
      },
      {
        name: "report",
        type: "skill",
        skillId: "doc-generator",
        inputMapping: {
          content: "${analyze.result}",
          graph: "${graph.result}",
          format: "markdown",
        },
        outputVariable: "researchReport",
      },
    ],
  },
  {
    id: "tpl-onboarding",
    name: "Project Onboarding Pipeline",
    description: "项目结构分析 → 依赖分析 → 入职引导 → 文档生成",
    category: "development",
    tags: ["onboarding", "documentation", "analysis"],
    isTemplate: true,
    variables: { projectPath: "." },
    steps: [
      {
        name: "repoMap",
        type: "skill",
        skillId: "repo-map",
        inputMapping: { path: "${projectPath}" },
        outputVariable: "repoStructure",
      },
      {
        name: "deps",
        type: "skill",
        skillId: "dependency-analyzer",
        inputMapping: { path: "${projectPath}" },
        outputVariable: "dependencies",
      },
      {
        name: "onboard",
        type: "skill",
        skillId: "onboard-project",
        inputMapping: {
          structure: "${repoMap.result}",
          dependencies: "${deps.result}",
        },
        outputVariable: "onboardingGuide",
      },
      {
        name: "docs",
        type: "skill",
        skillId: "doc-generator",
        inputMapping: {
          content: "${onboard.result}",
          format: "markdown",
          template: "onboarding",
        },
        outputVariable: "documentation",
      },
    ],
  },
  {
    id: "tpl-security-audit",
    name: "Security Audit Pipeline",
    description: "安全扫描 → 漏洞检测 → 影响分析 → 报告",
    category: "security",
    tags: ["security", "vulnerability", "audit"],
    isTemplate: true,
    variables: { target: ".", severity: "low" },
    steps: [
      {
        name: "audit",
        type: "skill",
        skillId: "security-audit",
        inputMapping: { target: "${target}", minSeverity: "${severity}" },
        outputVariable: "auditResult",
      },
      {
        name: "vuln",
        type: "skill",
        skillId: "vulnerability-scanner",
        inputMapping: { target: "${target}" },
        outputVariable: "vulnResult",
      },
      {
        name: "impact",
        type: "skill",
        skillId: "impact-analyzer",
        inputMapping: {
          findings: "${audit.result}",
          vulnerabilities: "${vuln.result}",
        },
        outputVariable: "impactResult",
      },
      {
        name: "report",
        type: "skill",
        skillId: "doc-generator",
        inputMapping: {
          content: {
            audit: "${audit.result}",
            vulnerabilities: "${vuln.result}",
            impact: "${impact.result}",
          },
          format: "markdown",
          template: "security-report",
        },
        outputVariable: "securityReport",
      },
    ],
  },
  {
    id: "tpl-i18n",
    name: "Internationalization Pipeline",
    description: "i18n管理 → 代码翻译 → 文档生成",
    category: "development",
    tags: ["i18n", "translation", "localization"],
    isTemplate: true,
    variables: { targetLanguages: ["en", "zh"], sourcePath: "." },
    steps: [
      {
        name: "i18n",
        type: "skill",
        skillId: "i18n-manager",
        inputMapping: {
          path: "${sourcePath}",
          languages: "${targetLanguages}",
          action: "extract",
        },
        outputVariable: "i18nKeys",
      },
      {
        name: "translate",
        type: "skill",
        skillId: "code-translator",
        inputMapping: {
          keys: "${i18n.result}",
          targetLanguages: "${targetLanguages}",
        },
        outputVariable: "translations",
      },
      {
        name: "docs",
        type: "skill",
        skillId: "doc-generator",
        inputMapping: {
          content: "${translate.result}",
          format: "markdown",
          template: "i18n-report",
        },
        outputVariable: "i18nReport",
      },
    ],
  },
  {
    id: "tpl-media-processing",
    name: "Media Processing Pipeline",
    description: "音频转录 → 字幕生成 → 格式转换",
    category: "media",
    tags: ["media", "transcription", "subtitle"],
    isTemplate: true,
    variables: { inputFile: "", outputFormat: "srt" },
    steps: [
      {
        name: "transcribe",
        type: "skill",
        skillId: "audio-transcriber",
        inputMapping: { file: "${inputFile}", language: "auto" },
        outputVariable: "transcript",
      },
      {
        name: "subtitle",
        type: "skill",
        skillId: "subtitle-generator",
        inputMapping: {
          transcript: "${transcribe.result}",
          format: "${outputFormat}",
        },
        outputVariable: "subtitles",
      },
      {
        name: "convert",
        type: "skill",
        skillId: "doc-converter",
        inputMapping: {
          input: "${subtitle.result}",
          outputFormat: "${outputFormat}",
        },
        outputVariable: "convertedOutput",
      },
    ],
  },
  {
    id: "tpl-performance",
    name: "Performance Optimization Pipeline",
    description: "性能优化 → 日志分析 → 图表报告",
    category: "devops",
    tags: ["performance", "optimization", "monitoring"],
    isTemplate: true,
    variables: { target: ".", timeRange: "24h" },
    steps: [
      {
        name: "optimize",
        type: "skill",
        skillId: "performance-optimizer",
        inputMapping: { target: "${target}" },
        outputVariable: "optimizations",
      },
      {
        name: "logs",
        type: "skill",
        skillId: "log-analyzer",
        inputMapping: { timeRange: "${timeRange}", focus: "performance" },
        outputVariable: "logAnalysis",
      },
      {
        name: "chart",
        type: "skill",
        skillId: "chart-creator",
        inputMapping: {
          data: "${logs.result}",
          chartType: "line",
          title: "Performance Metrics",
        },
        outputVariable: "performanceChart",
      },
    ],
  },
  {
    id: "tpl-data-migration",
    name: "Data Migration Pipeline",
    description: "数据库迁移 → 数据导出 → 备份",
    category: "devops",
    tags: ["migration", "backup", "data"],
    isTemplate: true,
    variables: { migrationPath: "", backupDir: "" },
    steps: [
      {
        name: "migrate",
        type: "skill",
        skillId: "db-migration",
        inputMapping: { path: "${migrationPath}", action: "up" },
        outputVariable: "migrationResult",
      },
      {
        name: "export",
        type: "skill",
        skillId: "data-exporter",
        inputMapping: { format: "json", includeSchema: true },
        outputVariable: "exportResult",
      },
      {
        name: "backup",
        type: "skill",
        skillId: "backup-manager",
        inputMapping: {
          data: "${export.result}",
          destination: "${backupDir}",
          compress: true,
        },
        outputVariable: "backupResult",
      },
    ],
  },
];

/**
 * Get all pipeline templates
 * @returns {object[]}
 */
function getTemplates() {
  return PIPELINE_TEMPLATES;
}

/**
 * Get a template by ID
 * @param {string} templateId
 * @returns {object|null}
 */
function getTemplateById(templateId) {
  return PIPELINE_TEMPLATES.find((t) => t.id === templateId) || null;
}

/**
 * Get templates by category
 * @param {string} category
 * @returns {object[]}
 */
function getTemplatesByCategory(category) {
  return PIPELINE_TEMPLATES.filter((t) => t.category === category);
}

module.exports = {
  PIPELINE_TEMPLATES,
  getTemplates,
  getTemplateById,
  getTemplatesByCategory,
};
