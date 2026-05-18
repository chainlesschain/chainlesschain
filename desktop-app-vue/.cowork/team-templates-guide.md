# Cowork Team Templates Guide

**Version**: 1.0.0
**Date**: 2026-01-27
**Templates**: 3
**Total Agents**: 10

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
```javascript
const team = await cowork.createTeam({ template: 'code-review' });
const task = await cowork.assignTask(team.id, {
  type: 'code-review',
  input: {
    files: ['src/auth/login.js'],
    aspects: ['security', 'performance', 'quality', 'architecture']
  }
});
```

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
```javascript
const team = await cowork.createTeam({ template: 'test-generation' });
const task = await cowork.assignTask(team.id, {
  type: 'test-generation',
  input: {
    sourceFiles: ['src/services/user-service.js'],
    coverageTarget: 90,
    includeEdgeCases: true
  }
});
```

**Expected Output**:
- `__tests__/unit/` - Unit test files
- `__tests__/integration/` - Integration test files
- `__tests__/edge-cases/` - Edge case test files
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
```javascript
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
```

**Expected Output**:
- `docs/api/API.md` - API documentation
- `docs/api/openapi.yaml` - OpenAPI specification
- `docs/guides/QUICK_START.md` - Quick start guide
- `docs/guides/USER_GUIDE.md` - Comprehensive user guide
- `docs/architecture/ARCHITECTURE.md` - System architecture
- `docs/architecture/decisions/` - ADRs (Architecture Decision Records)

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

```javascript
// Quick team creation from template
const team = await cowork.createTeam({
  template: 'code-review'  // or 'test-generation', 'documentation'
});
```

### Option 2: Customize Template

```javascript
// Load and customize template
const template = await cowork.loadTemplate('code-review');
template.config.coverageTarget = 95;  // Custom setting
template.agents = template.agents.filter(a => a.role !== 'architecture-reviewer');

const team = await cowork.createTeam({
  name: 'Custom Code Review',
  ...template
});
```

### Option 3: Create from Scratch

```javascript
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
```

---

## Team Configuration Options

### Common Config Fields

```javascript
{
  maxAgents: 4,                    // Maximum concurrent agents
  autoAssignTasks: true,           // Auto-assign tasks to agents
  parallelExecution: true,         // Run agents in parallel
  conflictResolution: 'llm',       // 'llm' | 'vote' | 'first'
  workingHours: '24/7',            // Agent availability
  coverageTarget: 90,              // For test teams
  outputFormat: 'markdown'         // For doc teams
}
```

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
- `security-scan` - General security scanning
- `owasp-check` - OWASP Top 10 validation
- `sql-injection-check` - SQL injection detection
- `xss-check` - Cross-site scripting detection
- `crypto-audit` - Cryptography review

### Performance Capabilities
- `complexity-analysis` - Time/space complexity
- `memory-check` - Memory leak detection
- `algorithm-optimization` - Algorithm improvements
- `bottleneck-detection` - Performance bottlenecks

### Testing Capabilities
- `unit-test-generation` - Unit test creation
- `integration-test-design` - Integration test design
- `edge-case-detection` - Edge case identification
- `mocking` - Test double creation

### Documentation Capabilities
- `api-documentation` - API doc generation
- `user-guide-writing` - User guide creation
- `architecture-documentation` - System architecture docs
- `adr-writing` - Architecture decision records

---

## Best Practices

### 1. Choose Right Template
- **Code Review**: For PR reviews, security audits
- **Test Generation**: For new features, bug fixes
- **Documentation**: For releases, onboarding

### 2. Customize for Your Needs
```javascript
// Adjust coverage targets
template.config.coverageTarget = 95;

// Add/remove agents
template.agents = template.agents.filter(a => a.priority <= 2);

// Change workflow
template.workflow.type = 'sequential';
```

### 3. Monitor Performance
```javascript
// Track team metrics
const metrics = await cowork.getTeamMetrics(team.id);
console.log(metrics.avgTaskTime);  // Average task completion time
console.log(metrics.successRate);  // Task success rate
```

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

**Templates Location**: `src/main/cowork/templates/`
**Documentation**: `docs/features/COWORK_QUICK_START.md`
**Support**: See project README

---

*Generated: 2026-01-27*
*Templates: 3 (10 agents total)*
