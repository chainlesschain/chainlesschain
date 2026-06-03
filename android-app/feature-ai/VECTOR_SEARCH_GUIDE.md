# Vector Search Foundation - User Guide

## Overview

The vector search foundation provides a scalable infrastructure for semantic similarity search in the knowledge base. It supports multiple embedding strategies and can be easily extended with ML models.

## Architecture

```
RAGRetriever
    ├── FTS5 Search (Keyword-based, Fast)
    ├── Vector Search (Semantic-based, Accurate)
    │   ├── TF-IDF Embedder (Baseline, No ML)
    │   ├── Sentence Transformer (ML-based, High quality)
    │   └── OpenAI Embeddings (Cloud API)
    └── Hybrid Search (Coming soon)
```

## Usage

### Basic Retrieval (FTS5)

```kotlin
val retriever = RAGRetriever(knowledgeItemDao, vectorEmbedderFactory)

// Default FTS5 search
val results = retriever.retrieve(
    query = "Kotlin协程",
    topK = 3,
    useVectorSearch = false
)
```

### Vector-based Retrieval

```kotlin
// Enable vector search
val results = retriever.retrieve(
    query = "Kotlin协程",
    topK = 3,
    useVectorSearch = true
)

results.forEach { result ->
    println("${result.title}: ${result.score} (${result.searchMethod})")
}
```

## Embedding Strategies

### 1. TF-IDF Embedder (Default)

**Pros:**

- Fast, lightweight
- No external dependencies
- Works offline
- Good for keyword-heavy queries

**Cons:**

- Limited semantic understanding
- Cannot handle synonyms well
- Lower accuracy for complex queries

**Use case:** Quick searches, keyword-based queries, resource-constrained environments

### 2. Sentence Transformer (Placeholder)

**Future Integration:**

- TensorFlow Lite model
- ONNX Runtime
- Cloud API (OpenAI, Cohere)

**Implementation path:**

```kotlin
// Step 1: Download pre-trained model (e.g., paraphrase-multilingual-MiniLM-L12-v2)
// Step 2: Convert to TFLite format
// Step 3: Load model in SentenceTransformerEmbedder
// Step 4: Replace placeholder embed() method
```

### 3. OpenAI Embeddings (Planned)

**API:** `text-embedding-3-small` or `text-embedding-3-large`

**Pros:**

- State-of-the-art quality
- Multilingual support
- No local model needed

**Cons:**

- Requires API key
- Network latency
- Cost per request

## Configuration

### Switching Embedder Type

```kotlin
@Singleton
class RAGRetriever @Inject constructor(
    private val knowledgeItemDao: KnowledgeItemDao,
    private val vectorEmbedderFactory: VectorEmbedderFactory
) {
    // Change embedder type here
    private val embedder: VectorEmbedder by lazy {
        vectorEmbedderFactory.createEmbedder(
            EmbedderType.TF_IDF  // or SENTENCE_TRANSFORMER, OPENAI_API
        )
    }
}
```

### Performance Tuning

**For TF-IDF:**

```kotlin
// Update vocabulary with your knowledge base
val tfIdfEmbedder = TfIdfEmbedder()
tfIdfEmbedder.updateDocumentFrequency(allDocuments)
```

**For large knowledge bases (> 1000 items):**

- Consider using a dedicated vector database (Qdrant, Milvus)
- Cache embeddings in database
- Use approximate nearest neighbor (ANN) algorithms

## Integration with RAG

```kotlin
// In ConversationViewModel
fun sendMessage(content: String, enableRAG: Boolean = true, useVectorSearch: Boolean = false) {
    viewModelScope.launch {
        // Build RAG context with vector search
        val ragContext = if (enableRAG) {
            ragRetriever.buildContext(
                query = content,
                topK = 3
                // Note: buildContext internally calls retrieve with useVectorSearch flag
            )
        } else {
            ""
        }

        // Send to LLM...
    }
}
```

## Migration Path to Production-Grade Vector Search

### Step 1: Add Vector Database (Recommended)

**Option A: Qdrant (Self-hosted)**

```gradle
implementation("io.qdrant:client:1.7.0")
```

**Option B: Chroma (Embedded)**

```gradle
implementation("tech.amikos:chromadb-java-client:0.1.0")
```

### Step 2: Integrate TensorFlow Lite

```gradle
implementation("org.tensorflow:tensorflow-lite:2.14.0")
implementation("org.tensorflow:tensorflow-lite-support:0.4.4")
```

Download model:

```bash
# Option 1: Sentence Transformers (Multilingual)
wget https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/model.tflite

# Option 2: DistilBERT (English)
wget https://huggingface.co/distilbert-base-uncased/resolve/main/model.tflite
```

### Step 3: Update SentenceTransformerEmbedder

```kotlin
@Singleton
class SentenceTransformerEmbedder @Inject constructor(
    @ApplicationContext private val context: Context
) : VectorEmbedder {

    private val interpreter: Interpreter by lazy {
        val model = loadModelFile("paraphrase-multilingual-MiniLM-L12-v2.tflite")
        Interpreter(model)
    }

    override suspend fun embed(text: String): FloatArray {
        val tokens = tokenize(text)
        val inputBuffer = ByteBuffer.allocateDirect(tokens.size * 4)
        val outputBuffer = ByteBuffer.allocateDirect(VECTOR_DIM * 4)

        interpreter.run(inputBuffer, outputBuffer)

        val vector = FloatArray(VECTOR_DIM)
        outputBuffer.asFloatBuffer().get(vector)
        return normalize(vector)
    }
}
```

## Performance Benchmarks

**Test Dataset:** 1000 knowledge base items, average 500 words each

| Method                        | Latency | Recall@3 | Precision@3 |
| ----------------------------- | ------- | -------- | ----------- |
| FTS5 Keyword                  | 10ms    | 0.65     | 0.72        |
| TF-IDF Vector                 | 150ms   | 0.70     | 0.75        |
| Sentence Transformer (TFLite) | 300ms   | 0.85     | 0.88        |
| OpenAI Embeddings API         | 500ms   | 0.90     | 0.92        |

_Note: Benchmarks are estimates and will vary based on device and dataset_

## Troubleshooting

### Issue: Vector search is too slow

**Solution:**

- Reduce knowledge base size limit (currently 1000)
- Use ANN algorithms (e.g., FAISS, Annoy)
- Integrate dedicated vector database

### Issue: Low retrieval quality

**Solution:**

- Switch to Sentence Transformer embedder
- Train custom TF-IDF vocabulary on your data
- Increase topK parameter

### Issue: Out of memory

**Solution:**

- Reduce VECTOR_DIM (e.g., from 384 to 128)
- Process embeddings in batches
- Use quantized models (int8 instead of float32)

## Future Roadmap

- [ ] Hybrid search (FTS5 + Vector combined)
- [ ] Reranking with cross-encoder
- [ ] Multi-vector representation
- [ ] Query expansion
- [ ] Semantic caching
- [ ] Incremental index updates

## References

- [Sentence Transformers](https://www.sbert.net/)
- [TensorFlow Lite](https://www.tensorflow.org/lite)
- [Qdrant Vector Database](https://qdrant.tech/)
- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings)
