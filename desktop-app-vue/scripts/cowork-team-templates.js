#!/usr/bin/env node
/**
 * Cowork Team Templates Script
 *
 * Purpose: Validate and test team templates
 * - Load all team templates
 * - Validate JSON structure
 * - Verify agent configurations
 * - Test team creation
 * - Generate usage guide
 */

const fs = require('fs');
const path = require('path');

console.log('👥 Cowork Team Templates\n');
console.log('='.repeat(60));

const stats = {
  templatesLoaded: 0,
  templatesValid: 0,
  totalAgents: 0,
  errors: 0,
};

function pass(message) {
  console.log(`✅ ${message}`);
}

function fail(message) {
  console.log(`❌ ${message}`);
  stats.errors++;
}

function warn(message) {
  console.log(`⚠️  ${message}`);
}

function info(message) {
  console.log(`ℹ️  ${message}`);
}

/**
 * Load team template
 */
function loadTemplate(templatePath) {
  try {
    const content = fs.readFileSync(templatePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    fail(`Failed to load template: ${error.message}`);
    return null;
  }
}

/**
 * Validate template structure
 */
function validateTemplate(template, templateName) {
  const requiredFields = [
    'name',
    'description',
    'version',
    'type',
    'config',
    'agents',
    'workflow',
    'output',
    'metrics',
  ];

  let isValid = true;

  requiredFields.forEach((field) => {
    if (!template[field]) {
      fail(`Template ${templateName} missing field: ${field}`);
      isValid = false;
    }
  });

  // Validate agents
  if (template.agents && Array.isArray(template.agents)) {
    if (template.agents.length === 0) {
      fail(`Template ${templateName} has no agents`);
      isValid = false;
    } else {
      pass(`Template ${templateName} has ${template.agents.length} agents`);
      stats.totalAgents += template.agents.length;

      // Validate each agent
      template.agents.forEach((agent, index) => {
        const requiredAgentFields = ['name', 'role', 'description', 'capabilities', 'priority'];

        requiredAgentFields.forEach((field) => {
          if (!agent[field]) {
            fail(`Agent ${index + 1} in ${templateName} missing field: ${field}`);
            isValid = false;
          }
        });

        if (agent.capabilities && agent.capabilities.length > 0) {
          info(`  Agent "${agent.name}": ${agent.capabilities.length} capabilities`);
        }
      });
    }
  } else {
    fail(`Template ${templateName} agents field is not an array`);
    isValid = false;
  }

  // Validate workflow
  if (template.workflow && template.workflow.steps) {
    pass(`Template ${templateName} has ${template.workflow.steps.length} workflow steps`);
  }

  return isValid;
}

/**
 * Step 1: Load and validate templates
 */
function loadAndValidateTemplates() {
  console.log('\n📋 Step 1: Loading and Validating Team Templates\n');

  const templatesDir = path.join(__dirname, '../src/main/cowork/templates');

  // Ensure directory exists
  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
    info('Created templates directory');
  }

  const templateFiles = [
    'code-review-team.json',
    'test-generation-team.json',
    'documentation-team.json',
  ];

  const templates = {};

  templateFiles.forEach((file) => {
    const templatePath = path.join(templatesDir, file);

    if (fs.existsSync(templatePath)) {
      const template = loadTemplate(templatePath);

      if (template) {
        stats.templatesLoaded++;
        const isValid = validateTemplate(template, file);

        if (isValid) {
          stats.templatesValid++;
          templates[file] = template;
          pass(`Template ${file} loaded and validated`);
        } else {
          fail(`Template ${file} validation failed`);
        }
      }
    } else {
      fail(`Template file not found: ${file}`);
    }
  });

  console.log(`\n📊 Loaded ${stats.templatesLoaded} templates, ${stats.templatesValid} valid`);

  return templates;
}

/**
 * Step 2: Analyze template capabilities
 */
function analyzeTemplates(templates) {
  console.log('\n📋 Step 2: Analyzing Template Capabilities\n');

  Object.entries(templates).forEach(([fileName, template]) => {
    console.log(`\n📦 ${template.name} (${template.type})`);
    console.log(`   Description: ${template.description}`);
    console.log(`   Agents: ${template.agents.length}`);
    console.log(`   Workflow: ${template.workflow.type}`);

    // List agents
    template.agents.forEach((agent, index) => {
      console.log(`\n   Agent ${index + 1}: ${agent.name} (${agent.role})`);
      console.log(`     Priority: ${agent.priority}`);
      console.log(`     Capabilities: ${agent.capabilities.slice(0, 3).join(', ')}${agent.capabilities.length > 3 ? '...' : ''}`);
    });

    // Workflow summary
    console.log(`\n   Workflow Steps: ${template.workflow.steps.length}`);
    template.workflow.steps.forEach((step, index) => {
      console.log(`     ${index + 1}. ${step.name}`);
    });
  });
}

/**
 * Step 3: Generate usage guide
 */
function generateUsageGuide(templates) {
  console.log('\n📋 Step 3: Generating Team Templates Guide\n');

  const guide = `# Cowork Team Templates Guide

**Version**: 1.0.0
**Date**: ${new Date().toISOString().split('T')[0]}
**Templates**: ${Object.keys(templates).length}
**Total Agents**: ${stats.totalAgents}

---

## Available Team Templates

### 1. Code Review Team

**Purpose**: Automated code review with multi-dimensional analysis

**Agents** (4):
1. **Security Reviewer** - Scans for OWASP vulnerabilities
2. **Performance Analyzer** - Analyzes complexity and optimization opportunities
3. **Code Quality Expert** - Ensures maintainability and best practices
4. **Architecture Validator** - Validates design patterns and SOLID principles

**Workflow**: Parallel review → Aggregate → Prioritize → Report

**Usage**:
\`\`\`javascript
const team = await cowork.createTeam({ template: 'code-review' });
const task = await cowork.assignTask(team.id, {
  type: 'code-review',
  input: {
    files: ['src/auth/login.js'],
    aspects: ['security', 'performance', 'quality', 'architecture']
  }
});
\`\`\`

**Expected Output**:
- Security issues report (OWASP categorized)
- Performance bottlenecks with Big O analysis
- Code quality metrics (duplications, smells)
- Architecture recommendations

**Time**: 2-5 minutes for typical module (~500 lines)

---

### 2. Test Generation Team

**Purpose**: Automated test generation with comprehensive coverage

**Agents** (3):
1. **Unit Test Generator** - Creates unit tests with 90%+ coverage
2. **Integration Test Designer** - Designs API and component interaction tests
3. **Edge Case Analyzer** - Identifies boundary conditions and error scenarios

**Workflow**: Code Analysis → Unit Tests → Integration Tests → Edge Cases → Assembly → Coverage Check

**Usage**:
\`\`\`javascript
const team = await cowork.createTeam({ template: 'test-generation' });
const task = await cowork.assignTask(team.id, {
  type: 'test-generation',
  input: {
    sourceFiles: ['src/services/user-service.js'],
    coverageTarget: 90,
    includeEdgeCases: true
  }
});
\`\`\`

**Expected Output**:
- \`__tests__/unit/\` - Unit test files
- \`__tests__/integration/\` - Integration test files
- \`__tests__/edge-cases/\` - Edge case test files
- Coverage report (target: 90%)

**Time**: 3-10 minutes depending on code complexity

---

### 3. Documentation Team

**Purpose**: Comprehensive documentation generation

**Agents** (3):
1. **API Doc Writer** - Generates OpenAPI/Swagger documentation
2. **User Guide Creator** - Creates tutorials and how-to guides
3. **Architecture Documenter** - Documents system design and ADRs

**Workflow**: Parallel analysis → API Docs + User Guides + Architecture Docs → Assembly → Cross-linking → Quality Check

**Usage**:
\`\`\`javascript
const team = await cowork.createTeam({ template: 'documentation' });
const task = await cowork.assignTask(team.id, {
  type: 'documentation',
  input: {
    modules: ['src/api'],
    includeAPI: true,
    includeGuides: true,
    includeArchitecture: true
  }
});
\`\`\`

**Expected Output**:
- \`docs/api/API.md\` - API documentation
- \`docs/api/openapi.yaml\` - OpenAPI specification
- \`docs/guides/QUICK_START.md\` - Quick start guide
- \`docs/guides/USER_GUIDE.md\` - Comprehensive user guide
- \`docs/architecture/ARCHITECTURE.md\` - System architecture
- \`docs/architecture/decisions/\` - ADRs (Architecture Decision Records)

**Time**: 5-15 minutes depending on module size

---

## Template Comparison

| Feature | Code Review | Test Generation | Documentation |
|---------|-------------|-----------------|---------------|
| **Agents** | 4 | 3 | 3 |
| **Execution** | Parallel | Sequential | Parallel |
| **Time** | 2-5 min | 3-10 min | 5-15 min |
| **Coverage** | 4 dimensions | 90% code | 100% modules |
| **LLM Usage** | High | High | High |
| **Fallback** | Heuristics | Basic tests | Templates |

---

## Creating Teams

### Option 1: Use Template

\`\`\`javascript
// Quick team creation from template
const team = await cowork.createTeam({
  template: 'code-review'  // or 'test-generation', 'documentation'
});
\`\`\`

### Option 2: Customize Template

\`\`\`javascript
// Load and customize template
const template = await cowork.loadTemplate('code-review');
template.config.coverageTarget = 95;  // Custom setting
template.agents = template.agents.filter(a => a.role !== 'architecture-reviewer');

const team = await cowork.createTeam({
  name: 'Custom Code Review',
  ...template
});
\`\`\`

### Option 3: Create from Scratch

\`\`\`javascript
// Manual team creation
const team = await cowork.createTeam({
  name: 'My Custom Team',
  config: { maxAgents: 2 },
  agents: [
    {
      name: 'Custom Agent 1',
      role: 'custom-role',
      capabilities: ['capability-1', 'capability-2']
    }
  ]
});
\`\`\`

---

## Team Configuration Options

### Common Config Fields

\`\`\`javascript
{
  maxAgents: 4,                    // Maximum concurrent agents
  autoAssignTasks: true,           // Auto-assign tasks to agents
  parallelExecution: true,         // Run agents in parallel
  conflictResolution: 'llm',       // 'llm' | 'vote' | 'first'
  workingHours: '24/7',            // Agent availability
  coverageTarget: 90,              // For test teams
  outputFormat: 'markdown'         // For doc teams
}
\`\`\`

---

## Workflow Types

### Parallel Workflow
**Used by**: Code Review, Documentation
- All agents work simultaneously
- Fast execution (< 5 minutes)
- Independent analysis

### Sequential Workflow
**Used by**: Test Generation
- Agents work in order
- Dependencies between steps
- More thorough but slower

### Hybrid Workflow
**Used by**: Custom teams
- Mix of parallel and sequential steps
- Optimized for complex workflows

---

## Agent Capabilities Reference

### Security Capabilities
- \`security-scan\` - General security scanning
- \`owasp-check\` - OWASP Top 10 validation
- \`sql-injection-check\` - SQL injection detection
- \`xss-check\` - Cross-site scripting detection
- \`crypto-audit\` - Cryptography review

### Performance Capabilities
- \`complexity-analysis\` - Time/space complexity
- \`memory-check\` - Memory leak detection
- \`algorithm-optimization\` - Algorithm improvements
- \`bottleneck-detection\` - Performance bottlenecks

### Testing Capabilities
- \`unit-test-generation\` - Unit test creation
- \`integration-test-design\` - Integration test design
- \`edge-case-detection\` - Edge case identification
- \`mocking\` - Test double creation

### Documentation Capabilities
- \`api-documentation\` - API doc generation
- \`user-guide-writing\` - User guide creation
- \`architecture-documentation\` - System architecture docs
- \`adr-writing\` - Architecture decision records

---

## Best Practices

### 1. Choose Right Template
- **Code Review**: For PR reviews, security audits
- **Test Generation**: For new features, bug fixes
- **Documentation**: For releases, onboarding

### 2. Customize for Your Needs
\`\`\`javascript
// Adjust coverage targets
template.config.coverageTarget = 95;

// Add/remove agents
template.agents = template.agents.filter(a => a.priority <= 2);

// Change workflow
template.workflow.type = 'sequential';
\`\`\`

### 3. Monitor Performance
\`\`\`javascript
// Track team metrics
const metrics = await cowork.getTeamMetrics(team.id);
console.log(metrics.avgTaskTime);  // Average task completion time
console.log(metrics.successRate);  // Task success rate
\`\`\`

### 4. Iterate and Improve
- Review agent performance
- Adjust LLM prompts
- Tune configuration parameters
- Add new capabilities

---

## Troubleshooting

### Issue: Teams are too slow

**Solutions**:
1. Reduce agent count
2. Use smaller LLM model (qwen2.5 instead of 14B)
3. Disable non-critical agents
4. Switch to parallel workflow

### Issue: Low quality results

**Solutions**:
1. Improve LLM prompts in agent config
2. Increase temperature for creativity
3. Add more specific capabilities
4. Enable conflict resolution

### Issue: High LLM costs

**Solutions**:
1. Use local Ollama (free)
2. Cache results
3. Reduce maxTokens per agent
4. Use fallback heuristics

---

## Next Steps

1. ✅ Templates loaded and validated
2. 📝 Review template configurations
3. 🧪 Test with sample tasks
4. 🔧 Customize for your project
5. 📊 Monitor and optimize

---

**Templates Location**: \`src/main/cowork/templates/\`
**Documentation**: \`docs/features/COWORK_QUICK_START.md\`
**Support**: See project README

---

*Generated: ${new Date().toISOString().split('T')[0]}*
*Templates: ${Object.keys(templates).length} (${stats.totalAgents} agents total)*
`;

  const guidePath = path.join(__dirname, '..', '.cowork', 'team-templates-guide.md');
  fs.writeFileSync(guidePath, guide, 'utf-8');

  pass(`Team templates guide created: ${guidePath}`);
  info('Guide includes:');
  console.log('   - All 3 template overviews');
  console.log('   - Usage examples for each template');
  console.log('   - Configuration options');
  console.log('   - Capabilities reference');
  console.log('   - Best practices and troubleshooting');
}

/**
 * Step 4: Generate template index
 */
function generateTemplateIndex(templates) {
  console.log('\n📋 Step 4: Generating Template Index\n');

  const indexPath = path.join(__dirname, '../src/main/cowork/templates/index.json');

  const index = {
    version: '1.0.0',
    templates: Object.entries(templates).map(([fileName, template]) => ({
      id: fileName.replace('.json', ''),
      name: template.name,
      type: template.type,
      description: template.description,
      agentCount: template.agents.length,
      workflowType: template.workflow.type,
      file: fileName,
    })),
    totalTemplates: Object.keys(templates).length,
    totalAgents: stats.totalAgents,
  };

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  pass(`Template index created: ${indexPath}`);
  info(`Indexed ${index.totalTemplates} templates with ${index.totalAgents} agents`);
}

/**
 * Generate summary report
 */
function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Team Templates Summary');
  console.log('='.repeat(60));

  console.log(`\n✅ Templates Loaded: ${stats.templatesLoaded}`);
  console.log(`✅ Templates Valid: ${stats.templatesValid}`);
  console.log(`✅ Total Agents: ${stats.totalAgents}`);
  console.log(`❌ Errors: ${stats.errors}`);

  const successRate = stats.templatesLoaded > 0
    ? Math.round((stats.templatesValid / stats.templatesLoaded) * 100)
    : 0;

  console.log(`\n📈 Success Rate: ${successRate}%`);

  console.log('\n📦 Available Templates:');
  console.log('   1. Code Review Team (4 agents, parallel)');
  console.log('   2. Test Generation Team (3 agents, sequential)');
  console.log('   3. Documentation Team (3 agents, parallel)');

  if (stats.errors === 0) {
    console.log('\n✨ All team templates ready for use!\n');

    console.log('🚀 Quick Start:');
    console.log('   const team = await cowork.createTeam({ template: "code-review" });');
    console.log('   const task = await cowork.assignTask(team.id, { ... });');

    console.log('\n📍 Template Files:');
    console.log('   - src/main/cowork/templates/code-review-team.json');
    console.log('   - src/main/cowork/templates/test-generation-team.json');
    console.log('   - src/main/cowork/templates/documentation-team.json');
    console.log('   - src/main/cowork/templates/index.json');

    console.log('\n📚 Documentation:');
    console.log('   - .cowork/team-templates-guide.md\n');
  } else {
    console.log(`\n⚠️  Template creation completed with ${stats.errors} error(s).\n`);
  }

  return stats.errors === 0 ? 0 : 1;
}

/**
 * Main execution
 */
function main() {
  try {
    const templates = loadAndValidateTemplates();

    if (Object.keys(templates).length > 0) {
      analyzeTemplates(templates);
      generateUsageGuide(templates);
      generateTemplateIndex(templates);
    }

    const exitCode = generateReport();
    process.exit(exitCode);
  } catch (error) {
    console.error('\n❌ Template processing failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run script
if (require.main === module) {
  main();
}

module.exports = { main, stats };
