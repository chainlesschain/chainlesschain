# Cowork LLM Integration Guide

## Ollama Service Status

✅ **Service Running**: http://localhost:11434
📦 **Available Models**: 7

- **deepseek-r1:14b** (8.37GB, 14.8B)
- **deepseek-v2:16b** (8.29GB, 15.7B)
- **bge-m3:latest** (1.08GB, 566.70M)
- **deepseek-r1:8b** (4.87GB, 8.2B)
- **deepseek-r1:7b** (4.36GB, 7.6B)
- **qwen2.5:latest** (4.36GB, 7.6B)
- **llama3.1:latest** (4.34GB, 8.0B)

## Cowork LLM Integration

**File**: `src/main/cowork/integrations/llm-integration.js`

### Core Capabilities

1. **Task Analysis** (`analyzeTask()`)
   - Analyzes task complexity (1-10 scale)
   - Estimates completion time
   - Identifies required skills
   - Recommends agent count
   - Assesses parallelization potential
   - Evaluates risk level

2. **Agent Recommendation** (`recommendAgent()`)
   - Matches task requirements with agent capabilities
   - Considers current workload
   - Provides confidence score
   - Explains selection reasoning

3. **Task Decomposition** (`decomposeTask()`)
   - Breaks complex tasks into 3-7 subtasks
   - Identifies dependencies
   - Estimates time for each subtask
   - Maps required skills

4. **Conflict Resolution** (`resolveConflict()`)
   - Analyzes conflicting agent opinions
   - Weighs arguments and context
   - Provides clear decision
   - Explains rationale with confidence score

5. **Strategy Generation** (`generateStrategy()`)
   - Creates execution plans (sequential/parallel/hybrid)
   - Allocates resources optimally
   - Identifies risks
   - Defines success criteria

### Configuration

**Default Settings**:
```javascript
{
  model: 'qwen2:7b',      // LLM model to use
  temperature: 0.7,       // Creativity (0.0-1.0)
  maxTokens: 1000        // Max response length
}
```

**Recommended Models for Cowork**:
- **qwen2.5:latest** - Best balance of speed and quality
- **deepseek-r1:7b** - Excellent reasoning capabilities
- **llama3.1:latest** - Strong general performance

### Usage Examples

#### Example 1: Analyze Task

```javascript
const llmIntegration = new CoworkLLMIntegration(llmService);

const task = {
  description: "Review authentication module for security vulnerabilities",
  type: "code-review",
  priority: "high"
};

const analysis = await llmIntegration.analyzeTask(task);
// Returns: {
//   complexity: 8,
//   estimatedTime: 45,
//   requiredSkills: ["security", "code-review"],
//   recommendedAgents: 2,
//   canParallelize: true,
//   riskLevel: "High",
//   reasoning: "Complex security audit requires expertise"
// }
```

#### Example 2: Recommend Agent

```javascript
const recommendation = await llmIntegration.recommendAgent({
  task: codeReviewTask,
  availableAgents: [
    { id: "agent-1", name: "Security Reviewer", capabilities: ["security", "owasp"] },
    { id: "agent-2", name: "Code Auditor", capabilities: ["code-quality", "performance"] }
  ]
});
// Returns: {
//   agentId: "agent-1",
//   confidence: 0.92,
//   reasoning: "Agent has required security expertise"
// }
```

#### Example 3: Decompose Complex Task

```javascript
const subtasks = await llmIntegration.decomposeTask({
  description: "Implement user authentication system",
  type: "feature-development"
});
// Returns: [
//   { description: "Design authentication schema", estimatedTime: 30, ... },
//   { description: "Implement password hashing", estimatedTime: 45, ... },
//   { description: "Add session management", estimatedTime: 60, ... }
// ]
```

## Performance Expectations

### Response Times (qwen2.5:latest on CPU)

| Task Type | Tokens | Expected Time |
|-----------|--------|---------------|
| Simple Query | 20 | <1s |
| Task Analysis | 500 | 2-5s |
| Task Decomposition | 1000 | 5-10s |
| Strategy Generation | 1500 | 8-15s |

**GPU Acceleration**: 3-5x faster with NVIDIA GPU + CUDA

### Fallback Behavior

If LLM is unavailable, Cowork uses **heuristic fallbacks**:
- Task analysis: Based on description length
- Agent recommendation: First available agent
- Conflict resolution: Majority vote
- Decomposition: Returns empty (manual intervention needed)

## Model Selection Guide

### Small Tasks (< 5 min)
- **qwen2.5:latest** - Fast, accurate
- **deepseek-r1:7b** - Good reasoning

### Complex Tasks (> 15 min)
- **deepseek-r1:14b** - Superior analysis
- **deepseek-v2:16b** - Advanced reasoning

### Embedding Tasks
- **bge-m3:latest** - Optimized for embeddings

## Troubleshooting

### Issue: LLM responses are slow

**Solutions**:
1. Use smaller model (qwen2.5 instead of deepseek-v2:16b)
2. Reduce `maxTokens` setting
3. Enable GPU acceleration (Docker with NVIDIA runtime)
4. Lower `temperature` for faster, more deterministic responses

### Issue: LLM responses are not in JSON format

**Solution**: LLM integration has robust parsing with fallbacks
- Extracts JSON using regex: `/\{[\s\S]*\}/`
- Falls back to heuristics if parsing fails

### Issue: Ollama service unavailable

**Check**:
```bash
# Check if service is running
curl http://localhost:11434/api/tags

# Start Ollama (Docker)
docker-compose up -d ollama

# Or install locally
# https://ollama.ai
```

### Issue: Out of memory

**Solutions**:
1. Use smaller model (7B instead of 14B)
2. Reduce context length
3. Increase Docker memory limit (8GB recommended)

## Updating Model

### Change Default Model

Edit `src/main/cowork/integrations/llm-integration.js`:

```javascript
this.model = 'qwen2.5:latest';  // Update this line
```

### Download New Model

```bash
# Via Docker
docker exec chainlesschain-ollama ollama pull qwen2.5

# Or locally
ollama pull qwen2.5
```

## Monitoring LLM Usage

### Enable Metrics

Cowork tracks LLM usage:
- Request count
- Average response time
- Token consumption
- Error rate
- Fallback usage

Access via Cowork Analytics dashboard:
`http://localhost:5173/#/cowork/analytics`

## Next Steps

1. ✅ Ollama service verified
2. ✅ LLM integration tested
3. 📝 Update default model to qwen2.5 (optional)
4. 🧪 Test with real Cowork tasks
5. 📊 Monitor performance metrics

---

**Integration Status**: ✅ READY
**Recommended Next**: Create team templates (Task #5)

---

*Generated: 2026-01-27*
*Ollama Service: Running*
*Available Models: 7*
