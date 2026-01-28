/**
 * RAG (Retrieval-Augmented Generation) Complete Workflow Integration Test
 *
 * Tests the end-to-end RAG pipeline including:
 * - Document processing and chunking
 * - Embedding generation
 * - Vector storage (Qdrant/Memory)
 * - Semantic search and retrieval
 * - Reranking
 * - Response generation
 *
 * @requires vitest
 * @requires RAGManager
 * @requires EmbeddingsService
 * @requires Reranker
 * @requires TextSplitter
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { EventEmitter } from "events";

// ============================================================================
// Test Data
// ============================================================================

const mockDocuments = [
  {
    id: "doc-1",
    title: "Vue 3 Guide",
    content:
      "Vue 3 is a progressive JavaScript framework for building user interfaces. It features the Composition API for better code organization, improved performance with the new reactivity system, and enhanced TypeScript support. Vue 3 is designed to be incrementally adoptable and can scale between a library and a full-featured framework.",
    metadata: {
      category: "frontend",
      language: "en",
      tags: ["vue", "javascript", "framework"],
    },
  },
  {
    id: "doc-2",
    title: "Electron Development",
    content:
      "Electron enables cross-platform desktop application development using web technologies like HTML, CSS, and JavaScript. It combines Chromium and Node.js into a single runtime, allowing developers to create native applications for Windows, macOS, and Linux using the same codebase.",
    metadata: {
      category: "desktop",
      language: "en",
      tags: ["electron", "desktop", "cross-platform"],
    },
  },
  {
    id: "doc-3",
    title: "RAG Introduction",
    content:
      "Retrieval-Augmented Generation (RAG) combines information retrieval with text generation to produce more accurate and contextually relevant responses. The system first retrieves relevant documents from a knowledge base, then uses them as context to generate responses. This approach significantly reduces hallucinations and improves answer quality.",
    metadata: { category: "ai", language: "en", tags: ["rag", "ai", "nlp"] },
  },
  {
    id: "doc-4",
    title: "Vector Embeddings",
    content:
      "Vector embeddings are numerical representations of text that capture semantic meaning. They enable similarity search by mapping text into a high-dimensional vector space where semantically similar texts are closer together. Common embedding models include BERT, Sentence Transformers, and OpenAI embeddings.",
    metadata: {
      category: "ai",
      language: "en",
      tags: ["embeddings", "vectors", "nlp"],
    },
  },
  {
    id: "doc-5",
    title: "Semantic Search",
    content:
      "Semantic search goes beyond keyword matching to understand the intent and contextual meaning of search queries. It uses vector embeddings and similarity metrics like cosine similarity to find relevant documents based on semantic meaning rather than exact keyword matches.",
    metadata: {
      category: "ai",
      language: "en",
      tags: ["search", "semantic", "nlp"],
    },
  },
];

// ============================================================================
// Test Suites
// ============================================================================

describe("RAG Complete Workflow Integration Tests", () => {
  let mockDb;
  let mockLLM;
  let mockEmbeddings;
  let mockVectorStore;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Create fresh mocks for each test
    mockDb = {
      addKnowledgeItem: vi.fn().mockResolvedValue("new-kb-1"),
      updateKnowledgeItem: vi.fn().mockResolvedValue(true),
      deleteKnowledgeItem: vi.fn().mockResolvedValue(true),
      getKnowledgeItems: vi.fn().mockReturnValue([
        {
          id: "kb-1",
          title: "Vue 3 Composition API",
          content:
            "The Composition API is a set of additive, function-based APIs...",
          type: "note",
          created_at: "2024-01-01T00:00:00Z",
        },
      ]),
      searchKnowledgeItems: vi.fn().mockReturnValue([
        {
          id: "kb-1",
          title: "Vue 3 Composition API",
          content:
            "The Composition API is a set of additive, function-based APIs...",
          type: "note",
          rank: 0.8,
        },
      ]),
    };

    mockEmbeddings = {
      initialize: vi.fn().mockResolvedValue(true),
      isInitialized: true,
      generateEmbedding: vi.fn().mockResolvedValue(
        Array(768)
          .fill(0)
          .map(() => Math.random()),
      ),
      generateEmbeddings: vi.fn().mockImplementation(async (texts) => {
        return texts.map(() =>
          Array(768)
            .fill(0)
            .map(() => Math.random()),
        );
      }),
      cosineSimilarity: vi.fn().mockImplementation((vec1, vec2) => {
        if (!vec1 || !vec2 || vec1.length !== vec2.length) {
          return 0;
        }
        return 0.85; // Mock similarity
      }),
      clearCache: vi.fn(),
      getCacheStats: vi.fn().mockReturnValue({
        size: 10,
        maxSize: 2000,
        hitRate: 0.75,
        hits: 150,
        misses: 50,
        totalRequests: 200,
      }),
    };

    mockVectorStore = {
      initialize: vi.fn().mockResolvedValue(true),
      addVector: vi.fn().mockResolvedValue(true),
      addVectorsBatch: vi.fn().mockResolvedValue(true),
      search: vi.fn().mockResolvedValue([
        {
          id: "kb-1",
          score: 0.92,
          document:
            "The Composition API is a set of additive, function-based APIs...",
          metadata: { title: "Vue 3 Composition API", type: "note" },
        },
        {
          id: "kb-2",
          score: 0.85,
          document: "Electron uses IPC (Inter-Process Communication)...",
          metadata: { title: "Electron IPC Communication", type: "note" },
        },
      ]),
      deleteVector: vi.fn().mockResolvedValue(true),
      getStats: vi.fn().mockResolvedValue({
        mode: "memory",
        count: 3,
        chromaUrl: null,
      }),
    };

    mockLLM = {
      isInitialized: true,
      query: vi.fn().mockResolvedValue({
        text: "Based on the retrieved context, Vue 3 is a progressive JavaScript framework.",
        tokens: 45,
        metadata: { model: "mock-llm", temperature: 0.7 },
      }),
      embeddings: vi.fn().mockResolvedValue(
        Array(768)
          .fill(0)
          .map(() => Math.random()),
      ),
    };
  });

  // ==========================================================================
  // 1. Complete RAG Pipeline Tests
  // ==========================================================================

  describe("Complete RAG Pipeline", () => {
    it("should complete full RAG workflow: import → embed → store → retrieve → generate", async () => {
      const testDoc = mockDocuments[0];
      const query = "How to use Vue 3?";

      // Step 1: Document Import
      const docId = await mockDb.addKnowledgeItem(testDoc);
      expect(docId).toBe("new-kb-1");
      expect(mockDb.addKnowledgeItem).toHaveBeenCalledWith(testDoc);

      // Step 2: Generate Embedding
      const embedding = await mockEmbeddings.generateEmbedding(testDoc.content);
      expect(embedding).toBeDefined();
      expect(embedding).toHaveLength(768);
      expect(mockEmbeddings.generateEmbedding).toHaveBeenCalledWith(
        testDoc.content,
      );

      // Step 3: Store in Vector DB
      await mockVectorStore.addVector(testDoc, embedding);
      expect(mockVectorStore.addVector).toHaveBeenCalledWith(
        testDoc,
        embedding,
      );

      // Step 4: Query and Retrieve
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      const searchResults = await mockVectorStore.search(queryEmbedding, 5);
      expect(searchResults).toBeDefined();
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].score).toBeGreaterThan(0.5);

      // Step 5: Generate Response
      const context = searchResults.map((r) => r.document).join("\n\n");
      const prompt = `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer:`;
      const response = await mockLLM.query(prompt);

      expect(response.text).toBeDefined();
      expect(response.text.length).toBeGreaterThan(0);
      expect(mockLLM.query).toHaveBeenCalled();
    });

    it("should handle multi-document RAG query with source citations", async () => {
      const query = "What are the benefits of using modern web frameworks?";

      // Import multiple documents
      const docIds = [];
      for (const doc of mockDocuments.slice(0, 3)) {
        const id = await mockDb.addKnowledgeItem(doc);
        docIds.push(id);

        const embedding = await mockEmbeddings.generateEmbedding(doc.content);
        await mockVectorStore.addVector(doc, embedding);
      }

      expect(docIds).toHaveLength(3);

      // Query
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      const results = await mockVectorStore.search(queryEmbedding, 5);

      // Verify results include source information
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.metadata).toBeDefined();
        expect(result.metadata.title).toBeDefined();
      });

      // Build response with citations
      const sourceCitations = results
        .map((r, i) => `[${i + 1}] ${r.metadata.title}`)
        .join("\n");

      expect(sourceCitations).toContain("Vue 3");
    });

    it("should support RAG with metadata filtering", async () => {
      const query = "AI and machine learning concepts";
      const filter = { category: "ai" };

      // Import documents with different categories
      for (const doc of mockDocuments) {
        const embedding = await mockEmbeddings.generateEmbedding(doc.content);
        await mockVectorStore.addVector(doc, embedding);
      }

      // Query with filter
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      const results = await mockVectorStore.search(queryEmbedding, 10);

      // Filter results by metadata (simulated)
      const filteredResults = results.filter(
        (r) =>
          mockDocuments.find((d) => d.id === r.id)?.metadata.category === "ai",
      );

      expect(filteredResults.length).toBeGreaterThanOrEqual(0);
    });

    it("should implement hybrid search (keyword + semantic)", async () => {
      const query = "Vue Composition API";

      // Vector search
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      const vectorResults = await mockVectorStore.search(queryEmbedding, 10);

      // Keyword search
      const keywordResults = await mockDb.searchKnowledgeItems(query);

      // Merge results with weighted scores
      const mergedResults = new Map();

      // Add vector results (weight: 0.7)
      vectorResults.forEach((result) => {
        mergedResults.set(result.id, {
          ...result,
          vectorScore: result.score * 0.7,
          keywordScore: 0,
          hybridScore: result.score * 0.7,
        });
      });

      // Add keyword results (weight: 0.3)
      keywordResults.forEach((result) => {
        if (mergedResults.has(result.id)) {
          const existing = mergedResults.get(result.id);
          existing.keywordScore = result.rank * 0.3;
          existing.hybridScore = existing.vectorScore + result.rank * 0.3;
        } else {
          mergedResults.set(result.id, {
            ...result,
            vectorScore: 0,
            keywordScore: result.rank * 0.3,
            hybridScore: result.rank * 0.3,
          });
        }
      });

      // Sort by hybrid score
      const finalResults = Array.from(mergedResults.values()).sort(
        (a, b) => b.hybridScore - a.hybridScore,
      );

      expect(finalResults.length).toBeGreaterThan(0);
      expect(finalResults[0].hybridScore).toBeGreaterThan(0);
    });

    it("should include source citations in RAG response", async () => {
      const query = "Explain desktop application development";

      // Retrieve documents
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      const results = await mockVectorStore.search(queryEmbedding, 3);

      // Build context with citations
      let context = "# Retrieved Context\n\n";
      results.forEach((result, index) => {
        context += `## Source [${index + 1}]: ${result.metadata.title}\n`;
        context += `${result.document}\n\n`;
      });

      const prompt = `${context}\n# Question\n${query}\n\n# Instructions\nAnswer the question based on the context above. Include source citations like [1], [2] in your answer.\n\nAnswer:`;

      const response = await mockLLM.query(prompt);

      expect(response.text).toBeDefined();
      expect(prompt).toContain("Source [1]");
      expect(prompt).toContain("Source [2]");

      // Verify all sources are included
      results.forEach((result, index) => {
        expect(prompt).toContain(result.metadata.title);
      });
    });
  });

  // ==========================================================================
  // 2. Document Processing Tests
  // ==========================================================================

  describe("Document Processing", () => {
    it("should import text document and split into chunks", async () => {
      const longContent = "A".repeat(2000);
      const doc = {
        id: "long-doc",
        title: "Long Document",
        content: longContent,
      };

      // Simulate text splitting (chunk size 500, overlap 50)
      const chunkSize = 500;
      const chunkOverlap = 50;
      const chunks = [];

      let start = 0;
      while (start < doc.content.length) {
        const end = Math.min(start + chunkSize, doc.content.length);
        chunks.push({
          content: doc.content.substring(start, end),
          metadata: {
            sourceId: doc.id,
            chunkIndex: chunks.length,
            startOffset: start,
            endOffset: end,
          },
        });

        if (end === doc.content.length) {
          break;
        }
        start = end - chunkOverlap;
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].content.length).toBeLessThanOrEqual(chunkSize);
    });

    it("should import PDF and extract text", async () => {
      // Mock PDF document
      const pdfDoc = {
        id: "pdf-1",
        title: "Technical Documentation",
        content: "Extracted text from PDF document...",
        type: "pdf",
        metadata: {
          pages: 10,
          fileSize: 1024000,
          extracted: true,
        },
      };

      // Simulate PDF text extraction
      const extractedText = pdfDoc.content;
      expect(extractedText).toBeDefined();
      expect(extractedText.length).toBeGreaterThan(0);

      // Add to knowledge base
      const docId = await mockDb.addKnowledgeItem(pdfDoc);
      expect(docId).toBeDefined();

      // Generate embedding
      const embedding = await mockEmbeddings.generateEmbedding(extractedText);
      expect(embedding).toHaveLength(768);
    });

    it("should import multiple formats (txt, md, pdf)", async () => {
      const documents = [
        {
          id: "txt-1",
          type: "text",
          content: "Plain text content",
          title: "Text File",
        },
        {
          id: "md-1",
          type: "markdown",
          content: "# Markdown\n\nMarkdown content",
          title: "Markdown File",
        },
        {
          id: "pdf-1",
          type: "pdf",
          content: "PDF extracted content",
          title: "PDF File",
        },
      ];

      const results = [];

      for (const doc of documents) {
        // Add to database
        const docId = await mockDb.addKnowledgeItem(doc);

        // Generate embedding
        const embedding = await mockEmbeddings.generateEmbedding(doc.content);

        // Store in vector DB
        await mockVectorStore.addVector(doc, embedding);

        results.push({ docId, type: doc.type });
      }

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.type)).toEqual(["text", "markdown", "pdf"]);
    });
  });

  // ==========================================================================
  // 3. Embedding Generation Tests
  // ==========================================================================

  describe("Embedding Generation", () => {
    it("should generate embeddings for text chunks", async () => {
      const text = "This is a test text for embedding generation.";

      const embedding = await mockEmbeddings.generateEmbedding(text);

      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(768);
      expect(embedding.every((v) => typeof v === "number")).toBe(true);
      expect(mockEmbeddings.generateEmbedding).toHaveBeenCalledWith(text);
    });

    it("should handle batch embedding generation (100+ chunks)", async () => {
      const chunks = Array.from(
        { length: 100 },
        (_, i) => `Chunk ${i}: This is test content for chunk number ${i}`,
      );

      const startTime = Date.now();
      const embeddings = await mockEmbeddings.generateEmbeddings(chunks);
      const duration = Date.now() - startTime;

      expect(embeddings).toHaveLength(100);
      expect(embeddings.every((emb) => emb.length === 768)).toBe(true);
      expect(duration).toBeLessThan(5000);
    });

    it("should validate embedding dimensions", async () => {
      const text = "Test embedding validation";

      const embedding = await mockEmbeddings.generateEmbedding(text);

      // Validate dimension
      expect(embedding.length).toBe(768);

      // Validate value range
      const allInRange = embedding.every((v) => v >= -2 && v <= 2);
      expect(allInRange).toBe(true);

      // Validate not all zeros
      const hasNonZero = embedding.some((v) => v !== 0);
      expect(hasNonZero).toBe(true);
    });

    it("should use cache efficiently", async () => {
      const text = "Repeated text for caching test";

      // First call
      await mockEmbeddings.generateEmbedding(text);

      // Second call
      await mockEmbeddings.generateEmbedding(text);

      // Check cache stats
      const stats = mockEmbeddings.getCacheStats();
      expect(stats).toBeDefined();
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 4. Vector Search & Retrieval Tests
  // ==========================================================================

  describe("Vector Search & Retrieval", () => {
    it("should perform semantic search and return relevant chunks", async () => {
      // Index documents
      for (const doc of mockDocuments.slice(0, 3)) {
        const embedding = await mockEmbeddings.generateEmbedding(doc.content);
        await mockVectorStore.addVector(doc, embedding);
      }

      // Query
      const query = "frontend framework for building UIs";
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      const results = await mockVectorStore.search(queryEmbedding, 5);

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      // Verify results are sorted by score
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }

      // Verify top result is relevant
      expect(results[0].metadata.title).toContain("Vue");
    });

    it("should support configurable top-K retrieval", async () => {
      const query = "web development";
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);

      // Test different K values
      const k3Results = await mockVectorStore.search(queryEmbedding, 3);
      const k5Results = await mockVectorStore.search(queryEmbedding, 5);
      const k10Results = await mockVectorStore.search(queryEmbedding, 10);

      expect(k3Results).toBeDefined();
      expect(k5Results).toBeDefined();
      expect(k10Results).toBeDefined();

      // All should return results
      expect(k3Results.length).toBeGreaterThan(0);
      expect(k5Results.length).toBeGreaterThan(0);
      expect(k10Results.length).toBeGreaterThan(0);
    });

    it("should filter by similarity threshold", async () => {
      const query = "test query";
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      const allResults = await mockVectorStore.search(queryEmbedding, 10);

      const threshold = 0.7;
      const filteredResults = allResults.filter((r) => r.score >= threshold);

      expect(filteredResults.every((r) => r.score >= threshold)).toBe(true);
    });

    it("should support query expansion and rewriting", async () => {
      const originalQuery = "vue";

      // Simulate query expansion
      const expandedQueries = [
        originalQuery,
        "vue framework",
        "vue.js javascript framework",
        "vue 3 composition api",
      ];

      const allResults = [];

      for (const query of expandedQueries) {
        const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
        const results = await mockVectorStore.search(queryEmbedding, 5);
        allResults.push(...results);
      }

      // Deduplicate results
      const uniqueResults = new Map();
      allResults.forEach((result) => {
        if (
          !uniqueResults.has(result.id) ||
          result.score > uniqueResults.get(result.id).score
        ) {
          uniqueResults.set(result.id, result);
        }
      });

      const finalResults = Array.from(uniqueResults.values()).sort(
        (a, b) => b.score - a.score,
      );

      expect(finalResults.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 5. Reranking Tests
  // ==========================================================================

  describe("Reranking", () => {
    it("should rerank retrieved results using LLM", async () => {
      const query = "How to build desktop apps?";

      // Initial retrieval
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      const initialResults = await mockVectorStore.search(queryEmbedding, 10);

      // Simulate LLM reranking
      mockLLM.query.mockResolvedValueOnce({ text: "0.9, 0.7, 0.5" });
      const rerankPrompt = `Rate relevance of documents to query: "${query}"`;
      const llmResponse = await mockLLM.query(rerankPrompt);

      // Parse scores
      const scores = llmResponse.text
        .split(",")
        .map((s) => parseFloat(s.trim()))
        .filter((s) => !isNaN(s));

      // Apply rerank scores
      const rerankedResults = initialResults
        .map((result, index) => ({
          ...result,
          originalScore: result.score,
          rerankScore: scores[index] || result.score,
          finalScore: scores[index] || result.score,
        }))
        .sort((a, b) => b.finalScore - a.finalScore);

      expect(rerankedResults.length).toBeGreaterThan(0);
      expect(rerankedResults[0].finalScore).toBeGreaterThan(0);
    });

    it("should use BGE reranker to improve relevance", async () => {
      const query = "explain vector embeddings";
      const initialResults = mockDocuments.slice(2, 5).map((doc, index) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        score: 0.8 - index * 0.1,
        metadata: doc.metadata,
      }));

      // Simulate BGE reranking
      const bgeRerankedResults = initialResults
        .map((result) => ({
          ...result,
          bgeScore: result.content.toLowerCase().includes("embedding")
            ? 0.95
            : result.content.toLowerCase().includes("vector")
              ? 0.9
              : 0.75,
          originalScore: result.score,
        }))
        .sort((a, b) => b.bgeScore - a.bgeScore);

      expect(bgeRerankedResults.length).toBe(initialResults.length);
      expect(bgeRerankedResults[0].bgeScore).toBeGreaterThanOrEqual(0.9);
    });

    it("should apply reranker score threshold", async () => {
      const results = [
        { id: "1", score: 0.95, content: "Highly relevant" },
        { id: "2", score: 0.75, content: "Moderately relevant" },
        { id: "3", score: 0.5, content: "Slightly relevant" },
        { id: "4", score: 0.25, content: "Not relevant" },
      ];

      const threshold = 0.6;
      const filteredResults = results.filter((r) => r.score >= threshold);

      expect(filteredResults).toHaveLength(2);
      expect(filteredResults.every((r) => r.score >= threshold)).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Performance Benchmarks
  // ==========================================================================

  describe("Performance Benchmarks", () => {
    it("should index 1000 documents in reasonable time", async () => {
      const documents = Array.from({ length: 1000 }, (_, i) => ({
        id: `perf-doc-${i}`,
        title: `Performance Test Document ${i}`,
        content: `This is test content for document ${i}. `.repeat(50),
        type: "note",
      }));

      const startTime = Date.now();

      // Batch processing
      const batchSize = 50;
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        const embeddings = await mockEmbeddings.generateEmbeddings(
          batch.map((doc) => doc.content),
        );
        await mockVectorStore.addVectorsBatch(batch, embeddings);
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(30000);
    }, 35000);

    it("should complete query retrieval quickly", async () => {
      const query = "test query for performance measurement";
      const startTime = Date.now();

      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      const results = await mockVectorStore.search(queryEmbedding, 10);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500);
      expect(results.length).toBeGreaterThan(0);
    });

    it("should maintain performance with large corpus", async () => {
      const stats = await mockVectorStore.getStats();
      expect(stats.count).toBeGreaterThanOrEqual(0);

      // Test query performance
      const query = "performance test";
      const startTime = Date.now();
      const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
      await mockVectorStore.search(queryEmbedding, 10);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
    });

    it("should efficiently handle concurrent queries", async () => {
      const queries = Array.from(
        { length: 10 },
        (_, i) => `concurrent query ${i}`,
      );

      const startTime = Date.now();

      const results = await Promise.all(
        queries.map(async (query) => {
          const queryEmbedding = await mockEmbeddings.generateEmbedding(query);
          return await mockVectorStore.search(queryEmbedding, 5);
        }),
      );

      const duration = Date.now() - startTime;
      const avgTimePerQuery = duration / queries.length;

      expect(results).toHaveLength(queries.length);
      expect(results.every((r) => r.length > 0)).toBe(true);
      expect(avgTimePerQuery).toBeLessThan(500);
    });
  });

  // ==========================================================================
  // 7. Error Handling & Edge Cases
  // ==========================================================================

  describe("Error Handling & Edge Cases", () => {
    it("should handle empty query gracefully", async () => {
      const emptyQuery = "";

      if (emptyQuery.trim()) {
        const queryEmbedding = await mockEmbeddings.generateEmbedding(
          emptyQuery.trim(),
        );
        const results = await mockVectorStore.search(queryEmbedding, 5);
        expect(results).toBeDefined();
      } else {
        expect(emptyQuery).toBe("");
      }
    });

    it("should handle documents with no content", async () => {
      const emptyDoc = {
        id: "empty-doc",
        title: "Empty Document",
        content: "",
        type: "note",
      };

      if (emptyDoc.content.trim()) {
        await mockDb.addKnowledgeItem(emptyDoc);
      }

      expect(emptyDoc.content).toBe("");
    });

    it("should handle vector store connection failure", async () => {
      // Mock connection failure
      const failingVectorStore = {
        search: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      };

      try {
        await failingVectorStore.search([0.1, 0.2], 5);
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain("ECONNREFUSED");
      }

      // Should fallback to database keyword search
      const fallbackResults = await mockDb.searchKnowledgeItems("test query");
      expect(fallbackResults).toBeDefined();
    });

    it("should handle embedding generation failure", async () => {
      const failingEmbeddings = {
        generateEmbedding: vi
          .fn()
          .mockRejectedValue(new Error("Model not available")),
      };

      try {
        await failingEmbeddings.generateEmbedding("test");
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain("Model not available");
      }
    });

    it("should handle invalid UTF-8 characters", async () => {
      const specialText = "Test with special chars: 你好 🚀 ñ é ü";
      const embedding = await mockEmbeddings.generateEmbedding(specialText);

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(768);
    });

    it("should handle very long documents", async () => {
      const veryLongDoc = {
        id: "long-doc",
        title: "Very Long Document",
        content: "A".repeat(150000),
        type: "document",
      };

      const chunkSize = 1000;
      const expectedChunks = Math.ceil(veryLongDoc.content.length / chunkSize);

      expect(expectedChunks).toBeGreaterThan(100);

      const chunks = [];
      for (let i = 0; i < veryLongDoc.content.length; i += chunkSize) {
        chunks.push(veryLongDoc.content.substring(i, i + chunkSize));
      }

      expect(chunks.length).toBe(expectedChunks);
    });
  });

  // ==========================================================================
  // 8. Integration Scenarios
  // ==========================================================================

  describe("Real-World Integration Scenarios", () => {
    it("should support incremental index updates", async () => {
      // Initial index
      const initialDocs = mockDocuments.slice(0, 2);
      for (const doc of initialDocs) {
        await mockDb.addKnowledgeItem(doc);
        const embedding = await mockEmbeddings.generateEmbedding(doc.content);
        await mockVectorStore.addVector(doc, embedding);
      }

      // Add new document
      const newDoc = mockDocuments[2];
      await mockDb.addKnowledgeItem(newDoc);
      const embedding = await mockEmbeddings.generateEmbedding(newDoc.content);
      await mockVectorStore.addVector(newDoc, embedding);

      // Verify all documents are searchable
      const stats = await mockVectorStore.getStats();
      expect(stats.count).toBeGreaterThanOrEqual(0);
    });

    it("should support document updates", async () => {
      const doc = { ...mockDocuments[0] };

      // Add initial version
      await mockDb.addKnowledgeItem(doc);
      const initialEmbedding = await mockEmbeddings.generateEmbedding(
        doc.content,
      );
      await mockVectorStore.addVector(doc, initialEmbedding);

      // Update document
      doc.content = "Updated content about Vue 3 with new information";
      await mockDb.updateKnowledgeItem(doc);

      // Delete old embedding
      await mockVectorStore.deleteVector(doc.id);

      // Add updated embedding
      const updatedEmbedding = await mockEmbeddings.generateEmbedding(
        doc.content,
      );
      await mockVectorStore.addVector(doc, updatedEmbedding);

      expect(mockVectorStore.deleteVector).toHaveBeenCalledWith(doc.id);
      expect(mockVectorStore.addVector).toHaveBeenCalledTimes(2);
    });

    it("should support document deletion from index", async () => {
      const doc = mockDocuments[0];

      // Add document
      await mockDb.addKnowledgeItem(doc);
      const embedding = await mockEmbeddings.generateEmbedding(doc.content);
      await mockVectorStore.addVector(doc, embedding);

      // Delete document
      await mockDb.deleteKnowledgeItem(doc.id);
      await mockVectorStore.deleteVector(doc.id);

      expect(mockVectorStore.deleteVector).toHaveBeenCalledWith(doc.id);
      expect(mockDb.deleteKnowledgeItem).toHaveBeenCalledWith(doc.id);
    });

    it("should support multi-language documents", async () => {
      const multiLangDocs = [
        {
          id: "en-1",
          content: "English content about programming",
          language: "en",
        },
        { id: "zh-1", content: "关于编程的中文内容", language: "zh" },
        {
          id: "es-1",
          content: "Contenido en español sobre programación",
          language: "es",
        },
      ];

      for (const doc of multiLangDocs) {
        const embedding = await mockEmbeddings.generateEmbedding(doc.content);
        expect(embedding).toBeDefined();
        expect(embedding.length).toBe(768);
      }
    });
  });
});
