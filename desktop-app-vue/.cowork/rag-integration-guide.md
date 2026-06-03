# Cowork RAG Integration Guide

## Quick Start (In-Memory Mode)

The RAG system is now configured to use **in-memory storage** for quick testing:

### Current Configuration

```javascript
{
  enableRAG: true,              // ✅ Enabled for Cowork
  useChromaDB: false,           // Using memory (no Docker needed)
  enableReranking: true,        // Smart result reranking
  enableHybridSearch: true,     // Vector + keyword search
  topK: 10,                     // Return top 10 results
  similarityThreshold: 0.6,     // Minimum similarity score
}
```

### How Cowork Agents Use RAG

1. **Query Historical Knowledge**:
   ```javascript
   const results = await ragIntegration.queryKnowledge({
     query: "How to optimize CI/CD pipeline?",
     teamId: team.id,
     taskType: "ci-optimization",
     limit: 5
   });
   ```

2. **Find Similar Past Tasks**:
   ```javascript
   const similarTasks = await ragIntegration.findSimilarTasks(currentTask);
   // Returns: Tasks with similar descriptions and solutions
   ```

3. **Store Task Solutions**:
   ```javascript
   await ragIntegration.storeTaskSolution({
     task: completedTask,
     solution: taskResult,
     metadata: { agent: "code-reviewer-1" }
   });
   ```

4. **Query Domain Knowledge**:
   ```javascript
   const knowledge = await ragIntegration.queryDomainKnowledge(
     "code-review",
     "What are common security vulnerabilities?"
   );
   ```

## Upgrade to ChromaDB (Production)

For production use with large knowledge bases, upgrade to ChromaDB:

### Step 1: Start Docker Services

```bash
# Start ChromaDB container
docker-compose up -d chromadb

# Verify service is running
curl http://localhost:8000/api/v1/heartbeat
```

### Step 2: Update RAG Configuration

Edit `src/main/rag/rag-manager.js`:

```javascript
const DEFAULT_CONFIG = {
  enableRAG: true,        // Keep enabled
  useChromaDB: true,      // 👈 Change to true
  chromaUrl: 'http://localhost:8000',
  // ... rest of config
};
```

### Step 3: Rebuild Vector Index

```bash
# Restart desktop app - it will rebuild index in ChromaDB
npm run dev
```

## Performance Comparison

| Mode | Startup Time | Query Speed | Capacity | Persistence |
|------|-------------|-------------|----------|-------------|
| **Memory** | <1s | Very Fast | ~10K docs | No |
| **ChromaDB** | ~5s | Fast | Unlimited | Yes |

## Monitoring RAG Performance

Access RAG metrics via IPC:

```javascript
// From renderer process
const stats = await window.electron.invoke('rag:get-stats');
console.log('RAG Index Size:', stats.totalItems);
console.log('Storage Mode:', stats.storageMode);
```

## Troubleshooting

### Issue: RAG queries return empty results

**Solution**: Ensure documents are imported to knowledge base
```bash
# Check index stats
node scripts/cowork-rag-integration.js
```

### Issue: ChromaDB connection fails

**Solution**: Verify Docker service is running
```bash
docker-compose ps chromadb
docker-compose logs chromadb
```

### Issue: Slow query performance

**Solution**: Enable reranking for better result quality
```javascript
ragManager.updateConfig({
  enableReranking: true,
  rerankMethod: 'hybrid',
  rerankTopK: 5
});
```

## Next Steps

1. ✅ RAG integration verified
2. 📝 Import additional project documentation
3. 🧪 Test with real Cowork tasks
4. 📊 Monitor query performance
5. 🚀 Upgrade to ChromaDB for production

---

**Documentation**: docs/features/COWORK_QUICK_START.md
**Support**: See README.md for troubleshooting
